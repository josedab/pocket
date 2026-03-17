import type { ChangeEvent, Document } from '@pocket/core';
import { describe, expect, it } from 'vitest';
import { DeltaComputer, createDeltaComputer } from '../server/delta-computer.js';
import type { ServerSubscriptionState } from '../types.js';

function makeDoc(id: string, fields: Record<string, unknown> = {}): Document {
  return { _id: id, ...fields } as Document;
}

function makeChange(
  operation: 'insert' | 'update' | 'delete',
  documentId: string,
  doc: Document | null = null
): ChangeEvent<Document> {
  return {
    operation,
    documentId,
    document: doc,
    previousDocument: undefined,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: 0,
  };
}

function makeSub(
  collection: string,
  opts: {
    filter?: Record<string, unknown>;
    currentIds?: string[];
    limit?: number;
    id?: string;
  } = {}
): ServerSubscriptionState {
  return {
    id: opts.id ?? 'test-sub',
    clientId: 'client-1',
    query: {
      id: opts.id ?? 'test-sub',
      collection,
      filter: opts.filter,
      limit: opts.limit,
    },
    currentIds: new Set(opts.currentIds ?? []),
    sequence: 0,
    createdAt: Date.now(),
  };
}

describe('DeltaComputer (extended)', () => {
  const computer = new DeltaComputer();

  describe('createDeltaComputer factory', () => {
    it('returns a DeltaComputer instance', () => {
      const dc = createDeltaComputer();
      expect(dc).toBeInstanceOf(DeltaComputer);
    });
  });

  describe('insert with limit at capacity', () => {
    it('still adds document even when at capacity', () => {
      const sub = makeSub('users', { limit: 2, currentIds: ['a', 'b'] });
      const doc = makeDoc('c', { name: 'Charlie' });
      const delta = computer.computeDelta(sub, makeChange('insert', 'c', doc));

      expect(delta).not.toBeNull();
      expect(delta!.added).toHaveLength(1);
      expect(sub.currentIds.has('c')).toBe(true);
    });

    it('does not produce removed entries when at capacity (client-side eviction)', () => {
      const sub = makeSub('users', { limit: 1, currentIds: ['a'] });
      const doc = makeDoc('b', { name: 'B' });
      const delta = computer.computeDelta(sub, makeChange('insert', 'b', doc));

      expect(delta).not.toBeNull();
      expect(delta!.removed).toHaveLength(0);
    });
  });

  describe('insert with complex filter', () => {
    it('handles filter with $and', () => {
      const sub = makeSub('users', {
        filter: { $and: [{ status: 'active' }, { age: { $gte: 18 } }] },
      });
      const doc = makeDoc('d1', { status: 'active', age: 25 });
      expect(computer.computeDelta(sub, makeChange('insert', 'd1', doc))).not.toBeNull();

      const doc2 = makeDoc('d2', { status: 'active', age: 10 });
      expect(computer.computeDelta(sub, makeChange('insert', 'd2', doc2))).toBeNull();
    });
  });

  describe('update with null document', () => {
    it('returns null for update with null document', () => {
      const sub = makeSub('users', { currentIds: ['d1'] });
      const delta = computer.computeDelta(sub, makeChange('update', 'd1', null));
      expect(delta).toBeNull();
    });
  });

  describe('update transitions', () => {
    it('update: was in set, still matches → modified, sequence increments', () => {
      const sub = makeSub('users', { filter: { status: 'active' }, currentIds: ['d1'] });
      const doc = makeDoc('d1', { status: 'active', name: 'Updated' });
      const delta = computer.computeDelta(sub, makeChange('update', 'd1', doc));

      expect(delta).not.toBeNull();
      expect(delta!.modified).toHaveLength(1);
      expect(delta!.added).toHaveLength(0);
      expect(delta!.removed).toHaveLength(0);
      expect(delta!.sequence).toBe(1);
    });

    it('update: was NOT in set, now matches → added, tracked', () => {
      const sub = makeSub('users', { filter: { status: 'active' } });
      const doc = makeDoc('d1', { status: 'active' });
      const delta = computer.computeDelta(sub, makeChange('update', 'd1', doc));

      expect(delta!.added).toHaveLength(1);
      expect(sub.currentIds.has('d1')).toBe(true);
    });

    it('update: was in set, no longer matches → removed, untracked', () => {
      const sub = makeSub('users', { filter: { status: 'active' }, currentIds: ['d1'] });
      const doc = makeDoc('d1', { status: 'inactive' });
      const delta = computer.computeDelta(sub, makeChange('update', 'd1', doc));

      expect(delta!.removed).toEqual(['d1']);
      expect(sub.currentIds.has('d1')).toBe(false);
    });

    it('update: was NOT in set, still does not match → null', () => {
      const sub = makeSub('users', { filter: { status: 'active' } });
      const doc = makeDoc('d1', { status: 'banned' });
      expect(computer.computeDelta(sub, makeChange('update', 'd1', doc))).toBeNull();
    });
  });

  describe('delete edge cases', () => {
    it('delete removes from currentIds', () => {
      const sub = makeSub('users', { currentIds: ['d1', 'd2'] });
      const delta = computer.computeDelta(sub, makeChange('delete', 'd1', null));

      expect(delta!.removed).toEqual(['d1']);
      expect(sub.currentIds.has('d1')).toBe(false);
      expect(sub.currentIds.has('d2')).toBe(true);
    });

    it('delete of untracked document returns null', () => {
      const sub = makeSub('users');
      expect(computer.computeDelta(sub, makeChange('delete', 'x', null))).toBeNull();
    });
  });

  describe('unknown operation', () => {
    it('returns null for unknown operation types', () => {
      const sub = makeSub('users');
      const change = {
        operation: 'replace' as unknown as 'insert',
        documentId: 'd1',
        document: makeDoc('d1'),
        isFromSync: false,
        timestamp: Date.now(),
        sequence: 0,
      };
      expect(computer.computeDelta(sub, change)).toBeNull();
    });
  });

  describe('sequence tracking across multiple operations', () => {
    it('increments sequence for each non-null delta', () => {
      const sub = makeSub('users');

      computer.computeDelta(sub, makeChange('insert', 'd1', makeDoc('d1')));
      expect(sub.sequence).toBe(1);

      computer.computeDelta(sub, makeChange('insert', 'd2', makeDoc('d2')));
      expect(sub.sequence).toBe(2);

      computer.computeDelta(sub, makeChange('delete', 'd1', null));
      expect(sub.sequence).toBe(3);

      // No delta = no sequence increment
      computer.computeDelta(sub, makeChange('delete', 'nonexistent', null));
      expect(sub.sequence).toBe(3);
    });
  });

  describe('delta structure', () => {
    it('always includes subscriptionId, type, and timestamp', () => {
      const sub = makeSub('users', { id: 'my-sub' });
      const delta = computer.computeDelta(sub, makeChange('insert', 'd1', makeDoc('d1')));

      expect(delta!.subscriptionId).toBe('my-sub');
      expect(delta!.type).toBe('delta');
      expect(typeof delta!.timestamp).toBe('number');
      expect(delta!.timestamp).toBeGreaterThan(0);
    });
  });

  describe('no filter (match all)', () => {
    it('insert always produces delta with no filter', () => {
      const sub = makeSub('users');
      const delta = computer.computeDelta(
        sub,
        makeChange('insert', 'd1', makeDoc('d1', { any: 'data' }))
      );
      expect(delta).not.toBeNull();
      expect(delta!.added).toHaveLength(1);
    });

    it('update of tracked doc produces modified with no filter', () => {
      const sub = makeSub('users', { currentIds: ['d1'] });
      const delta = computer.computeDelta(
        sub,
        makeChange('update', 'd1', makeDoc('d1', { updated: true }))
      );
      expect(delta!.modified).toHaveLength(1);
    });
  });
});

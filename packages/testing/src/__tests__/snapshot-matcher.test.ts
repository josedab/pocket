import { describe, it, expect, beforeEach } from 'vitest';
import {
  SnapshotMatcher,
  createSnapshotMatcher,
  UUID_NORMALIZER,
  TIMESTAMP_NORMALIZER,
  EPOCH_NORMALIZER,
} from '../snapshot-matcher.js';

const sampleData = {
  users: [
    { _id: '1', name: 'Alice', email: 'alice@test.com', _rev: 'rev-1', updatedAt: '2024-01-01' },
    { _id: '2', name: 'Bob', email: 'bob@test.com', _rev: 'rev-2', updatedAt: '2024-01-02' },
  ],
  posts: [
    { _id: 'p1', title: 'Hello', authorId: '1' },
    { _id: 'p2', title: 'World', authorId: '2' },
  ],
};

describe('SnapshotMatcher', () => {
  let matcher: SnapshotMatcher;

  beforeEach(() => {
    matcher = createSnapshotMatcher();
  });

  describe('capture', () => {
    it('should capture database state', () => {
      const snapshot = matcher.capture(sampleData);
      expect(snapshot.meta.collectionCount).toBe(2);
      expect(snapshot.meta.totalDocuments).toBe(4);
      expect(snapshot.collections['users']?.count).toBe(2);
      expect(snapshot.collections['posts']?.count).toBe(2);
    });

    it('should strip configured fields', () => {
      const snapshot = matcher.capture(sampleData);
      const user = snapshot.collections['users']?.documents[0] as Record<string, unknown> | undefined;
      expect(user?.['_rev']).toBeUndefined();
      expect(user?.['updatedAt']).toBeUndefined();
      expect(user?.['name']).toBeDefined();
    });

    it('should sort documents by _id', () => {
      const unordered = {
        items: [
          { _id: 'c', value: 3 },
          { _id: 'a', value: 1 },
          { _id: 'b', value: 2 },
        ],
      };
      const snapshot = matcher.capture(unordered);
      const docs = snapshot.collections['items']?.documents as { _id: string }[];
      expect(docs?.[0]?._id).toBe('a');
      expect(docs?.[1]?._id).toBe('b');
      expect(docs?.[2]?._id).toBe('c');
    });

    it('should normalize timestamp with custom meta', () => {
      const snapshot = matcher.capture(sampleData);
      expect(snapshot.meta.timestamp).toBe('[TIMESTAMP]');
    });
  });

  describe('normalizers', () => {
    it('should apply UUID normalizer', () => {
      const uuidMatcher = createSnapshotMatcher({
        normalizers: [UUID_NORMALIZER],
      });
      const data = {
        items: [{ _id: 'abc123', ref: '550e8400-e29b-41d4-a716-446655440000' }],
      };
      const snapshot = uuidMatcher.capture(data);
      const doc = snapshot.collections['items']?.documents[0] as Record<string, unknown> | undefined;
      expect(doc?.['ref']).toBe('[UUID]');
    });

    it('should apply timestamp normalizer', () => {
      const tsMatcher = createSnapshotMatcher({
        normalizers: [TIMESTAMP_NORMALIZER],
      });
      const data = {
        items: [{ _id: '1', date: '2024-01-15T10:30:00.000Z' }],
      };
      const snapshot = tsMatcher.capture(data);
      const doc = snapshot.collections['items']?.documents[0] as Record<string, unknown> | undefined;
      expect(doc?.['date']).toBe('[TIMESTAMP]');
    });

    it('should apply epoch normalizer', () => {
      const epochMatcher = createSnapshotMatcher({
        normalizers: [EPOCH_NORMALIZER],
      });
      const data = {
        items: [{ _id: '1', ts: '1706000000000' }],
      };
      const snapshot = epochMatcher.capture(data);
      const doc = snapshot.collections['items']?.documents[0] as Record<string, unknown> | undefined;
      expect(doc?.['ts']).toBe('[EPOCH_MS]');
    });
  });

  describe('serialize/deserialize', () => {
    it('should round-trip through serialization', () => {
      const snapshot = matcher.capture(sampleData);
      const serialized = matcher.serialize(snapshot);
      const deserialized = matcher.deserialize(serialized);

      expect(deserialized.meta).toEqual(snapshot.meta);
      expect(deserialized.collections['users']?.count).toBe(2);
    });

    it('should pretty print by default', () => {
      const snapshot = matcher.capture(sampleData);
      const serialized = matcher.serialize(snapshot);
      expect(serialized).toContain('\n');
    });

    it('should compact when configured', () => {
      const compact = createSnapshotMatcher({ prettyPrint: false });
      const snapshot = compact.capture(sampleData);
      const serialized = compact.serialize(snapshot);
      expect(serialized).not.toContain('\n');
    });
  });

  describe('diff', () => {
    it('should detect matching snapshots', () => {
      const snap1 = matcher.capture(sampleData);
      const snap2 = matcher.capture(sampleData);
      const result = matcher.diff(snap1, snap2);
      expect(result.match).toBe(true);
      expect(result.summary).toBe('Snapshots match');
    });

    it('should detect added collections', () => {
      const snap1 = matcher.capture({ users: sampleData.users });
      const snap2 = matcher.capture(sampleData);
      const result = matcher.diff(snap1, snap2);
      expect(result.match).toBe(false);
      const postsDiff = result.collections.find((c) => c.name === 'posts');
      expect(postsDiff?.status).toBe('added');
    });

    it('should detect removed collections', () => {
      const snap1 = matcher.capture(sampleData);
      const snap2 = matcher.capture({ users: sampleData.users });
      const result = matcher.diff(snap1, snap2);
      const postsDiff = result.collections.find((c) => c.name === 'posts');
      expect(postsDiff?.status).toBe('removed');
    });

    it('should detect added documents', () => {
      const data1 = { users: [sampleData.users[0]!] };
      const data2 = { users: sampleData.users };
      const snap1 = matcher.capture(data1);
      const snap2 = matcher.capture(data2);
      const result = matcher.diff(snap1, snap2);
      const usersDiff = result.collections.find((c) => c.name === 'users');
      expect(usersDiff?.addedDocuments.length).toBeGreaterThan(0);
    });

    it('should detect modified documents', () => {
      const data1 = { users: [{ _id: '1', name: 'Alice' }] };
      const data2 = { users: [{ _id: '1', name: 'Alicia' }] };
      const snap1 = matcher.capture(data1);
      const snap2 = matcher.capture(data2);
      const result = matcher.diff(snap1, snap2);
      const usersDiff = result.collections.find((c) => c.name === 'users');
      expect(usersDiff?.modifiedDocuments).toHaveLength(1);
      expect(usersDiff?.modifiedDocuments[0]?.changes[0]?.path).toBe('name');
    });

    it('should handle nested object diffs', () => {
      const data1 = { items: [{ _id: '1', meta: { a: 1, b: 2 } }] };
      const data2 = { items: [{ _id: '1', meta: { a: 1, b: 3 } }] };
      const snap1 = matcher.capture(data1);
      const snap2 = matcher.capture(data2);
      const result = matcher.diff(snap1, snap2);
      const itemsDiff = result.collections.find((c) => c.name === 'items');
      expect(itemsDiff?.modifiedDocuments[0]?.changes[0]?.path).toBe('meta.b');
    });
  });

  describe('assertMatch', () => {
    it('should not throw for matching snapshots', () => {
      const snap1 = matcher.capture(sampleData);
      const snap2 = matcher.capture(sampleData);
      expect(() => matcher.assertMatch(snap1, snap2)).not.toThrow();
    });

    it('should throw with diff details for mismatching', () => {
      const snap1 = matcher.capture({ users: [{ _id: '1', name: 'Alice' }] });
      const snap2 = matcher.capture({ users: [{ _id: '1', name: 'Bob' }] });
      expect(() => matcher.assertMatch(snap1, snap2)).toThrow('Snapshot mismatch');
    });

    it('should include field-level details in error', () => {
      const snap1 = matcher.capture({ items: [{ _id: '1', val: 1 }] });
      const snap2 = matcher.capture({ items: [{ _id: '1', val: 2 }] });
      try {
        matcher.assertMatch(snap1, snap2);
      } catch (e) {
        expect((e as Error).message).toContain('val');
        expect((e as Error).message).toContain('1');
        expect((e as Error).message).toContain('2');
      }
    });
  });

  describe('custom strip fields', () => {
    it('should strip custom fields', () => {
      const custom = createSnapshotMatcher({ stripFields: ['secret', 'internal'] });
      const data = { items: [{ _id: '1', name: 'test', secret: 'hidden', internal: 42 }] };
      const snapshot = custom.capture(data);
      const doc = snapshot.collections['items']?.documents[0] as Record<string, unknown> | undefined;
      expect(doc?.['secret']).toBeUndefined();
      expect(doc?.['internal']).toBeUndefined();
      expect(doc?.['name']).toBe('test');
    });
  });
});

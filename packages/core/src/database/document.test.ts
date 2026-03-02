import { describe, expect, it } from 'vitest';
import type { Document, VectorClock } from '../types/document.js';
import {
  areConcurrent,
  cloneDocument,
  compareVectorClocks,
  documentsEqual,
  happenedBefore,
  mergeVectorClocks,
  prepareDocumentUpdate,
  prepareNewDocument,
  prepareSoftDelete,
  stripInternalFields,
} from './document.js';

describe('prepareNewDocument()', () => {
  it('should generate _id when not provided', () => {
    const doc = prepareNewDocument({ name: 'Alice' } as any);

    expect(doc._id).toBeDefined();
    expect(typeof doc._id).toBe('string');
    expect(doc._id.length).toBeGreaterThan(0);
  });

  it('should preserve custom _id', () => {
    const doc = prepareNewDocument({ _id: 'custom-id', name: 'Alice' } as any);

    expect(doc._id).toBe('custom-id');
  });

  it('should set initial _rev starting with 1-', () => {
    const doc = prepareNewDocument({ name: 'Alice' } as any);

    expect(doc._rev).toBeDefined();
    expect(doc._rev).toMatch(/^1-/);
  });

  it('should set _updatedAt timestamp', () => {
    const before = Date.now();
    const doc = prepareNewDocument({ name: 'Alice' } as any);
    const after = Date.now();

    expect(doc._updatedAt).toBeGreaterThanOrEqual(before);
    expect(doc._updatedAt).toBeLessThanOrEqual(after);
  });

  it('should initialize vector clock when nodeId provided', () => {
    const doc = prepareNewDocument({ name: 'Alice' } as any, 'node-1');

    expect(doc._vclock).toEqual({ 'node-1': 1 });
  });

  it('should not set vector clock when nodeId omitted', () => {
    const doc = prepareNewDocument({ name: 'Alice' } as any);

    expect(doc._vclock).toBeUndefined();
  });

  it('should preserve user data fields', () => {
    const doc = prepareNewDocument({ name: 'Alice', age: 30 } as any);

    expect(doc.name).toBe('Alice');
    expect((doc as any).age).toBe(30);
  });
});

describe('prepareDocumentUpdate()', () => {
  it('should merge changes into existing document', () => {
    const existing = {
      _id: '1',
      name: 'Alice',
      age: 30,
      _rev: '1-abc',
      _updatedAt: 1000,
    } as any;

    const updated = prepareDocumentUpdate(existing, { name: 'Alice Smith' } as any);

    expect(updated.name).toBe('Alice Smith');
    expect(updated.age).toBe(30);
    expect(updated._id).toBe('1');
  });

  it('should increment revision sequence', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
    } as any;

    const updated = prepareDocumentUpdate(existing, { name: 'Bob' } as any);

    expect(updated._rev).toMatch(/^2-/);
  });

  it('should update _updatedAt timestamp', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
    } as any;

    const before = Date.now();
    const updated = prepareDocumentUpdate(existing, {} as any);

    expect(updated._updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should preserve _id from existing document', () => {
    const existing = { _id: 'orig', _rev: '1-abc', _updatedAt: 1000 } as any;
    const updated = prepareDocumentUpdate(existing, { _id: 'changed' } as any);

    expect(updated._id).toBe('orig');
  });

  it('should increment vector clock for nodeId', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
      _vclock: { 'node-1': 1 },
    } as any;

    const updated = prepareDocumentUpdate(existing, { name: 'Bob' } as any, 'node-1');

    expect(updated._vclock).toEqual({ 'node-1': 2 });
  });

  it('should add new node entry to vector clock', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
      _vclock: { 'node-1': 1 },
    } as any;

    const updated = prepareDocumentUpdate(existing, {} as any, 'node-2');

    expect(updated._vclock).toEqual({ 'node-1': 1, 'node-2': 1 });
  });

  it('should not modify vector clock when nodeId omitted', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
      _vclock: { 'node-1': 1 },
    } as any;

    const updated = prepareDocumentUpdate(existing, {} as any);
    // Without nodeId, vclock is not updated
    expect(updated._vclock).toEqual({ 'node-1': 1 });
  });
});

describe('prepareSoftDelete()', () => {
  it('should set _deleted flag to true', () => {
    const existing = { _id: '1', name: 'Alice', _rev: '1-abc', _updatedAt: 1000 } as any;
    const deleted = prepareSoftDelete(existing);

    expect(deleted._deleted).toBe(true);
  });

  it('should increment revision', () => {
    const existing = { _id: '1', _rev: '2-abc', _updatedAt: 1000 } as any;
    const deleted = prepareSoftDelete(existing);

    expect(deleted._rev).toMatch(/^3-/);
  });

  it('should update _updatedAt timestamp', () => {
    const before = Date.now();
    const existing = { _id: '1', _rev: '1-abc', _updatedAt: 1000 } as any;
    const deleted = prepareSoftDelete(existing);

    expect(deleted._updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should strip user data fields', () => {
    const existing = { _id: '1', name: 'Alice', age: 30, _rev: '1-abc', _updatedAt: 1000 } as any;
    const deleted = prepareSoftDelete(existing);

    expect(deleted.name).toBeUndefined();
    expect(deleted.age).toBeUndefined();
    expect(deleted._id).toBe('1');
  });

  it('should update vector clock when nodeId provided', () => {
    const existing = {
      _id: '1',
      _rev: '1-abc',
      _updatedAt: 1000,
      _vclock: { 'node-1': 2 },
    } as any;

    const deleted = prepareSoftDelete(existing, 'node-1');

    expect(deleted._vclock).toEqual({ 'node-1': 3 });
  });
});

describe('mergeVectorClocks()', () => {
  it('should merge clocks taking max for each node', () => {
    const a: VectorClock = { 'node-1': 3, 'node-2': 1 };
    const b: VectorClock = { 'node-1': 2, 'node-3': 2 };

    const merged = mergeVectorClocks(a, b);

    expect(merged).toEqual({ 'node-1': 3, 'node-2': 1, 'node-3': 2 });
  });

  it('should handle empty clocks', () => {
    expect(mergeVectorClocks({}, {})).toEqual({});
    expect(mergeVectorClocks({ 'node-1': 1 }, {})).toEqual({ 'node-1': 1 });
    expect(mergeVectorClocks({}, { 'node-1': 1 })).toEqual({ 'node-1': 1 });
  });

  it('should handle identical clocks', () => {
    const clock = { 'node-1': 2, 'node-2': 3 };
    expect(mergeVectorClocks(clock, clock)).toEqual(clock);
  });
});

describe('compareVectorClocks()', () => {
  it('should return -1 when a happened before b', () => {
    const a: VectorClock = { 'node-1': 1, 'node-2': 1 };
    const b: VectorClock = { 'node-1': 2, 'node-2': 1 };

    expect(compareVectorClocks(a, b)).toBe(-1);
  });

  it('should return 1 when a happened after b', () => {
    const a: VectorClock = { 'node-1': 3, 'node-2': 2 };
    const b: VectorClock = { 'node-1': 2, 'node-2': 1 };

    expect(compareVectorClocks(a, b)).toBe(1);
  });

  it('should return 0 for concurrent clocks', () => {
    const a: VectorClock = { 'node-1': 2, 'node-2': 1 };
    const b: VectorClock = { 'node-1': 1, 'node-2': 2 };

    expect(compareVectorClocks(a, b)).toBe(0);
  });

  it('should return 0 for identical clocks', () => {
    const clock: VectorClock = { 'node-1': 1, 'node-2': 1 };
    expect(compareVectorClocks(clock, clock)).toBe(0);
  });

  it('should handle clocks with different node sets', () => {
    const a: VectorClock = { 'node-1': 1 };
    const b: VectorClock = { 'node-2': 1 };

    // a has node-1=1 vs 0, b has node-2=1 vs 0 → concurrent
    expect(compareVectorClocks(a, b)).toBe(0);
  });

  it('should handle empty clocks', () => {
    expect(compareVectorClocks({}, {})).toBe(0);
  });

  it('should handle one empty clock', () => {
    expect(compareVectorClocks({}, { 'node-1': 1 })).toBe(-1);
    expect(compareVectorClocks({ 'node-1': 1 }, {})).toBe(1);
  });
});

describe('happenedBefore()', () => {
  it('should return true when a causally before b (with vclocks)', () => {
    const a = { _id: '1', _vclock: { 'node-1': 1 } } as Document;
    const b = { _id: '1', _vclock: { 'node-1': 2 } } as Document;

    expect(happenedBefore(a, b)).toBe(true);
  });

  it('should return false when a after b', () => {
    const a = { _id: '1', _vclock: { 'node-1': 2 } } as Document;
    const b = { _id: '1', _vclock: { 'node-1': 1 } } as Document;

    expect(happenedBefore(a, b)).toBe(false);
  });

  it('should fall back to timestamp comparison without vclocks', () => {
    const a = { _id: '1', _updatedAt: 1000 } as Document;
    const b = { _id: '1', _updatedAt: 2000 } as Document;

    expect(happenedBefore(a, b)).toBe(true);
    expect(happenedBefore(b, a)).toBe(false);
  });

  it('should handle missing timestamps in fallback', () => {
    const a = { _id: '1' } as Document;
    const b = { _id: '1', _updatedAt: 1000 } as Document;

    expect(happenedBefore(a, b)).toBe(true);
  });
});

describe('areConcurrent()', () => {
  it('should return true for concurrent documents (with vclocks)', () => {
    const a = { _id: '1', _vclock: { 'node-1': 2, 'node-2': 1 } } as Document;
    const b = { _id: '1', _vclock: { 'node-1': 1, 'node-2': 2 } } as Document;

    expect(areConcurrent(a, b)).toBe(true);
  });

  it('should return false for causally ordered documents', () => {
    const a = { _id: '1', _vclock: { 'node-1': 1 } } as Document;
    const b = { _id: '1', _vclock: { 'node-1': 2 } } as Document;

    expect(areConcurrent(a, b)).toBe(false);
  });

  it('should compare revisions without vclocks', () => {
    const a = { _id: '1', _rev: '2-abc' } as Document;
    const b = { _id: '1', _rev: '2-xyz' } as Document;

    expect(areConcurrent(a, b)).toBe(true);
  });

  it('should not be concurrent when same revision', () => {
    const a = { _id: '1', _rev: '2-abc' } as Document;
    const b = { _id: '1', _rev: '2-abc' } as Document;

    expect(areConcurrent(a, b)).toBe(false);
  });

  it('should not be concurrent for different revision sequences', () => {
    const a = { _id: '1', _rev: '1-abc' } as Document;
    const b = { _id: '1', _rev: '2-abc' } as Document;

    expect(areConcurrent(a, b)).toBe(false);
  });
});

describe('cloneDocument()', () => {
  it('should create a deep clone', () => {
    const original = { _id: '1', data: { nested: true }, tags: ['a', 'b'] } as any;
    const cloned = cloneDocument(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.data).not.toBe(original.data);
    expect(cloned.tags).not.toBe(original.tags);
  });

  it('should not affect original when modifying clone', () => {
    const original = { _id: '1', data: { value: 1 } } as any;
    const cloned = cloneDocument(original);

    cloned.data.value = 999;
    expect(original.data.value).toBe(1);
  });
});

describe('stripInternalFields()', () => {
  it('should remove _rev, _updatedAt, _vclock', () => {
    const doc = {
      _id: '1',
      name: 'Alice',
      _rev: '2-abc',
      _updatedAt: 1234,
      _vclock: { 'node-1': 1 },
    } as any;

    const stripped = stripInternalFields(doc);

    expect(stripped._id).toBe('1');
    expect((stripped as any).name).toBe('Alice');
    expect((stripped as any)._rev).toBeUndefined();
    expect((stripped as any)._updatedAt).toBeUndefined();
    expect((stripped as any)._vclock).toBeUndefined();
  });

  it('should preserve _id and _deleted', () => {
    const doc = {
      _id: '1',
      _deleted: true,
      _rev: '3-xyz',
      _updatedAt: 5678,
    } as any;

    const stripped = stripInternalFields(doc);
    expect(stripped._id).toBe('1');
    expect((stripped as any)._deleted).toBe(true);
  });
});

describe('documentsEqual()', () => {
  it('should return true for same content with different metadata', () => {
    const a = { _id: '1', name: 'Alice', _rev: '1-abc', _updatedAt: 1000 } as any;
    const b = { _id: '1', name: 'Alice', _rev: '2-xyz', _updatedAt: 2000 } as any;

    expect(documentsEqual(a, b)).toBe(true);
  });

  it('should return false for different content', () => {
    const a = { _id: '1', name: 'Alice', _rev: '1-abc', _updatedAt: 1000 } as any;
    const b = { _id: '1', name: 'Bob', _rev: '1-abc', _updatedAt: 1000 } as any;

    expect(documentsEqual(a, b)).toBe(false);
  });

  it('should return false for different IDs', () => {
    const a = { _id: '1', name: 'Alice', _rev: '1-abc' } as any;
    const b = { _id: '2', name: 'Alice', _rev: '1-abc' } as any;

    expect(documentsEqual(a, b)).toBe(false);
  });

  it('should handle null/undefined fields', () => {
    const a = { _id: '1', field: null, _rev: '1-abc' } as any;
    const b = { _id: '1', field: null, _rev: '2-xyz' } as any;

    expect(documentsEqual(a, b)).toBe(true);
  });
});

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { ChangeEvent, Document } from '@pocket/core';
import { MaterializedView } from '../materialized-view.js';
import { ViewManager, createViewManager } from '../view-manager.js';
import { evaluateFilter, getNestedValue } from '../filter-evaluator.js';
import type { ViewDefinition, ViewDelta, ViewEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Test document type
// ---------------------------------------------------------------------------

interface TestDoc extends Document {
  _id: string;
  name: string;
  status: 'active' | 'inactive' | 'pending';
  age: number;
  tags?: string[];
  address?: {
    city: string;
    country: string;
  };
  score?: number;
  _rev?: string;
  _deleted?: boolean;
  _updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Helper: create change events
// ---------------------------------------------------------------------------

let sequenceCounter = 0;

function makeInsert(doc: TestDoc): ChangeEvent<TestDoc> {
  return {
    operation: 'insert',
    documentId: doc._id,
    document: doc,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: ++sequenceCounter,
  };
}

function makeUpdate(
  doc: TestDoc,
  previousDoc: TestDoc
): ChangeEvent<TestDoc> {
  return {
    operation: 'update',
    documentId: doc._id,
    document: doc,
    previousDocument: previousDoc,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: ++sequenceCounter,
  };
}

function makeDelete(docId: string, previousDoc?: TestDoc): ChangeEvent<TestDoc> {
  return {
    operation: 'delete',
    documentId: docId,
    document: null,
    previousDocument: previousDoc,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: ++sequenceCounter,
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function sampleDocs(): TestDoc[] {
  return [
    { _id: '1', name: 'Alice', status: 'active', age: 30, score: 95 },
    { _id: '2', name: 'Bob', status: 'inactive', age: 25, score: 80 },
    { _id: '3', name: 'Charlie', status: 'active', age: 35, score: 88 },
    { _id: '4', name: 'Diana', status: 'pending', age: 28, score: 92 },
    { _id: '5', name: 'Eve', status: 'active', age: 22, score: 75 },
  ];
}

// ===========================================================================
// FilterEvaluator Tests
// ===========================================================================

describe('FilterEvaluator', () => {
  describe('evaluateFilter', () => {
    it('should match all documents when filter is empty', () => {
      const doc = { _id: '1', name: 'Alice' };
      expect(evaluateFilter(doc, {})).toBe(true);
      expect(evaluateFilter(doc, undefined)).toBe(true);
    });

    it('should match simple equality', () => {
      const doc = { _id: '1', name: 'Alice', status: 'active' };
      expect(evaluateFilter(doc, { status: 'active' })).toBe(true);
      expect(evaluateFilter(doc, { status: 'inactive' })).toBe(false);
    });

    it('should match numeric equality', () => {
      const doc = { _id: '1', age: 30 };
      expect(evaluateFilter(doc, { age: 30 })).toBe(true);
      expect(evaluateFilter(doc, { age: 25 })).toBe(false);
    });

    describe('comparison operators', () => {
      const doc = { _id: '1', age: 30, name: 'Alice' };

      it('should evaluate $eq', () => {
        expect(evaluateFilter(doc, { age: { $eq: 30 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $eq: 25 } })).toBe(false);
      });

      it('should evaluate $ne', () => {
        expect(evaluateFilter(doc, { age: { $ne: 25 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $ne: 30 } })).toBe(false);
      });

      it('should evaluate $gt', () => {
        expect(evaluateFilter(doc, { age: { $gt: 25 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $gt: 30 } })).toBe(false);
        expect(evaluateFilter(doc, { age: { $gt: 35 } })).toBe(false);
      });

      it('should evaluate $gte', () => {
        expect(evaluateFilter(doc, { age: { $gte: 30 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $gte: 25 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $gte: 35 } })).toBe(false);
      });

      it('should evaluate $lt', () => {
        expect(evaluateFilter(doc, { age: { $lt: 35 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $lt: 30 } })).toBe(false);
      });

      it('should evaluate $lte', () => {
        expect(evaluateFilter(doc, { age: { $lte: 30 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $lte: 35 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $lte: 25 } })).toBe(false);
      });

      it('should evaluate $in', () => {
        expect(evaluateFilter(doc, { age: { $in: [25, 30, 35] } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $in: [25, 35] } })).toBe(false);
      });

      it('should evaluate $nin', () => {
        expect(evaluateFilter(doc, { age: { $nin: [25, 35] } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $nin: [25, 30, 35] } })).toBe(false);
      });

      it('should evaluate combined operators', () => {
        expect(evaluateFilter(doc, { age: { $gte: 25, $lte: 35 } })).toBe(true);
        expect(evaluateFilter(doc, { age: { $gt: 30, $lt: 40 } })).toBe(false);
      });
    });

    describe('$exists operator', () => {
      const doc = { _id: '1', name: 'Alice', optional: undefined };

      it('should match existing fields', () => {
        expect(evaluateFilter(doc, { name: { $exists: true } })).toBe(true);
      });

      it('should match missing fields', () => {
        expect(evaluateFilter(doc, { missing: { $exists: false } })).toBe(true);
        expect(evaluateFilter(doc, { missing: { $exists: true } })).toBe(false);
      });
    });

    describe('$regex operator', () => {
      const doc = { _id: '1', name: 'Alice Johnson', email: 'alice@example.com' };

      it('should match with RegExp object', () => {
        expect(evaluateFilter(doc, { name: { $regex: /alice/i } })).toBe(true);
        expect(evaluateFilter(doc, { name: { $regex: /bob/i } })).toBe(false);
      });

      it('should match with string pattern', () => {
        expect(evaluateFilter(doc, { name: { $regex: 'Alice' } })).toBe(true);
        expect(evaluateFilter(doc, { email: { $regex: '@example\\.com$' } })).toBe(true);
      });

      it('should return false for non-string fields', () => {
        const numDoc = { _id: '1', count: 42 };
        expect(evaluateFilter(numDoc, { count: { $regex: '42' } })).toBe(false);
      });
    });

    describe('logical operators', () => {
      const doc = { _id: '1', name: 'Alice', age: 30, status: 'active' };

      it('should evaluate $and', () => {
        expect(
          evaluateFilter(doc, {
            $and: [{ age: { $gte: 25 } }, { status: 'active' }],
          })
        ).toBe(true);
        expect(
          evaluateFilter(doc, {
            $and: [{ age: { $gte: 25 } }, { status: 'inactive' }],
          })
        ).toBe(false);
      });

      it('should evaluate $or', () => {
        expect(
          evaluateFilter(doc, {
            $or: [{ status: 'inactive' }, { age: 30 }],
          })
        ).toBe(true);
        expect(
          evaluateFilter(doc, {
            $or: [{ status: 'inactive' }, { age: 25 }],
          })
        ).toBe(false);
      });

      it('should evaluate $not', () => {
        expect(
          evaluateFilter(doc, { $not: { status: 'inactive' } })
        ).toBe(true);
        expect(
          evaluateFilter(doc, { $not: { status: 'active' } })
        ).toBe(false);
      });

      it('should evaluate nested logical operators', () => {
        expect(
          evaluateFilter(doc, {
            $and: [
              { $or: [{ status: 'active' }, { status: 'pending' }] },
              { age: { $gte: 25 } },
            ],
          })
        ).toBe(true);
      });
    });

    describe('nested field access', () => {
      const doc = {
        _id: '1',
        profile: {
          name: 'Alice',
          address: {
            city: 'Portland',
            state: 'OR',
          },
        },
      };

      it('should access nested fields with dot notation', () => {
        expect(evaluateFilter(doc, { 'profile.name': 'Alice' })).toBe(true);
        expect(evaluateFilter(doc, { 'profile.address.city': 'Portland' })).toBe(true);
        expect(evaluateFilter(doc, { 'profile.address.city': 'Seattle' })).toBe(false);
      });

      it('should handle missing nested paths', () => {
        expect(evaluateFilter(doc, { 'profile.missing.field': { $exists: false } })).toBe(true);
      });
    });
  });

  describe('getNestedValue', () => {
    it('should get top-level values', () => {
      expect(getNestedValue({ name: 'Alice' }, 'name')).toBe('Alice');
    });

    it('should get deeply nested values', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(getNestedValue(obj, 'a.b.c')).toBe(42);
    });

    it('should return undefined for missing paths', () => {
      expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined();
      expect(getNestedValue({ a: { b: 1 } }, 'a.c')).toBeUndefined();
    });

    it('should handle null and undefined objects', () => {
      expect(getNestedValue(null, 'a')).toBeUndefined();
      expect(getNestedValue(undefined, 'a')).toBeUndefined();
    });
  });
});

// ===========================================================================
// MaterializedView Tests
// ===========================================================================

describe('MaterializedView', () => {
  describe('creation and initialization', () => {
    it('should create an empty view', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      expect(view.getName()).toBe('test-view');
      expect(view.getCollection()).toBe('users');
      expect(view.getResults()).toEqual([]);
      expect(view.getResultIds().size).toBe(0);
    });

    it('should initialize from a collection of documents', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'all-users',
        collection: 'users',
      });

      view.initialize(sampleDocs());

      expect(view.getResults()).toHaveLength(5);
      expect(view.getResultIds().size).toBe(5);
    });

    it('should initialize with filter', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'active')).toBe(true);
    });

    it('should initialize with sort', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'sorted-users',
        collection: 'users',
        sort: { name: 'asc' },
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results.map((r) => r.name)).toEqual([
        'Alice', 'Bob', 'Charlie', 'Diana', 'Eve',
      ]);
    });

    it('should initialize with descending sort', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'sorted-desc',
        collection: 'users',
        sort: { age: 'desc' },
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results.map((r) => r.age)).toEqual([35, 30, 28, 25, 22]);
    });

    it('should initialize with limit', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'top-users',
        collection: 'users',
        sort: { score: 'desc' },
        limit: 3,
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.score)).toEqual([95, 92, 88]);
    });

    it('should initialize with filter, sort, and limit combined', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'top-active',
        collection: 'users',
        filter: { status: 'active' },
        sort: { score: 'desc' },
        limit: 2,
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Charlie');
    });

    it('should initialize with projection', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'projected-users',
        collection: 'users',
        projection: { name: 1, status: 1 },
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      expect(results).toHaveLength(5);
      // Should have _id (always included), name, status
      const first = results[0]!;
      expect(first._id).toBeDefined();
      expect(first.name).toBeDefined();
      expect(first.status).toBeDefined();
      // Other fields should not be present
      expect((first as Record<string, unknown>).age).toBeUndefined();
      expect((first as Record<string, unknown>).score).toBeUndefined();
    });
  });

  describe('incremental insert', () => {
    let view: MaterializedView<TestDoc>;

    beforeEach(() => {
      view = new MaterializedView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
        sort: { name: 'asc' },
      });
      view.initialize(sampleDocs());
    });

    afterEach(() => {
      view.dispose();
    });

    it('should add document that matches filter', () => {
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
        score: 90,
      };

      const delta = view.applyChange(makeInsert(newDoc));

      expect(delta.added).toHaveLength(1);
      expect(delta.added[0]!._id).toBe('6');
      expect(delta.removed).toHaveLength(0);
      expect(delta.modified).toHaveLength(0);

      const results = view.getResults();
      expect(results).toHaveLength(4);
      expect(view.getResultIds().has('6')).toBe(true);
    });

    it('should not add document that does not match filter', () => {
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'inactive',
        age: 40,
        score: 90,
      };

      const delta = view.applyChange(makeInsert(newDoc));

      expect(delta.added).toHaveLength(0);
      expect(delta.removed).toHaveLength(0);
      expect(delta.modified).toHaveLength(0);

      expect(view.getResults()).toHaveLength(3);
      expect(view.getResultIds().has('6')).toBe(false);
    });

    it('should insert in correct sorted position', () => {
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Brian',
        status: 'active',
        age: 27,
        score: 85,
      };

      view.applyChange(makeInsert(newDoc));

      const results = view.getResults();
      const names = results.map((r) => r.name);
      // Alice, Brian, Charlie, Eve (sorted asc by name)
      expect(names).toEqual(['Alice', 'Brian', 'Charlie', 'Eve']);
    });
  });

  describe('incremental update', () => {
    let view: MaterializedView<TestDoc>;

    beforeEach(() => {
      view = new MaterializedView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
        sort: { name: 'asc' },
      });
      view.initialize(sampleDocs());
    });

    afterEach(() => {
      view.dispose();
    });

    it('should handle document entering the view (status changes to active)', () => {
      const oldDoc = sampleDocs().find((d) => d._id === '2')!; // Bob, inactive
      const updatedDoc: TestDoc = { ...oldDoc, status: 'active' };

      const delta = view.applyChange(makeUpdate(updatedDoc, oldDoc));

      expect(delta.added).toHaveLength(1);
      expect(delta.added[0]!._id).toBe('2');
      expect(delta.removed).toHaveLength(0);

      const results = view.getResults();
      expect(results).toHaveLength(4);
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie', 'Eve']);
    });

    it('should handle document leaving the view (status changes to inactive)', () => {
      const oldDoc = sampleDocs().find((d) => d._id === '1')!; // Alice, active
      const updatedDoc: TestDoc = { ...oldDoc, status: 'inactive' };

      const delta = view.applyChange(makeUpdate(updatedDoc, oldDoc));

      expect(delta.removed).toHaveLength(1);
      expect(delta.removed[0]!._id).toBe('1');
      expect(delta.added).toHaveLength(0);

      const results = view.getResults();
      expect(results).toHaveLength(2);
      expect(view.getResultIds().has('1')).toBe(false);
    });

    it('should handle document staying in view with data change', () => {
      const oldDoc = sampleDocs().find((d) => d._id === '1')!; // Alice, active
      const updatedDoc: TestDoc = { ...oldDoc, age: 31 };

      const delta = view.applyChange(makeUpdate(updatedDoc, oldDoc));

      expect(delta.modified).toHaveLength(1);
      expect(delta.modified[0]!.before.age).toBe(30);
      expect(delta.modified[0]!.after.age).toBe(31);

      expect(view.getResults()).toHaveLength(3);
    });

    it('should handle document staying in view with sort position change', () => {
      // Eve is currently last alphabetically; rename to "Aaron" to move first
      const oldDoc = sampleDocs().find((d) => d._id === '5')!; // Eve
      const updatedDoc: TestDoc = { ...oldDoc, name: 'Aaron' };

      const delta = view.applyChange(makeUpdate(updatedDoc, oldDoc));

      expect(delta.modified).toHaveLength(1);

      const results = view.getResults();
      expect(results[0]!.name).toBe('Aaron');
      expect(results.map((r) => r.name)).toEqual(['Aaron', 'Alice', 'Charlie']);
    });

    it('should not affect view when updating non-matching document', () => {
      const oldDoc = sampleDocs().find((d) => d._id === '2')!; // Bob, inactive
      const updatedDoc: TestDoc = { ...oldDoc, age: 26 };

      const delta = view.applyChange(makeUpdate(updatedDoc, oldDoc));

      expect(delta.added).toHaveLength(0);
      expect(delta.removed).toHaveLength(0);
      expect(delta.modified).toHaveLength(0);

      expect(view.getResults()).toHaveLength(3);
    });
  });

  describe('incremental delete', () => {
    let view: MaterializedView<TestDoc>;

    beforeEach(() => {
      view = new MaterializedView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
        sort: { name: 'asc' },
      });
      view.initialize(sampleDocs());
    });

    afterEach(() => {
      view.dispose();
    });

    it('should remove document from results when deleted', () => {
      const doc = sampleDocs().find((d) => d._id === '1')!; // Alice, active

      const delta = view.applyChange(makeDelete('1', doc));

      expect(delta.removed).toHaveLength(1);
      expect(delta.removed[0]!._id).toBe('1');

      const results = view.getResults();
      expect(results).toHaveLength(2);
      expect(view.getResultIds().has('1')).toBe(false);
    });

    it('should not affect view when deleting non-matching document', () => {
      const doc = sampleDocs().find((d) => d._id === '2')!; // Bob, inactive

      const delta = view.applyChange(makeDelete('2', doc));

      expect(delta.removed).toHaveLength(0);
      expect(view.getResults()).toHaveLength(3);
    });
  });

  describe('sorted view maintenance', () => {
    it('should maintain ascending order after multiple inserts', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'sorted-age',
        collection: 'users',
        sort: { age: 'asc' },
      });

      view.initialize([]);

      // Insert in random order
      const docs: TestDoc[] = [
        { _id: '3', name: 'Charlie', status: 'active', age: 35 },
        { _id: '1', name: 'Alice', status: 'active', age: 30 },
        { _id: '5', name: 'Eve', status: 'active', age: 22 },
        { _id: '2', name: 'Bob', status: 'active', age: 25 },
        { _id: '4', name: 'Diana', status: 'active', age: 28 },
      ];

      for (const doc of docs) {
        view.applyChange(makeInsert(doc));
      }

      const results = view.getResults();
      expect(results.map((r) => r.age)).toEqual([22, 25, 28, 30, 35]);

      view.dispose();
    });

    it('should maintain descending order after updates and deletes', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'sorted-score-desc',
        collection: 'users',
        sort: { score: 'desc' },
      });

      view.initialize(sampleDocs());

      // Verify initial order
      expect(view.getResults().map((r) => r.score)).toEqual([95, 92, 88, 80, 75]);

      // Update Eve's score to 99 (should become first)
      const eve = sampleDocs().find((d) => d._id === '5')!;
      view.applyChange(makeUpdate({ ...eve, score: 99 }, eve));

      expect(view.getResults().map((r) => r.score)).toEqual([99, 95, 92, 88, 80]);

      // Delete Alice (score 95)
      view.applyChange(makeDelete('1'));

      expect(view.getResults().map((r) => r.score)).toEqual([99, 92, 88, 80]);

      view.dispose();
    });

    it('should handle multi-field sort', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'multi-sort',
        collection: 'users',
        sort: { status: 'asc', name: 'asc' },
      });

      view.initialize(sampleDocs());

      const results = view.getResults();
      // active: Alice, Charlie, Eve; inactive: Bob; pending: Diana
      expect(results.map((r) => `${r.status}:${r.name}`)).toEqual([
        'active:Alice',
        'active:Charlie',
        'active:Eve',
        'inactive:Bob',
        'pending:Diana',
      ]);

      view.dispose();
    });
  });

  describe('limit enforcement', () => {
    it('should respect limit during initialization', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'limited',
        collection: 'users',
        sort: { score: 'desc' },
        limit: 3,
      });

      view.initialize(sampleDocs());

      expect(view.getResults()).toHaveLength(3);
      expect(view.getResults().map((r) => r.score)).toEqual([95, 92, 88]);

      view.dispose();
    });

    it('should evict lowest-ranked document when inserting past limit', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'top-3',
        collection: 'users',
        sort: { score: 'desc' },
        limit: 3,
      });

      view.initialize(sampleDocs());
      // Initial: [95, 92, 88]

      // Insert a doc with score 90 (should push out 88)
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
        score: 90,
      };
      const delta = view.applyChange(makeInsert(newDoc));

      expect(view.getResults()).toHaveLength(3);
      expect(view.getResults().map((r) => r.score)).toEqual([95, 92, 90]);
      expect(delta.added).toHaveLength(1);
      expect(delta.removed).toHaveLength(1);
      expect(delta.removed[0]!.score).toBe(88);

      view.dispose();
    });

    it('should not add document that would be immediately evicted', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'top-3',
        collection: 'users',
        sort: { score: 'desc' },
        limit: 3,
      });

      view.initialize(sampleDocs());
      // Initial: [95, 92, 88]

      // Insert a doc with score 70 (below all current scores, should be evicted)
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
        score: 70,
      };
      const delta = view.applyChange(makeInsert(newDoc));

      expect(view.getResults()).toHaveLength(3);
      // Neither added nor removed from delta perspective
      expect(delta.added).toHaveLength(0);
      expect(delta.removed).toHaveLength(0);

      view.dispose();
    });
  });

  describe('view stats', () => {
    it('should track hit count', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'stats-test',
        collection: 'users',
      });

      view.initialize(sampleDocs());

      expect(view.getStats().hitCount).toBe(0);

      view.getResults();
      expect(view.getStats().hitCount).toBe(1);

      view.getResults();
      view.getResults();
      expect(view.getStats().hitCount).toBe(3);

      view.dispose();
    });

    it('should track result count', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'stats-test',
        collection: 'users',
        filter: { status: 'active' },
      });

      view.initialize(sampleDocs());

      expect(view.getStats().resultCount).toBe(3);

      view.dispose();
    });

    it('should track update timing', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'stats-test',
        collection: 'users',
      });

      view.initialize(sampleDocs());

      // Apply a change to generate timing data
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
      };
      view.applyChange(makeInsert(newDoc));

      const stats = view.getStats();
      expect(stats.avgUpdateTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.name).toBe('stats-test');

      view.dispose();
    });

    it('should report lastUpdated timestamp', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'stats-test',
        collection: 'users',
      });

      view.initialize(sampleDocs());

      const stats = view.getStats();
      expect(stats.lastUpdated).toBeGreaterThan(0);
      expect(stats.lastUpdated).toBeLessThanOrEqual(Date.now());

      view.dispose();
    });
  });

  describe('observable', () => {
    it('should emit results on subscription', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'observable-test',
        collection: 'users',
        filter: { status: 'active' },
        sort: { name: 'asc' },
      });

      view.initialize(sampleDocs());

      const emissions: TestDoc[][] = [];
      const sub = view.toObservable().subscribe((results) => {
        emissions.push(results);
      });

      // Should have received initial emission
      expect(emissions.length).toBeGreaterThanOrEqual(1);
      expect(emissions[emissions.length - 1]!).toHaveLength(3);

      // Apply a change
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Brian',
        status: 'active',
        age: 27,
      };
      view.applyChange(makeInsert(newDoc));

      // Should have received updated emission
      expect(emissions[emissions.length - 1]!).toHaveLength(4);

      sub.unsubscribe();
      view.dispose();
    });
  });

  describe('dispose', () => {
    it('should complete the observable on dispose', () => {
      const view = new MaterializedView<TestDoc>({
        name: 'dispose-test',
        collection: 'users',
      });

      view.initialize(sampleDocs());

      let completed = false;
      const sub = view.toObservable().subscribe({
        complete: () => {
          completed = true;
        },
      });

      view.dispose();

      // The shareReplay + takeUntil might delay completion,
      // but subsequent subscriptions should not receive emissions
      sub.unsubscribe();
    });
  });
});

// ===========================================================================
// ViewManager Tests
// ===========================================================================

describe('ViewManager', () => {
  let manager: ViewManager;

  beforeEach(() => {
    manager = createViewManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('createView', () => {
    it('should create and register a view', () => {
      const view = manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
        filter: { status: 'active' },
      });

      expect(view).toBeDefined();
      expect(view.getName()).toBe('test-view');
    });

    it('should throw when creating duplicate view name', () => {
      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      expect(() =>
        manager.createView<TestDoc>({
          name: 'test-view',
          collection: 'users',
        })
      ).toThrow('View "test-view" already exists');
    });

    it('should throw when manager is disposed', () => {
      manager.dispose();

      expect(() =>
        manager.createView<TestDoc>({
          name: 'test-view',
          collection: 'users',
        })
      ).toThrow('ViewManager has been disposed');
    });
  });

  describe('getView', () => {
    it('should retrieve an existing view', () => {
      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      const view = manager.getView<TestDoc>('test-view');
      expect(view).toBeDefined();
      expect(view!.getName()).toBe('test-view');
    });

    it('should return undefined for non-existent view', () => {
      expect(manager.getView('non-existent')).toBeUndefined();
    });
  });

  describe('dropView', () => {
    it('should remove a view', () => {
      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      manager.dropView('test-view');

      expect(manager.getView('test-view')).toBeUndefined();
    });

    it('should throw when dropping non-existent view', () => {
      expect(() => manager.dropView('non-existent')).toThrow(
        'View "non-existent" does not exist'
      );
    });

    it('should allow recreating a dropped view', () => {
      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      manager.dropView('test-view');

      const view = manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      expect(view).toBeDefined();
    });
  });

  describe('listViews', () => {
    it('should list all view stats', () => {
      const view1 = manager.createView<TestDoc>({
        name: 'view-1',
        collection: 'users',
        filter: { status: 'active' },
      });
      view1.initialize(sampleDocs());

      const view2 = manager.createView<TestDoc>({
        name: 'view-2',
        collection: 'orders',
      });

      const stats = manager.listViews();
      expect(stats).toHaveLength(2);
      expect(stats.map((s) => s.name).sort()).toEqual(['view-1', 'view-2']);

      const view1Stats = stats.find((s) => s.name === 'view-1')!;
      expect(view1Stats.resultCount).toBe(3);
    });

    it('should return empty array when no views exist', () => {
      expect(manager.listViews()).toEqual([]);
    });
  });

  describe('processChange - routing', () => {
    it('should route changes to the correct view by collection', () => {
      const usersView = manager.createView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
        sort: { name: 'asc' },
      });
      usersView.initialize(sampleDocs());

      const ordersView = manager.createView<TestDoc>({
        name: 'orders',
        collection: 'orders',
      });
      ordersView.initialize([]);

      // Process a user change
      const newUser: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
      };

      manager.processChange('users', makeInsert(newUser) as ChangeEvent<Document>);

      // Users view should be updated
      expect(usersView.getResults()).toHaveLength(4);
      expect(usersView.getResultIds().has('6')).toBe(true);

      // Orders view should be unaffected
      expect(ordersView.getResults()).toHaveLength(0);
    });

    it('should route changes to multiple views on the same collection', () => {
      const activeView = manager.createView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      });
      activeView.initialize(sampleDocs());

      const allView = manager.createView<TestDoc>({
        name: 'all-users',
        collection: 'users',
      });
      allView.initialize(sampleDocs());

      const newUser: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
      };

      manager.processChange('users', makeInsert(newUser) as ChangeEvent<Document>);

      // Both views should be updated
      expect(activeView.getResults()).toHaveLength(4);
      expect(allView.getResults()).toHaveLength(6);
    });

    it('should handle changes to collections with no views', () => {
      manager.createView<TestDoc>({
        name: 'users-view',
        collection: 'users',
      });

      // Should not throw
      const newOrder: TestDoc = {
        _id: 'o1',
        name: 'Order 1',
        status: 'active',
        age: 0,
      };
      manager.processChange('orders', makeInsert(newOrder) as ChangeEvent<Document>);
    });
  });

  describe('events', () => {
    it('should emit view:created event', () => {
      const events: ViewEvent[] = [];
      manager.events().subscribe((e) => events.push(e));

      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('view:created');
      expect(events[0]!.name).toBe('test-view');
    });

    it('should emit view:dropped event', () => {
      const events: ViewEvent[] = [];
      manager.events().subscribe((e) => events.push(e));

      manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
      });
      manager.dropView('test-view');

      expect(events).toHaveLength(2);
      expect(events[1]!.type).toBe('view:dropped');
      expect(events[1]!.name).toBe('test-view');
    });

    it('should emit view:updated event when view changes', () => {
      const events: ViewEvent[] = [];
      manager.events().subscribe((e) => events.push(e));

      const view = manager.createView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      });
      view.initialize(sampleDocs());

      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'active',
        age: 40,
      };
      manager.processChange('users', makeInsert(newDoc) as ChangeEvent<Document>);

      // Should have: view:created, view:updated
      const updateEvents = events.filter((e) => e.type === 'view:updated');
      expect(updateEvents).toHaveLength(1);
      expect(updateEvents[0]!.type).toBe('view:updated');
      expect(updateEvents[0]!.name).toBe('active-users');

      if (updateEvents[0]!.type === 'view:updated') {
        expect(updateEvents[0]!.delta.added).toHaveLength(1);
      }
    });

    it('should not emit view:updated when change does not affect view', () => {
      const events: ViewEvent[] = [];
      manager.events().subscribe((e) => events.push(e));

      const view = manager.createView<TestDoc>({
        name: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      });
      view.initialize(sampleDocs());

      // Insert inactive user (should not match filter)
      const newDoc: TestDoc = {
        _id: '6',
        name: 'Frank',
        status: 'inactive',
        age: 40,
      };
      manager.processChange('users', makeInsert(newDoc) as ChangeEvent<Document>);

      const updateEvents = events.filter((e) => e.type === 'view:updated');
      expect(updateEvents).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should dispose all views and stop processing', () => {
      const view = manager.createView<TestDoc>({
        name: 'test-view',
        collection: 'users',
        filter: { status: 'active' },
      });
      view.initialize(sampleDocs());

      manager.dispose();

      expect(manager.getView('test-view')).toBeUndefined();
      expect(manager.listViews()).toEqual([]);
    });
  });
});

// ===========================================================================
// Integration: end-to-end incremental view maintenance
// ===========================================================================

describe('Integration: end-to-end view maintenance', () => {
  it('should maintain a view through a full lifecycle of changes', () => {
    const manager = createViewManager();

    const view = manager.createView<TestDoc>({
      name: 'active-sorted',
      collection: 'users',
      filter: { status: 'active' },
      sort: { name: 'asc' },
    });

    // Initialize with sample data
    view.initialize(sampleDocs());
    expect(view.getResults().map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve']);

    // Insert: active user "Brian"
    const brian: TestDoc = { _id: '6', name: 'Brian', status: 'active', age: 27 };
    manager.processChange('users', makeInsert(brian) as ChangeEvent<Document>);
    expect(view.getResults().map((r) => r.name)).toEqual(['Alice', 'Brian', 'Charlie', 'Eve']);

    // Update: Bob becomes active
    const bob = sampleDocs().find((d) => d._id === '2')!;
    manager.processChange('users', makeUpdate({ ...bob, status: 'active' }, bob) as ChangeEvent<Document>);
    expect(view.getResults().map((r) => r.name)).toEqual(['Alice', 'Bob', 'Brian', 'Charlie', 'Eve']);

    // Update: Alice becomes inactive
    const alice = sampleDocs().find((d) => d._id === '1')!;
    manager.processChange('users', makeUpdate({ ...alice, status: 'inactive' }, alice) as ChangeEvent<Document>);
    expect(view.getResults().map((r) => r.name)).toEqual(['Bob', 'Brian', 'Charlie', 'Eve']);

    // Delete: Charlie removed
    manager.processChange('users', makeDelete('3') as ChangeEvent<Document>);
    expect(view.getResults().map((r) => r.name)).toEqual(['Bob', 'Brian', 'Eve']);

    // Verify stats
    const stats = view.getStats();
    expect(stats.resultCount).toBe(3);
    expect(stats.name).toBe('active-sorted');

    manager.dispose();
  });

  it('should maintain a limited view correctly through changes', () => {
    const manager = createViewManager();

    const view = manager.createView<TestDoc>({
      name: 'top-2-active',
      collection: 'users',
      filter: { status: 'active' },
      sort: { score: 'desc' },
      limit: 2,
    });

    view.initialize(sampleDocs());
    // Active users: Alice(95), Charlie(88), Eve(75). Top 2: Alice, Charlie
    expect(view.getResults().map((r) => r.name)).toEqual(['Alice', 'Charlie']);

    // Insert user with score 90 (should push out Charlie)
    const frank: TestDoc = { _id: '6', name: 'Frank', status: 'active', age: 40, score: 90 };
    manager.processChange('users', makeInsert(frank) as ChangeEvent<Document>);
    expect(view.getResults().map((r) => r.name)).toEqual(['Alice', 'Frank']);

    // Delete Alice -> Charlie should not re-enter (we don't have the full collection)
    // The view only has the documents it knows about
    manager.processChange('users', makeDelete('1') as ChangeEvent<Document>);
    expect(view.getResults()).toHaveLength(1);
    expect(view.getResults()[0]!.name).toBe('Frank');

    manager.dispose();
  });
});

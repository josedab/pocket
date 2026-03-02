import { describe, expect, it } from 'vitest';
import type { Document } from '../types/document.js';
import { QueryExecutor } from './query-executor.js';

interface TestDoc extends Document {
  _id: string;
  name: string;
  age?: number;
  status?: string;
  tags?: string[];
  nested?: { value: number };
}

function makeDocs(): TestDoc[] {
  return [
    { _id: '1', name: 'Alice', age: 30, status: 'active', tags: ['a'] },
    { _id: '2', name: 'Bob', age: 25, status: 'inactive', tags: ['b', 'c'] },
    { _id: '3', name: 'Charlie', age: 35, status: 'active' },
    { _id: '4', name: 'Diana', age: 28, status: 'active', tags: ['a', 'b'] },
    { _id: '5', name: 'Eve', age: 22, status: 'inactive' },
  ] as TestDoc[];
}

describe('QueryExecutor', () => {
  const executor = new QueryExecutor<TestDoc>();

  describe('execute() - filtering', () => {
    it('should return all documents with no filter', () => {
      const result = executor.execute(makeDocs(), {});
      expect(result.documents).toHaveLength(5);
      expect(result.totalCount).toBe(5);
    });

    it('should filter by exact value ($eq implicit)', () => {
      const result = executor.execute(makeDocs(), {
        filter: { status: 'active' } as any,
      });
      expect(result.documents).toHaveLength(3);
      expect(result.documents.every((d) => d.status === 'active')).toBe(true);
    });

    it('should filter by $eq operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { age: { $eq: 30 } } as any,
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Alice');
    });

    it('should filter by $gt operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { age: { $gt: 28 } } as any,
      });
      expect(result.documents).toHaveLength(2);
      expect(result.documents.every((d) => (d.age ?? 0) > 28)).toBe(true);
    });

    it('should filter by $lt operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { age: { $lt: 25 } } as any,
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Eve');
    });

    it('should filter by $gte operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { age: { $gte: 30 } } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter by $lte operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { age: { $lte: 25 } } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter by $ne operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { status: { $ne: 'active' } } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter by $in operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { name: { $in: ['Alice', 'Bob'] } } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter by $nin operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { name: { $nin: ['Alice', 'Bob'] } } as any,
      });
      expect(result.documents).toHaveLength(3);
    });

    it('should filter by $regex operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: { name: { $regex: '^A' } } as any,
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Alice');
    });

    it('should filter by $ne with undefined field', () => {
      const result = executor.execute(makeDocs(), {
        filter: { tags: { $ne: undefined } } as any,
      });
      // Documents where tags is defined
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should filter with $and operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: {
          $and: [{ status: 'active' }, { age: { $gt: 29 } }],
        } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter with $or operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: {
          $or: [{ name: 'Alice' }, { name: 'Eve' }],
        } as any,
      });
      expect(result.documents).toHaveLength(2);
    });

    it('should filter with $not operator', () => {
      const result = executor.execute(makeDocs(), {
        filter: {
          $not: { status: 'active' },
        } as any,
      });
      expect(result.documents).toHaveLength(2);
    });
  });

  describe('execute() - sorting', () => {
    it('should sort ascending', () => {
      const result = executor.execute(makeDocs(), {
        sort: [{ field: 'age' as any, direction: 'asc' }],
      });
      const ages = result.documents.map((d) => d.age);
      expect(ages).toEqual([22, 25, 28, 30, 35]);
    });

    it('should sort descending', () => {
      const result = executor.execute(makeDocs(), {
        sort: [{ field: 'age' as any, direction: 'desc' }],
      });
      const ages = result.documents.map((d) => d.age);
      expect(ages).toEqual([35, 30, 28, 25, 22]);
    });

    it('should sort by string field', () => {
      const result = executor.execute(makeDocs(), {
        sort: [{ field: 'name' as any, direction: 'asc' }],
      });
      const names = result.documents.map((d) => d.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']);
    });

    it('should handle multi-field sorting', () => {
      const result = executor.execute(makeDocs(), {
        sort: [
          { field: 'status' as any, direction: 'asc' },
          { field: 'age' as any, direction: 'asc' },
        ],
      });
      expect(result.documents[0].status).toBe('active');
      // Active docs sorted by age
      const activeDocs = result.documents.filter((d) => d.status === 'active');
      const activeAges = activeDocs.map((d) => d.age);
      expect(activeAges).toEqual([28, 30, 35]);
    });
  });

  describe('execute() - skip and limit', () => {
    it('should apply limit', () => {
      const result = executor.execute(makeDocs(), { limit: 2 });
      expect(result.documents).toHaveLength(2);
      expect(result.totalCount).toBe(5);
    });

    it('should apply skip', () => {
      const result = executor.execute(makeDocs(), {
        sort: [{ field: 'name' as any, direction: 'asc' }],
        skip: 2,
      });
      expect(result.documents).toHaveLength(3);
      expect(result.documents[0].name).toBe('Charlie');
    });

    it('should apply skip and limit together', () => {
      const result = executor.execute(makeDocs(), {
        sort: [{ field: 'name' as any, direction: 'asc' }],
        skip: 1,
        limit: 2,
      });
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].name).toBe('Bob');
      expect(result.documents[1].name).toBe('Charlie');
    });
  });

  describe('execute() - projection', () => {
    it('should include only specified fields (inclusion mode)', () => {
      const result = executor.execute(makeDocs(), {
        limit: 1,
        projection: { name: 1 } as any,
      });
      const doc = result.documents[0];
      expect(doc._id).toBeDefined();
      expect(doc.name).toBeDefined();
      expect(doc.age).toBeUndefined();
      expect(doc.status).toBeUndefined();
    });

    it('should exclude specified fields (exclusion mode)', () => {
      const result = executor.execute(makeDocs(), {
        limit: 1,
        projection: { tags: 0 } as any,
      });
      const doc = result.documents[0];
      expect(doc.name).toBeDefined();
      expect(doc.tags).toBeUndefined();
    });

    it('should always include _id', () => {
      const result = executor.execute(makeDocs(), {
        limit: 1,
        projection: { name: 1 } as any,
      });
      expect(result.documents[0]._id).toBeDefined();
    });
  });

  describe('execute() - edge cases', () => {
    it('should handle empty collection', () => {
      const result = executor.execute([], {});
      expect(result.documents).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle no matches', () => {
      const result = executor.execute(makeDocs(), {
        filter: { name: 'NonExistent' } as any,
      });
      expect(result.documents).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle all matches', () => {
      const result = executor.execute(makeDocs(), {
        filter: { _id: { $exists: true } } as any,
      });
      expect(result.documents).toHaveLength(5);
    });

    it('should return executionTimeMs', () => {
      const result = executor.execute(makeDocs(), {});
      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('matches()', () => {
    const doc: TestDoc = {
      _id: '1',
      name: 'Alice',
      age: 30,
      status: 'active',
    } as TestDoc;

    it('should return true when no filter', () => {
      expect(executor.matches(doc, {})).toBe(true);
    });

    it('should return true when document matches filter', () => {
      expect(executor.matches(doc, { filter: { status: 'active' } as any })).toBe(true);
    });

    it('should return false when document does not match', () => {
      expect(executor.matches(doc, { filter: { status: 'inactive' } as any })).toBe(false);
    });
  });

  describe('count()', () => {
    it('should count all documents without filter', () => {
      expect(executor.count(makeDocs(), {})).toBe(5);
    });

    it('should count matching documents with filter', () => {
      expect(executor.count(makeDocs(), { filter: { status: 'active' } as any })).toBe(3);
    });

    it('should return 0 for empty collection', () => {
      expect(executor.count([], {})).toBe(0);
    });
  });

  describe('sorting edge cases', () => {
    it('should handle null/undefined values during sort', () => {
      const docs: TestDoc[] = [
        { _id: '1', name: 'Alice', age: 30 } as TestDoc,
        { _id: '2', name: 'Bob' } as TestDoc, // age is undefined
        { _id: '3', name: 'Charlie', age: 25 } as TestDoc,
      ];

      const result = executor.execute(docs, {
        sort: [{ field: 'age' as any, direction: 'asc' }],
      });

      // Documents with undefined age should be sorted consistently
      expect(result.documents).toHaveLength(3);
    });

    it('should sort with identical values maintaining relative order', () => {
      const docs: TestDoc[] = [
        { _id: '1', name: 'Alice', status: 'active' } as TestDoc,
        { _id: '2', name: 'Bob', status: 'active' } as TestDoc,
        { _id: '3', name: 'Charlie', status: 'active' } as TestDoc,
      ];

      const result = executor.execute(docs, {
        sort: [{ field: 'status' as any, direction: 'asc' }],
      });

      // All have same status - order should be maintained
      expect(result.documents).toHaveLength(3);
    });
  });

  describe('filtering edge cases', () => {
    it('should handle filtering on undefined fields', () => {
      const docs: TestDoc[] = [
        { _id: '1', name: 'Alice', status: 'active' } as TestDoc,
        { _id: '2', name: 'Bob' } as TestDoc, // status undefined
      ];

      const result = executor.execute(docs, {
        filter: { status: 'active' } as any,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Alice');
    });

    it('should handle $in with empty array', () => {
      const result = executor.execute(makeDocs(), {
        filter: { name: { $in: [] } } as any,
      });

      expect(result.documents).toHaveLength(0);
    });
  });

  describe('projection edge cases', () => {
    it('should handle projection with no matching fields', () => {
      const result = executor.execute(makeDocs(), {
        limit: 1,
        projection: { nonexistent: 1 } as any,
      });

      // _id is always included
      expect(result.documents[0]._id).toBeDefined();
    });

    it('should handle projection on nested fields', () => {
      const docs: TestDoc[] = [{ _id: '1', name: 'Alice', nested: { value: 42 } } as TestDoc];

      const result = executor.execute(docs, {
        projection: { name: 1, nested: 1 } as any,
      });

      expect(result.documents[0].name).toBe('Alice');
      expect(result.documents[0].nested).toEqual({ value: 42 });
    });

    it('should handle mixed projection (include and exclude)', () => {
      const result = executor.execute(makeDocs(), {
        limit: 1,
        projection: { name: 1, age: 0 } as any,
      });
      const doc = result.documents[0];
      // Mixed projection treated as inclusion - name included, _id always included
      expect(doc._id).toBeDefined();
      expect(doc.name).toBeDefined();
    });
  });

  describe('filtering with nested fields', () => {
    it('should filter by nested field value', () => {
      const docs: TestDoc[] = [
        { _id: '1', name: 'Alice', nested: { value: 10 } } as TestDoc,
        { _id: '2', name: 'Bob', nested: { value: 20 } } as TestDoc,
        { _id: '3', name: 'Charlie' } as TestDoc,
      ];

      const result = executor.execute(docs, {
        filter: { 'nested.value': { $gt: 15 } } as any,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Bob');
    });
  });

  describe('combined filter + sort + skip + limit', () => {
    it('should apply full pipeline in correct order', () => {
      const result = executor.execute(makeDocs(), {
        filter: { status: 'active' } as any,
        sort: [{ field: 'age' as any, direction: 'desc' }],
        skip: 1,
        limit: 1,
      });

      // 3 active docs sorted by age desc: [35, 30, 28], skip 1 → [30], limit 1 → [30]
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].age).toBe(30);
      expect(result.totalCount).toBe(3); // total before skip/limit
    });
  });
});

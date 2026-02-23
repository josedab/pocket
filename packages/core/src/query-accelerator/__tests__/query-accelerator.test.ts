import { describe, expect, it } from 'vitest';
import { QueryAccelerator } from '../query-accelerator.js';

interface TestDoc {
  _id: string;
  name: string;
  age: number;
  status: string;
  tags?: string[];
  address?: { city: string };
}

function generateDocs(count: number): TestDoc[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${i}`,
    name: `User ${i}`,
    age: 18 + (i % 60),
    status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'inactive' : 'pending',
    tags: [`tag-${i % 5}`],
    address: { city: i % 2 === 0 ? 'NYC' : 'LA' },
  }));
}

describe('QueryAccelerator', () => {
  const accel = new QueryAccelerator({ accelerationThreshold: 10 });
  const docs = generateDocs(200);

  describe('filter', () => {
    it('should filter by equality', () => {
      const result = accel.filter(docs, { status: 'active' });
      expect(result.every((d) => d.status === 'active')).toBe(true);
      expect(result.length).toBe(67);
    });

    it('should filter by $gt operator', () => {
      const result = accel.filter(docs, { age: { $gt: 50 } });
      expect(result.every((d) => d.age > 50)).toBe(true);
    });

    it('should filter by $gte and $lte', () => {
      const result = accel.filter(docs, { age: { $gte: 30, $lte: 40 } });
      expect(result.every((d) => d.age >= 30 && d.age <= 40)).toBe(true);
    });

    it('should filter by $in', () => {
      const result = accel.filter(docs, { status: { $in: ['active', 'pending'] } });
      expect(result.every((d) => d.status === 'active' || d.status === 'pending')).toBe(true);
    });

    it('should filter by $contains on strings', () => {
      const result = accel.filter(docs, { name: { $contains: 'User 1' } });
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((d) => d.name.includes('User 1'))).toBe(true);
    });

    it('should filter by nested path', () => {
      const result = accel.filter(docs, { 'address.city': 'NYC' });
      expect(result.every((d) => d.address?.city === 'NYC')).toBe(true);
    });

    it('should handle $and', () => {
      const result = accel.filter(docs, {
        $and: [{ status: 'active' }, { age: { $gte: 40 } }],
      });
      expect(result.every((d) => d.status === 'active' && d.age >= 40)).toBe(true);
    });

    it('should handle $or', () => {
      const result = accel.filter(docs, {
        $or: [{ age: { $lt: 20 } }, { age: { $gt: 70 } }],
      });
      expect(result.every((d) => d.age < 20 || d.age > 70)).toBe(true);
    });

    it('should handle empty filter', () => {
      const result = accel.filter(docs, {});
      expect(result.length).toBe(200);
    });
  });

  describe('sort', () => {
    it('should sort ascending', () => {
      const result = accel.sort([...docs], [{ field: 'age', direction: 'asc' }]);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.age).toBeGreaterThanOrEqual(result[i - 1]!.age);
      }
    });

    it('should sort descending', () => {
      const result = accel.sort([...docs], [{ field: 'age', direction: 'desc' }]);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.age).toBeLessThanOrEqual(result[i - 1]!.age);
      }
    });

    it('should sort by string field', () => {
      const result = accel.sort([...docs], [{ field: 'name', direction: 'asc' }]);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.name.localeCompare(result[i - 1]!.name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle multi-field sort', () => {
      const result = accel.sort(
        [...docs],
        [
          { field: 'status', direction: 'asc' },
          { field: 'age', direction: 'desc' },
        ]
      );
      expect(result[0]!.status).toBe('active');
    });
  });

  describe('filterAndSort', () => {
    it('should combine filter, sort, and limit', () => {
      const result = accel.filterAndSort(
        docs,
        { status: 'active' },
        [{ field: 'age', direction: 'desc' }],
        5
      );
      expect(result.length).toBe(5);
      expect(result.every((d) => d.status === 'active')).toBe(true);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.age).toBeLessThanOrEqual(result[i - 1]!.age);
      }
    });
  });

  describe('aggregate', () => {
    it('should compute sum, avg, min, max', () => {
      const result = accel.aggregate(docs, 'age');
      expect(result.count).toBe(200);
      expect(result.sum).toBeGreaterThan(0);
      expect(result.avg).toBeGreaterThan(0);
      expect(result.min).toBe(18);
      expect(result.max).toBe(77);
    });

    it('should aggregate with filter', () => {
      const result = accel.aggregate(docs, 'age', { status: 'active' });
      expect(result.count).toBeLessThan(200);
      expect(result.sum).toBeGreaterThan(0);
    });
  });

  describe('count', () => {
    it('should count all docs without filter', () => {
      expect(accel.count(docs)).toBe(200);
    });

    it('should count with filter', () => {
      const c = accel.count(docs, { status: 'active' });
      expect(c).toBe(67);
    });
  });

  describe('groupBy', () => {
    it('should group by field', () => {
      const groups = accel.groupBy(docs, 'status');
      expect(groups.size).toBe(3);
      expect(groups.has('active')).toBe(true);
      expect(groups.has('inactive')).toBe(true);
      expect(groups.has('pending')).toBe(true);
    });
  });

  describe('stats', () => {
    it('should track operation statistics', () => {
      const a = new QueryAccelerator({ accelerationThreshold: 5 });
      a.filter(generateDocs(20), { status: 'active' });
      a.sort(generateDocs(20), [{ field: 'age', direction: 'asc' }]);

      const stats = a.getStats();
      expect(stats.totalOperations).toBe(2);
      expect(stats.acceleratedOperations).toBe(2);
    });
  });
});

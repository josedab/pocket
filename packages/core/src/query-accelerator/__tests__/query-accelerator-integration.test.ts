/**
 * Integration tests: QueryAccelerator + Core Query Patterns
 *
 * Tests that QueryAccelerator produces results consistent with
 * standard JS array operations and can serve as a drop-in accelerator.
 */
import { describe, expect, it } from 'vitest';
import { QueryAccelerator } from '../query-accelerator.js';

interface UserDoc {
  _id: string;
  _rev?: string;
  name: string;
  email: string;
  age: number;
  department: string;
  active: boolean;
  salary: number;
  joinedAt: string; // ISO date
  tags: string[];
}

function generateUsers(count: number): UserDoc[] {
  const departments = ['engineering', 'sales', 'marketing', 'hr', 'finance'];
  return Array.from({ length: count }, (_, i) => ({
    _id: `user-${i}`,
    _rev: `1-${i}`,
    name: `User ${i}`,
    email: `user${i}@company.com`,
    age: 22 + (i % 45),
    department: departments[i % departments.length]!,
    active: i % 7 !== 0,
    salary: 40000 + (i % 80) * 1000,
    joinedAt: new Date(2020, i % 12, (i % 28) + 1).toISOString(),
    tags: [`team-${i % 5}`, `level-${(i % 3) + 1}`],
  }));
}

describe('QueryAccelerator Integration', () => {
  const accel = new QueryAccelerator({ accelerationThreshold: 50 });
  const users = generateUsers(500);

  describe('consistency with native Array operations', () => {
    it('should match native filter results for equality', () => {
      const expected = users.filter((u) => u.department === 'engineering');
      const actual = accel.filter(users, { department: 'engineering' });
      expect(actual).toEqual(expected);
    });

    it('should match native filter results for boolean', () => {
      const expected = users.filter((u) => u.active === false);
      const actual = accel.filter(users, { active: false });
      expect(actual).toEqual(expected);
    });

    it('should match native filter for range queries', () => {
      const expected = users.filter((u) => u.age >= 30 && u.age <= 40);
      const actual = accel.filter(users, { age: { $gte: 30, $lte: 40 } });
      expect(actual).toEqual(expected);
    });

    it('should match native filter for $in queries', () => {
      const expected = users.filter(
        (u) => u.department === 'engineering' || u.department === 'sales'
      );
      const actual = accel.filter(users, {
        department: { $in: ['engineering', 'sales'] },
      });
      expect(actual).toEqual(expected);
    });

    it('should match native filter for $nin queries', () => {
      const expected = users.filter(
        (u) => u.department !== 'engineering' && u.department !== 'sales'
      );
      const actual = accel.filter(users, {
        department: { $nin: ['engineering', 'sales'] },
      });
      expect(actual).toEqual(expected);
    });

    it('should match native filter for string operators', () => {
      const expected = users.filter((u) => u.email.startsWith('user1'));
      const actual = accel.filter(users, { email: { $startsWith: 'user1' } });
      expect(actual).toEqual(expected);
    });

    it('should match native sort results', () => {
      const expected = [...users].sort((a, b) => a.age - b.age);
      const actual = accel.sort([...users], [{ field: 'age', direction: 'asc' }]);
      expect(actual.map((u) => u._id)).toEqual(expected.map((u) => u._id));
    });

    it('should match native sort for descending', () => {
      const expected = [...users].sort((a, b) => b.salary - a.salary);
      const actual = accel.sort([...users], [{ field: 'salary', direction: 'desc' }]);
      expect(actual.map((u) => u._id)).toEqual(expected.map((u) => u._id));
    });
  });

  describe('complex query patterns', () => {
    it('should handle combined filter + sort + limit (top-N)', () => {
      const result = accel.filterAndSort(
        users,
        { department: 'engineering', active: true },
        [{ field: 'salary', direction: 'desc' }],
        10
      );

      expect(result.length).toBeLessThanOrEqual(10);
      expect(result.every((u) => u.department === 'engineering' && u.active)).toBe(true);
      // Verify descending salary order
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.salary).toBeLessThanOrEqual(result[i - 1]!.salary);
      }
    });

    it('should handle $and with nested operators', () => {
      const result = accel.filter(users, {
        $and: [{ age: { $gte: 25 } }, { salary: { $gt: 60000 } }, { active: true }],
      });

      expect(result.every((u) => u.age >= 25 && u.salary > 60000 && u.active)).toBe(true);
    });

    it('should handle $or across different fields', () => {
      const result = accel.filter(users, {
        $or: [{ department: 'hr' }, { salary: { $gte: 100000 } }],
      });

      expect(result.every((u) => u.department === 'hr' || u.salary >= 100000)).toBe(true);
    });
  });

  describe('aggregation integration', () => {
    it('should compute department salary statistics', () => {
      const engUsers = users.filter((u) => u.department === 'engineering');
      const result = accel.aggregate(users, 'salary', { department: 'engineering' });

      expect(result.count).toBe(engUsers.length);
      const expectedSum = engUsers.reduce((s, u) => s + u.salary, 0);
      expect(result.sum).toBe(expectedSum);
      expect(result.avg).toBeCloseTo(expectedSum / engUsers.length, 2);
    });

    it('should group and count by department', () => {
      const groups = accel.groupBy(users, 'department');
      expect(groups.size).toBe(5);

      for (const [dept, deptUsers] of groups) {
        const expected = users.filter((u) => u.department === dept);
        expect(deptUsers.length).toBe(expected.length);
      }
    });

    it('should combine groupBy with filter and aggregate', () => {
      const activeUsers = accel.filter(users, { active: true });
      const groups = accel.groupBy(activeUsers, 'department');

      for (const [, deptUsers] of groups) {
        const stats = accel.aggregate(deptUsers as UserDoc[], 'salary');
        expect(stats.count).toBe(deptUsers.length);
        expect(stats.sum).toBeGreaterThan(0);
        expect(stats.avg).toBeGreaterThan(0);
        expect(stats.min).toBeLessThanOrEqual(stats.max as number);
      }
    });
  });

  describe('performance characteristics', () => {
    it('should use batch mode for large datasets', () => {
      const largeSet = generateUsers(1000);
      const beforeStats = accel.getStats();
      accel.filter(largeSet, { active: true, department: 'engineering' });
      const afterStats = accel.getStats();

      expect(afterStats.acceleratedOperations).toBeGreaterThan(beforeStats.acceleratedOperations);
    });

    it('should use simple mode for small datasets', () => {
      const smallAccel = new QueryAccelerator({ accelerationThreshold: 100 });
      const smallSet = generateUsers(10);
      smallAccel.filter(smallSet, { active: true });

      expect(smallAccel.getStats().jsOperations).toBe(1);
      expect(smallAccel.getStats().acceleratedOperations).toBe(0);
    });

    it('should track timing statistics', () => {
      const fresh = new QueryAccelerator();
      fresh.filter(users, { active: true });
      fresh.sort([...users], [{ field: 'age', direction: 'asc' }]);

      const stats = fresh.getStats();
      expect(stats.totalOperations).toBe(2);
      expect(stats.avgFilterTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.avgSortTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { aggregate, filter, join, pipe, sort, transform, union } from '../operators.js';
import type { ComputeContext } from '../types.js';

const ctx: ComputeContext = { isInitial: true };

// ── Test Data ────────────────────────────────────────────

const users = [
  { _id: '1', name: 'Alice', role: 'admin' },
  { _id: '2', name: 'Bob', role: 'user' },
  { _id: '3', name: 'Charlie', role: 'user' },
];

const orders = [
  { _id: 'o1', userId: '1', amount: 100, status: 'completed' },
  { _id: 'o2', userId: '1', amount: 200, status: 'pending' },
  { _id: 'o3', userId: '2', amount: 50, status: 'completed' },
];

// ── Join Operator ────────────────────────────────────────

describe('join', () => {
  const sources = { users, orders };

  describe('inner join', () => {
    it('returns matching rows from both sides', () => {
      const fn = join({
        leftSource: 'users',
        rightSource: 'orders',
        leftKey: '_id',
        rightKey: 'userId',
        type: 'inner',
      });
      const result = fn(sources, ctx);
      expect(result).toHaveLength(3); // Alice has 2 orders, Bob has 1
      expect(result.every((r) => r.userId !== undefined)).toBe(true);
    });

    it('excludes unmatched rows', () => {
      const fn = join({
        leftSource: 'users',
        rightSource: 'orders',
        leftKey: '_id',
        rightKey: 'userId',
        type: 'inner',
      });
      const result = fn(sources, ctx);
      // Charlie has no orders, should not appear
      expect(result.some((r) => r.name === 'Charlie')).toBe(false);
    });
  });

  describe('left join', () => {
    it('includes unmatched left rows', () => {
      const fn = join({
        leftSource: 'users',
        rightSource: 'orders',
        leftKey: '_id',
        rightKey: 'userId',
        type: 'left',
      });
      const result = fn(sources, ctx);
      // Alice(2) + Bob(1) + Charlie(unmatched=1)
      expect(result).toHaveLength(4);
      expect(result.some((r) => r.name === 'Charlie')).toBe(true);
    });
  });

  describe('right join', () => {
    it('includes unmatched right rows', () => {
      const usersSmall = [{ _id: '1', name: 'Alice' }];
      const fn = join({
        leftSource: 'users',
        rightSource: 'orders',
        leftKey: '_id',
        rightKey: 'userId',
        type: 'right',
      });
      const result = fn({ users: usersSmall, orders }, ctx);
      // Alice matches 2, Bob's order is unmatched
      expect(result.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('full join', () => {
    it('includes all rows from both sides', () => {
      const fn = join({
        leftSource: 'users',
        rightSource: 'orders',
        leftKey: '_id',
        rightKey: 'userId',
        type: 'full',
      });
      const result = fn(sources, ctx);
      // All matches + unmatched from both sides
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('handles empty sources', () => {
    const fn = join({
      leftSource: 'users',
      rightSource: 'orders',
      leftKey: '_id',
      rightKey: 'userId',
      type: 'inner',
    });
    const result = fn({ users: [], orders: [] }, ctx);
    expect(result).toHaveLength(0);
  });

  it('handles missing source names', () => {
    const fn = join({
      leftSource: 'missing1',
      rightSource: 'missing2',
      leftKey: '_id',
      rightKey: 'userId',
      type: 'inner',
    });
    const result = fn({}, ctx);
    expect(result).toHaveLength(0);
  });

  it('supports custom select function', () => {
    const fn = join({
      leftSource: 'users',
      rightSource: 'orders',
      leftKey: '_id',
      rightKey: 'userId',
      type: 'inner',
      select: (left, right) => ({
        userName: left.name,
        orderAmount: right?.amount,
      }),
    });
    const result = fn(sources, ctx);
    expect(result[0]).toHaveProperty('userName');
    expect(result[0]).toHaveProperty('orderAmount');
    expect(result[0]).not.toHaveProperty('_id');
  });
});

// ── Aggregate Operator ───────────────────────────────────

describe('aggregate', () => {
  const sources = { orders };

  it('counts all documents', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: '*', operation: 'count', alias: 'total' }],
    });
    const result = fn(sources, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]!.total).toBe(3);
  });

  it('sums numeric field', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: 'amount', operation: 'sum', alias: 'totalAmount' }],
    });
    const result = fn(sources, ctx);
    expect(result[0]!.totalAmount).toBe(350); // 100 + 200 + 50
  });

  it('computes average', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: 'amount', operation: 'avg', alias: 'avgAmount' }],
    });
    const result = fn(sources, ctx);
    expect(result[0]!.avgAmount).toBeCloseTo(116.67, 0);
  });

  it('finds min and max', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [
        { field: 'amount', operation: 'min', alias: 'minAmount' },
        { field: 'amount', operation: 'max', alias: 'maxAmount' },
      ],
    });
    const result = fn(sources, ctx);
    expect(result[0]!.minAmount).toBe(50);
    expect(result[0]!.maxAmount).toBe(200);
  });

  it('gets first and last values', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [
        { field: 'status', operation: 'first', alias: 'firstStatus' },
        { field: 'status', operation: 'last', alias: 'lastStatus' },
      ],
    });
    const result = fn(sources, ctx);
    expect(result[0]!.firstStatus).toBe('completed');
    expect(result[0]!.lastStatus).toBe('completed');
  });

  it('collects values into array', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: 'amount', operation: 'collect', alias: 'amounts' }],
    });
    const result = fn(sources, ctx);
    expect(result[0]!.amounts).toEqual([100, 200, 50]);
  });

  it('groups by a single field', () => {
    const fn = aggregate({
      source: 'orders',
      groupBy: 'status',
      aggregations: [
        { field: '*', operation: 'count', alias: 'count' },
        { field: 'amount', operation: 'sum', alias: 'total' },
      ],
    });
    const result = fn(sources, ctx);
    expect(result).toHaveLength(2); // completed, pending

    const completed = result.find((r) => r.status === 'completed');
    expect(completed!.count).toBe(2);
    expect(completed!.total).toBe(150); // 100 + 50

    const pending = result.find((r) => r.status === 'pending');
    expect(pending!.count).toBe(1);
    expect(pending!.total).toBe(200);
  });

  it('groups by multiple fields', () => {
    const fn = aggregate({
      source: 'orders',
      groupBy: ['userId', 'status'],
      aggregations: [{ field: '*', operation: 'count', alias: 'count' }],
    });
    const result = fn(sources, ctx);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty source', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: '*', operation: 'count', alias: 'total' }],
    });
    const result = fn({ orders: [] }, ctx);
    expect(result[0]!.total).toBe(0);
  });

  it('handles missing source', () => {
    const fn = aggregate({
      source: 'missing',
      aggregations: [{ field: '*', operation: 'count', alias: 'total' }],
    });
    const result = fn({}, ctx);
    expect(result[0]!.total).toBe(0);
  });

  it('uses default alias when not specified', () => {
    const fn = aggregate({
      source: 'orders',
      aggregations: [{ field: 'amount', operation: 'sum' }],
    });
    const result = fn(sources, ctx);
    expect(result[0]).toHaveProperty('sum_amount');
  });
});

// ── Filter Operator ──────────────────────────────────────

describe('filter', () => {
  it('filters documents by predicate', () => {
    const fn = filter('orders', (doc) => doc.status === 'completed');
    const result = fn({ orders }, ctx);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.status === 'completed')).toBe(true);
  });

  it('returns empty array when no matches', () => {
    const fn = filter('orders', () => false);
    const result = fn({ orders }, ctx);
    expect(result).toHaveLength(0);
  });

  it('handles missing source', () => {
    const fn = filter('missing', () => true);
    const result = fn({}, ctx);
    expect(result).toHaveLength(0);
  });
});

// ── Transform Operator ───────────────────────────────────

describe('transform', () => {
  it('maps each document', () => {
    const fn = transform('users', (doc) => ({
      id: doc._id,
      displayName: String(doc.name).toUpperCase(),
    }));
    const result = fn({ users }, ctx);
    expect(result).toHaveLength(3);
    expect(result[0]!.displayName).toBe('ALICE');
    expect(result[0]).not.toHaveProperty('name');
  });

  it('handles empty source', () => {
    const fn = transform('users', (doc) => doc);
    const result = fn({ users: [] }, ctx);
    expect(result).toHaveLength(0);
  });
});

// ── Sort Operator ────────────────────────────────────────

describe('sort', () => {
  it('sorts documents by comparator', () => {
    const fn = sort('users', (a, b) => String(a.name).localeCompare(String(b.name)));
    const result = fn({ users }, ctx);
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sorts descending', () => {
    const fn = sort('orders', (a, b) => Number(b.amount) - Number(a.amount));
    const result = fn({ orders }, ctx);
    expect(result[0]!.amount).toBe(200);
    expect(result[2]!.amount).toBe(50);
  });

  it('does not mutate original array', () => {
    const original = [...users];
    const fn = sort('users', (a, b) => String(b.name).localeCompare(String(a.name)));
    fn({ users }, ctx);
    expect(users).toEqual(original);
  });
});

// ── Union Operator ───────────────────────────────────────

describe('union', () => {
  it('combines multiple sources', () => {
    const fn = union('users', 'orders');
    const result = fn({ users, orders }, ctx);
    expect(result).toHaveLength(users.length + orders.length);
  });

  it('handles missing sources', () => {
    const fn = union('users', 'missing');
    const result = fn({ users }, ctx);
    expect(result).toHaveLength(users.length);
  });

  it('returns empty for no sources', () => {
    const fn = union();
    const result = fn({}, ctx);
    expect(result).toHaveLength(0);
  });
});

// ── Pipe Operator ────────────────────────────────────────

describe('pipe', () => {
  it('chains compute functions', () => {
    const fn = pipe(
      filter('users', (doc) => doc.role === 'user'),
      transform('__pipe__', (doc) => ({ ...doc, tagged: true }))
    );
    const result = fn({ users }, ctx);
    expect(result).toHaveLength(2); // Bob, Charlie
    expect(result.every((r) => r.tagged === true)).toBe(true);
  });

  it('returns empty for no functions', () => {
    const fn = pipe();
    const result = fn({ users }, ctx);
    expect(result).toHaveLength(0);
  });

  it('supports single function', () => {
    const fn = pipe(filter('users', () => true));
    const result = fn({ users }, ctx);
    expect(result).toHaveLength(3);
  });
});

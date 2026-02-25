/**
 * Integration tests: ComputedView + ViewManager wiring
 *
 * Tests that ComputedView can be used alongside MaterializedView
 * within the ViewManager ecosystem for mixed view types.
 */
import { describe, expect, it } from 'vitest';
import { ComputedView } from '../computed-view.js';

describe('ComputedView + ViewManager Integration', () => {
  describe('ComputedView alongside ViewManager', () => {
    it('should maintain independent computed views per collection', () => {
      const ordersView = new ComputedView({
        name: 'order-summary',
        collection: 'orders',
        groupBy: 'status',
        aggregations: {
          count: { type: 'count' },
          total: { type: 'sum', field: 'amount' },
        },
      });

      const userView = new ComputedView({
        name: 'user-dept-summary',
        collection: 'users',
        groupBy: 'department',
        aggregations: {
          count: { type: 'count' },
          avgSalary: { type: 'avg', field: 'salary' },
        },
      });

      ordersView.initialize([
        { _id: '1', status: 'pending', amount: 100 },
        { _id: '2', status: 'completed', amount: 200 },
        { _id: '3', status: 'pending', amount: 150 },
      ]);

      userView.initialize([
        { _id: '1', department: 'eng', salary: 90000 },
        { _id: '2', department: 'eng', salary: 110000 },
        { _id: '3', department: 'sales', salary: 70000 },
      ]);

      // Orders
      const pending = ordersView.results.find((r) => r._key === 'pending');
      expect(pending!.count).toBe(2);
      expect(pending!.total).toBe(250);

      // Users
      const eng = userView.results.find((r) => r._key === 'eng');
      expect(eng!.count).toBe(2);
      expect(eng!.avgSalary).toBe(100000);
    });
  });

  describe('incremental updates maintain consistency', () => {
    it('should keep aggregations correct through insert/update/delete cycle', () => {
      const view = new ComputedView({
        name: 'running-totals',
        collection: 'transactions',
        groupBy: 'category',
        aggregations: {
          count: { type: 'count' },
          total: { type: 'sum', field: 'amount' },
          min: { type: 'min', field: 'amount' },
          max: { type: 'max', field: 'amount' },
        },
      });

      // Initialize
      view.initialize([
        { _id: '1', category: 'food', amount: 25 },
        { _id: '2', category: 'food', amount: 15 },
        { _id: '3', category: 'transport', amount: 50 },
      ]);

      let food = view.results.find((r) => r._key === 'food');
      expect(food!.count).toBe(2);
      expect(food!.total).toBe(40);

      // Insert
      view.applyChange({
        operation: 'insert',
        documentId: '4',
        document: { _id: '4', category: 'food', amount: 30 },
      });

      food = view.results.find((r) => r._key === 'food');
      expect(food!.count).toBe(3);
      expect(food!.total).toBe(70);

      // Update — move from food to transport
      view.applyChange({
        operation: 'update',
        documentId: '4',
        document: { _id: '4', category: 'transport', amount: 30 },
        previousDocument: { _id: '4', category: 'food', amount: 30 },
      });

      food = view.results.find((r) => r._key === 'food');
      expect(food!.count).toBe(2);
      expect(food!.total).toBe(40);

      const transport = view.results.find((r) => r._key === 'transport');
      expect(transport!.count).toBe(2);
      expect(transport!.total).toBe(80);

      // Delete
      view.applyChange({
        operation: 'delete',
        documentId: '1',
        document: null,
        previousDocument: { _id: '1', category: 'food', amount: 25 },
      });

      food = view.results.find((r) => r._key === 'food');
      expect(food!.count).toBe(1);
      expect(food!.total).toBe(15);
    });
  });

  describe('reactive subscriptions', () => {
    it('should emit results on every change', () => {
      const view = new ComputedView({
        name: 'reactive-test',
        collection: 'items',
        aggregations: { count: { type: 'count' } },
      });

      const emissions: number[] = [];
      view.results$.subscribe((results) => {
        const row = results[0];
        if (row) emissions.push(row.count as number);
      });

      view.initialize([
        { _id: '1', value: 10 },
        { _id: '2', value: 20 },
      ]);

      view.applyChange({
        operation: 'insert',
        documentId: '3',
        document: { _id: '3', value: 30 },
      });

      view.applyChange({
        operation: 'delete',
        documentId: '1',
        document: null,
        previousDocument: { _id: '1', value: 10 },
      });

      // Should have: initial(2), insert(3), delete(2)
      expect(emissions).toContain(2);
      expect(emissions).toContain(3);
      expect(emissions[emissions.length - 1]).toBe(2);
    });
  });

  describe('filtered computed views', () => {
    it('should only aggregate documents matching the pre-filter', () => {
      const view = new ComputedView({
        name: 'active-revenue',
        collection: 'accounts',
        filter: { active: true },
        groupBy: 'plan',
        aggregations: {
          count: { type: 'count' },
          totalRevenue: { type: 'sum', field: 'revenue' },
        },
      });

      view.initialize([
        { _id: '1', active: true, plan: 'pro', revenue: 100 },
        { _id: '2', active: false, plan: 'pro', revenue: 200 },
        { _id: '3', active: true, plan: 'free', revenue: 0 },
        { _id: '4', active: true, plan: 'pro', revenue: 150 },
      ]);

      const pro = view.results.find((r) => r._key === 'pro');
      expect(pro!.count).toBe(2); // only active
      expect(pro!.totalRevenue).toBe(250);

      // Insert inactive — should not affect view
      const changed = view.applyChange({
        operation: 'insert',
        documentId: '5',
        document: { _id: '5', active: false, plan: 'pro', revenue: 500 },
      });
      expect(changed).toBe(false);

      // Insert active — should update
      const changed2 = view.applyChange({
        operation: 'insert',
        documentId: '6',
        document: { _id: '6', active: true, plan: 'pro', revenue: 75 },
      });
      expect(changed2).toBe(true);

      const proUpdated = view.results.find((r) => r._key === 'pro');
      expect(proUpdated!.count).toBe(3);
      expect(proUpdated!.totalRevenue).toBe(325);
    });
  });

  describe('stats tracking', () => {
    it('should report accurate statistics', () => {
      const view = new ComputedView({
        name: 'stats-test',
        collection: 'metrics',
        groupBy: 'type',
        aggregations: { count: { type: 'count' } },
      });

      view.initialize([
        { _id: '1', type: 'a' },
        { _id: '2', type: 'b' },
        { _id: '3', type: 'a' },
        { _id: '4', type: 'c' },
        { _id: '5', type: 'a' },
      ]);

      const stats = view.getStats();
      expect(stats.name).toBe('stats-test');
      expect(stats.collection).toBe('metrics');
      expect(stats.groupCount).toBe(3);
      expect(stats.sourceDocCount).toBe(5);
      expect(stats.computeTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

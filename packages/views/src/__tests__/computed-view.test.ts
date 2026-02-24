import { beforeEach, describe, expect, it } from 'vitest';
import { ComputedView } from '../computed-view.js';

interface Order {
  _id: string;
  status: string;
  amount: number;
  category: string;
}

function generateOrders(): Record<string, unknown>[] {
  return [
    { _id: '1', status: 'pending', amount: 100, category: 'electronics' },
    { _id: '2', status: 'pending', amount: 200, category: 'clothing' },
    { _id: '3', status: 'completed', amount: 50, category: 'electronics' },
    { _id: '4', status: 'completed', amount: 150, category: 'clothing' },
    { _id: '5', status: 'completed', amount: 300, category: 'electronics' },
    { _id: '6', status: 'cancelled', amount: 75, category: 'clothing' },
  ];
}

describe('ComputedView', () => {
  describe('group-by aggregation', () => {
    it('should group and aggregate by field', () => {
      const view = new ComputedView({
        name: 'order-by-status',
        collection: 'orders',
        groupBy: 'status',
        aggregations: {
          count: { type: 'count' },
          totalAmount: { type: 'sum', field: 'amount' },
          avgAmount: { type: 'avg', field: 'amount' },
        },
      });

      view.initialize(generateOrders());
      const results = view.results;

      expect(results.length).toBe(3);

      const pending = results.find((r) => r._key === 'pending');
      expect(pending).toBeDefined();
      expect(pending!.count).toBe(2);
      expect(pending!.totalAmount).toBe(300);
      expect(pending!.avgAmount).toBe(150);

      const completed = results.find((r) => r._key === 'completed');
      expect(completed!.count).toBe(3);
      expect(completed!.totalAmount).toBe(500);

      const cancelled = results.find((r) => r._key === 'cancelled');
      expect(cancelled!.count).toBe(1);
    });

    it('should compute min and max', () => {
      const view = new ComputedView({
        name: 'order-stats',
        collection: 'orders',
        groupBy: 'status',
        aggregations: {
          minAmount: { type: 'min', field: 'amount' },
          maxAmount: { type: 'max', field: 'amount' },
        },
      });

      view.initialize(generateOrders());

      const completed = view.results.find((r) => r._key === 'completed');
      expect(completed!.minAmount).toBe(50);
      expect(completed!.maxAmount).toBe(300);
    });

    it('should compute first and last', () => {
      const view = new ComputedView({
        name: 'first-last',
        collection: 'orders',
        groupBy: 'status',
        aggregations: {
          firstId: { type: 'first', field: '_id' },
          lastId: { type: 'last', field: '_id' },
        },
      });

      view.initialize(generateOrders());

      const pending = view.results.find((r) => r._key === 'pending');
      expect(pending!.firstId).toBe('1');
      expect(pending!.lastId).toBe('2');
    });
  });

  describe('full-collection aggregation', () => {
    it('should aggregate without groupBy', () => {
      const view = new ComputedView({
        name: 'total-orders',
        collection: 'orders',
        aggregations: {
          count: { type: 'count' },
          totalAmount: { type: 'sum', field: 'amount' },
        },
      });

      view.initialize(generateOrders());
      expect(view.results.length).toBe(1);
      expect(view.results[0]!._key).toBeNull();
      expect(view.results[0]!.count).toBe(6);
      expect(view.results[0]!.totalAmount).toBe(875);
    });
  });

  describe('filtered aggregation', () => {
    it('should apply pre-filter before aggregation', () => {
      const view = new ComputedView({
        name: 'active-orders',
        collection: 'orders',
        filter: { status: 'completed' },
        groupBy: 'category',
        aggregations: {
          count: { type: 'count' },
          totalAmount: { type: 'sum', field: 'amount' },
        },
      });

      view.initialize(generateOrders());
      expect(view.results.length).toBe(2);

      const electronics = view.results.find((r) => r._key === 'electronics');
      expect(electronics!.count).toBe(2);
      expect(electronics!.totalAmount).toBe(350);
    });
  });

  describe('incremental updates', () => {
    let view: ComputedView;

    beforeEach(() => {
      view = new ComputedView({
        name: 'order-by-status',
        collection: 'orders',
        groupBy: 'status',
        aggregations: {
          count: { type: 'count' },
          totalAmount: { type: 'sum', field: 'amount' },
        },
      });
      view.initialize(generateOrders());
    });

    it('should handle insert', () => {
      const changed = view.applyChange({
        operation: 'insert',
        documentId: '7',
        document: { _id: '7', status: 'pending', amount: 50, category: 'food' },
      });

      expect(changed).toBe(true);
      const pending = view.results.find((r) => r._key === 'pending');
      expect(pending!.count).toBe(3);
      expect(pending!.totalAmount).toBe(350);
    });

    it('should handle delete', () => {
      const changed = view.applyChange({
        operation: 'delete',
        documentId: '1',
        document: null,
        previousDocument: { _id: '1', status: 'pending', amount: 100 },
      });

      expect(changed).toBe(true);
      const pending = view.results.find((r) => r._key === 'pending');
      expect(pending!.count).toBe(1);
      expect(pending!.totalAmount).toBe(200);
    });

    it('should handle update that changes group', () => {
      const changed = view.applyChange({
        operation: 'update',
        documentId: '1',
        document: { _id: '1', status: 'completed', amount: 100 },
        previousDocument: { _id: '1', status: 'pending', amount: 100 },
      });

      expect(changed).toBe(true);
      const pending = view.results.find((r) => r._key === 'pending');
      expect(pending!.count).toBe(1);

      const completed = view.results.find((r) => r._key === 'completed');
      expect(completed!.count).toBe(4);
    });

    it('should create new group on insert', () => {
      const changed = view.applyChange({
        operation: 'insert',
        documentId: '8',
        document: { _id: '8', status: 'refunded', amount: 25 },
      });

      expect(changed).toBe(true);
      const refunded = view.results.find((r) => r._key === 'refunded');
      expect(refunded).toBeDefined();
      expect(refunded!.count).toBe(1);
    });

    it('should remove empty groups', () => {
      // Remove the only cancelled order
      view.applyChange({
        operation: 'delete',
        documentId: '6',
        document: null,
        previousDocument: { _id: '6', status: 'cancelled', amount: 75 },
      });

      const cancelled = view.results.find((r) => r._key === 'cancelled');
      expect(cancelled).toBeUndefined();
    });
  });

  describe('reactive results$', () => {
    it('should emit updates via observable', () => {
      const view = new ComputedView({
        name: 'test',
        collection: 'orders',
        aggregations: { count: { type: 'count' } },
      });

      const emissions: unknown[] = [];
      view.results$.subscribe((r) => emissions.push(r));

      view.initialize(generateOrders());
      expect(emissions.length).toBeGreaterThanOrEqual(2); // initial + initialize
    });
  });

  describe('stats', () => {
    it('should report view statistics', () => {
      const view = new ComputedView({
        name: 'test-stats',
        collection: 'orders',
        groupBy: 'status',
        aggregations: { count: { type: 'count' } },
      });
      view.initialize(generateOrders());

      const stats = view.getStats();
      expect(stats.name).toBe('test-stats');
      expect(stats.collection).toBe('orders');
      expect(stats.groupCount).toBe(3);
      expect(stats.sourceDocCount).toBe(6);
      expect(stats.lastComputedAt).toBeGreaterThan(0);
    });
  });
});

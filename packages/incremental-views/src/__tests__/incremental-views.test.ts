import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { createViewEngine } from '../view-engine.js';
import { createIncrementalAggregation } from '../aggregation.js';
import { createDependencyGraph } from '../dependency-graph.js';
import type { ChangeEvent, ViewDefinition } from '../types.js';

interface TestDoc {
  _id: string;
  name: string;
  amount: number;
  category: string;
}

describe('incremental-views', () => {
  describe('ViewEngine', () => {
    let engine: ReturnType<typeof createViewEngine>;

    beforeEach(() => {
      engine = createViewEngine();
    });

    afterEach(() => {
      engine.destroy();
    });

    it('should define a view and get its initial value', () => {
      const definition: ViewDefinition<TestDoc, number> = {
        name: 'total-count',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      };

      const view = engine.define(definition);
      expect(view.name).toBe('total-count');
      expect(view.getValue()).toBe(0);
    });

    it('should update view on insert', () => {
      const definition: ViewDefinition<TestDoc, number> = {
        name: 'count',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      };

      engine.define(definition);

      const event: ChangeEvent<TestDoc> = {
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      };

      engine.processChange(event);

      const view = engine.getView<number>('count');
      expect(view).toBeDefined();
      expect(view!.getValue()).toBe(1);
    });

    it('should update view on update', () => {
      const definition: ViewDefinition<TestDoc, number> = {
        name: 'total-amount',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.reduce((sum, d) => sum + d.amount, 0),
      };

      engine.define(definition);

      engine.processChange({
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      engine.processChange({
        type: 'update',
        document: { _id: '1', name: 'Order 1', amount: 200, category: 'A' },
        previousDocument: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      const view = engine.getView<number>('total-amount');
      expect(view!.getValue()).toBe(200);
    });

    it('should update view on delete', () => {
      const definition: ViewDefinition<TestDoc, number> = {
        name: 'count',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      };

      engine.define(definition);

      engine.processChange({
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      engine.processChange({
        type: 'delete',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      const view = engine.getView<number>('count');
      expect(view!.getValue()).toBe(0);
    });

    it('should emit reactive updates via Observable', async () => {
      const definition: ViewDefinition<TestDoc, number> = {
        name: 'reactive-count',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      };

      const view = engine.define(definition);
      const initial = await firstValueFrom(view.value$);
      expect(initial).toBe(0);

      engine.processChange({
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 50, category: 'B' },
        collection: 'orders',
      });

      const updated = await firstValueFrom(view.value$);
      expect(updated).toBe(1);
    });

    it('should support multiple views on same source collection', () => {
      engine.define<TestDoc, number>({
        name: 'count-view',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      });

      engine.define<TestDoc, number>({
        name: 'sum-view',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.reduce((s, d) => s + d.amount, 0),
      });

      engine.processChange({
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      expect(engine.getView<number>('count-view')!.getValue()).toBe(1);
      expect(engine.getView<number>('sum-view')!.getValue()).toBe(100);
    });

    it('should list all views', () => {
      engine.define<TestDoc, number>({
        name: 'v1',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      });

      engine.define<TestDoc, number>({
        name: 'v2',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      });

      const all = engine.getAllViews();
      expect(all).toHaveLength(2);
    });

    it('should remove a view and clean up', () => {
      engine.define<TestDoc, number>({
        name: 'removable',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      });

      expect(engine.getView('removable')).toBeDefined();
      engine.removeView('removable');
      expect(engine.getView('removable')).toBeUndefined();
    });

    it('should support view with filter', () => {
      engine.define<TestDoc, number>({
        name: 'filtered',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
        filter: (doc) => doc.category === 'A',
      });

      engine.processChange({
        type: 'insert',
        document: { _id: '1', name: 'Order 1', amount: 100, category: 'A' },
        collection: 'orders',
      });

      engine.processChange({
        type: 'insert',
        document: { _id: '2', name: 'Order 2', amount: 50, category: 'B' },
        collection: 'orders',
      });

      expect(engine.getView<number>('filtered')!.getValue()).toBe(1);
    });

    it('should refresh a view manually', () => {
      const view = engine.define<TestDoc, number>({
        name: 'refreshable',
        sourceCollection: 'orders',
        mapFn: (docs) => docs.length,
      });

      view.refresh();
      expect(view.getValue()).toBe(0);
    });
  });

  describe('IncrementalAggregation', () => {
    it('should compute count', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'count' });
      agg.processInsert(10);
      agg.processInsert(20);
      expect(agg.getValue()).toBe(2);
    });

    it('should compute sum', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'sum' });
      agg.processInsert(10);
      agg.processInsert(20);
      expect(agg.getValue()).toBe(30);
    });

    it('should compute avg', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'avg' });
      agg.processInsert(10);
      agg.processInsert(30);
      expect(agg.getValue()).toBe(20);
    });

    it('should compute min', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'min' });
      agg.processInsert(30);
      agg.processInsert(10);
      agg.processInsert(20);
      expect(agg.getValue()).toBe(10);
    });

    it('should compute max', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'max' });
      agg.processInsert(10);
      agg.processInsert(30);
      agg.processInsert(20);
      expect(agg.getValue()).toBe(30);
    });

    it('should handle delete and recompute min/max', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'min' });
      agg.processInsert(10);
      agg.processInsert(20);
      agg.processInsert(30);

      agg.processDelete(10);
      expect(agg.getValue()).toBe(20);
    });

    it('should handle update', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'sum' });
      agg.processInsert(10);
      agg.processInsert(20);
      agg.processUpdate(10, 50);
      expect(agg.getValue()).toBe(70);
    });

    it('should emit reactive updates', async () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'count' });
      const initial = await firstValueFrom(agg.value$);
      expect(initial).toBe(0);

      agg.processInsert(10);
      const updated = await firstValueFrom(agg.value$);
      expect(updated).toBe(1);
    });

    it('should reset state', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'sum' });
      agg.processInsert(10);
      agg.processInsert(20);
      agg.reset();
      expect(agg.getValue()).toBe(0);
    });

    it('should return 0 for empty aggregation', () => {
      const agg = createIncrementalAggregation({ field: 'amount', operation: 'avg' });
      expect(agg.getValue()).toBe(0);
    });

    it('should compute distinct_count', () => {
      const agg = createIncrementalAggregation({ field: 'category', operation: 'distinct_count' });
      agg.processInsert(1);
      agg.processInsert(2);
      agg.processInsert(1);
      expect(agg.getValue()).toBe(2);
    });
  });

  describe('DependencyGraph', () => {
    it('should add and track nodes', () => {
      const graph = createDependencyGraph();
      graph.addNode('orders');
      graph.addNode('products');
      expect(graph.nodes.size).toBe(2);
    });

    it('should add edges between nodes', () => {
      const graph = createDependencyGraph();
      graph.addEdge('orders', 'order-count-view');
      expect(graph.nodes.get('orders')).toContain('order-count-view');
    });

    it('should remove a node and its edges', () => {
      const graph = createDependencyGraph();
      graph.addEdge('orders', 'count-view');
      graph.addEdge('orders', 'sum-view');
      graph.removeNode('count-view');

      expect(graph.nodes.has('count-view')).toBe(false);
      expect(graph.nodes.get('orders')).not.toContain('count-view');
    });

    it('should get affected views for a changed source', () => {
      const graph = createDependencyGraph();
      graph.addEdge('orders', 'count-view');
      graph.addEdge('orders', 'sum-view');

      const affected = graph.getAffected('orders');
      expect(affected).toContain('count-view');
      expect(affected).toContain('sum-view');
    });

    it('should detect cycles', () => {
      const graph = createDependencyGraph();
      graph.addEdge('A', 'B');
      graph.addEdge('B', 'C');
      graph.addEdge('C', 'A');

      expect(graph.hasCycle()).toBe(true);
    });

    it('should report no cycle when there is none', () => {
      const graph = createDependencyGraph();
      graph.addEdge('A', 'B');
      graph.addEdge('B', 'C');

      expect(graph.hasCycle()).toBe(false);
    });

    it('should compute topological sort', () => {
      const graph = createDependencyGraph();
      graph.addEdge('A', 'B');
      graph.addEdge('A', 'C');
      graph.addEdge('B', 'D');
      graph.addEdge('C', 'D');

      const sorted = graph.topologicalSort();
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'));
      expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'));
      expect(sorted).toHaveLength(4);
    });

    it('should handle empty graph', () => {
      const graph = createDependencyGraph();
      expect(graph.hasCycle()).toBe(false);
      expect(graph.topologicalSort()).toEqual([]);
      expect(graph.getAffected('nonexistent')).toEqual([]);
    });
  });
});

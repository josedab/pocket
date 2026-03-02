import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeltaChange, IncrementalEngine } from '../incremental-engine.js';
import { createIncrementalEngine } from '../incremental-engine.js';
import type { ViewDefinitionConfig } from '../view-dsl.js';
import { defineView } from '../view-dsl.js';

describe('View DSL', () => {
  it('should create a basic view definition', () => {
    const config = defineView('order-summary', 'orders').build();

    expect(config.name).toBe('order-summary');
    expect(config.source).toBe('orders');
    expect(config.columns).toEqual([]);
    expect(config.filters).toEqual([]);
    expect(config.joins).toEqual([]);
    expect(config.aggregations).toEqual([]);
    expect(config.groupBy).toBeNull();
    expect(config.sort).toEqual([]);
    expect(config.refreshStrategy).toBe('debounced');
    expect(config.debounceMs).toBe(100);
  });

  it('should support select with string columns', () => {
    const config = defineView('v', 'orders').select('name', 'amount').build();
    expect(config.columns).toHaveLength(2);
    expect(config.columns[0]).toEqual({ name: 'name', source: 'orders' });
    expect(config.columns[1]).toEqual({ name: 'amount', source: 'orders' });
  });

  it('should support select with ViewColumn objects', () => {
    const config = defineView('v', 'orders')
      .select({ name: 'total', source: 'orders', alias: 'order_total' })
      .build();
    expect(config.columns[0].alias).toBe('order_total');
  });

  it('should support where filters', () => {
    const config = defineView('v', 'orders')
      .where('status', '$eq', 'active')
      .where('amount', '$gt', 100)
      .build();
    expect(config.filters).toHaveLength(2);
    expect(config.filters[0]).toEqual({ field: 'status', operator: '$eq', value: 'active' });
    expect(config.filters[1]).toEqual({ field: 'amount', operator: '$gt', value: 100 });
  });

  it('should support joins', () => {
    const config = defineView('v', 'orders')
      .join('products', 'p', { left: 'productId', right: 'id' })
      .build();
    expect(config.joins).toHaveLength(1);
    expect(config.joins[0].type).toBe('inner');
  });

  it('should support left joins', () => {
    const config = defineView('v', 'orders')
      .leftJoin('customers', 'c', { left: 'customerId', right: 'id' })
      .build();
    expect(config.joins[0].type).toBe('left');
  });

  it('should support aggregate helpers', () => {
    const config = defineView('v', 'orders')
      .count()
      .sum('amount')
      .avg('amount')
      .min('price')
      .max('price')
      .build();

    expect(config.aggregations).toHaveLength(5);
    expect(config.aggregations[0]).toEqual({ field: '*', op: 'count', alias: 'count' });
    expect(config.aggregations[1]).toEqual({ field: 'amount', op: 'sum', alias: 'sum_amount' });
    expect(config.aggregations[2]).toEqual({ field: 'amount', op: 'avg', alias: 'avg_amount' });
    expect(config.aggregations[3]).toEqual({ field: 'price', op: 'min', alias: 'min_price' });
    expect(config.aggregations[4]).toEqual({ field: 'price', op: 'max', alias: 'max_price' });
  });

  it('should support custom aggregate aliases', () => {
    const config = defineView('v', 'orders').sum('amount', 'total_amount').build();
    expect(config.aggregations[0].alias).toBe('total_amount');
  });

  it('should support groupBy', () => {
    const config = defineView('v', 'orders').groupByFields('category', 'status').build();
    expect(config.groupBy).toEqual({ fields: ['category', 'status'] });
  });

  it('should support orderBy', () => {
    const config = defineView('v', 'orders').orderBy('amount', 'desc').orderBy('name').build();
    expect(config.sort).toHaveLength(2);
    expect(config.sort[0]).toEqual({ field: 'amount', direction: 'desc' });
    expect(config.sort[1]).toEqual({ field: 'name', direction: 'asc' });
  });

  it('should support limit', () => {
    const config = defineView('v', 'orders').withLimit(10).build();
    expect(config.limit).toBe(10);
  });

  it('should support refresh strategies', () => {
    const config = defineView('v', 'orders').refreshOn('interval', { interval: 5000 }).build();
    expect(config.refreshStrategy).toBe('interval');
    expect(config.refreshInterval).toBe(5000);
  });

  it('should be fluent (chainable)', () => {
    const builder = defineView('summary', 'orders');
    const result = builder
      .select('name', 'amount')
      .where('status', '$eq', 'active')
      .count()
      .sum('amount')
      .groupByFields('category')
      .orderBy('amount', 'desc')
      .withLimit(50)
      .refreshOn('immediate');
    expect(result).toBe(builder);
  });
});

describe('IncrementalEngine', () => {
  let engine: IncrementalEngine;

  function makeChange(overrides: Partial<DeltaChange> = {}): DeltaChange {
    return {
      type: 'insert',
      collection: 'orders',
      documentId: '1',
      after: { name: 'Order 1', amount: 100, category: 'A' },
      timestamp: Date.now(),
      ...overrides,
    };
  }

  function immediateView(name: string, source = 'orders'): ViewDefinitionConfig {
    return defineView(name, source).refreshOn('immediate').build();
  }

  beforeEach(() => {
    engine = createIncrementalEngine();
  });

  afterEach(() => {
    engine.destroy();
  });

  it('should register a view', () => {
    engine.registerView(immediateView('v1'));
    expect(engine.getViewNames()).toContain('v1');
  });

  it('should throw on duplicate view registration', () => {
    engine.registerView(immediateView('v1'));
    expect(() => engine.registerView(immediateView('v1'))).toThrow('already registered');
  });

  it('should return null for unknown views', () => {
    expect(engine.getView('nonexistent')).toBeNull();
  });

  it('should process insert changes', () => {
    engine.registerView(immediateView('v1'));
    engine.pushChange(makeChange({ documentId: '1', after: { name: 'A', amount: 10 } }));

    const result = engine.getView('v1')!;
    expect(result.rows).toHaveLength(1);
    expect(result.metadata.rowCount).toBe(1);
  });

  it('should process update changes', () => {
    engine.registerView(immediateView('v1'));
    engine.pushChange(makeChange({ documentId: '1', after: { name: 'A', amount: 10 } }));
    engine.pushChange(
      makeChange({ type: 'update', documentId: '1', after: { name: 'A', amount: 20 } })
    );

    const result = engine.getView('v1')!;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ name: 'A', amount: 20 });
  });

  it('should process delete changes', () => {
    engine.registerView(immediateView('v1'));
    engine.pushChange(makeChange({ documentId: '1', after: { name: 'A', amount: 10 } }));
    engine.pushChange(makeChange({ type: 'delete', documentId: '1' }));

    const result = engine.getView('v1')!;
    expect(result.rows).toHaveLength(0);
  });

  describe('Filters', () => {
    it('should apply $eq filter', () => {
      const def = defineView('filtered', 'orders')
        .where('category', '$eq', 'A')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { category: 'A', amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { category: 'B', amount: 20 } }));

      expect(engine.getView('filtered')!.rows).toHaveLength(1);
    });

    it('should apply $gt filter', () => {
      const def = defineView('gt', 'orders')
        .where('amount', '$gt', 15)
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 20 } }));

      expect(engine.getView('gt')!.rows).toHaveLength(1);
    });

    it('should apply $in filter', () => {
      const def = defineView('in-filter', 'orders')
        .where('status', '$in', ['active', 'pending'])
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { status: 'active' } }));
      engine.pushChange(makeChange({ documentId: '2', after: { status: 'closed' } }));
      engine.pushChange(makeChange({ documentId: '3', after: { status: 'pending' } }));

      expect(engine.getView('in-filter')!.rows).toHaveLength(2);
    });

    it('should apply $regex filter', () => {
      const def = defineView('regex', 'orders')
        .where('name', '$regex', '^Order')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { name: 'Order 1' } }));
      engine.pushChange(makeChange({ documentId: '2', after: { name: 'Item 2' } }));

      expect(engine.getView('regex')!.rows).toHaveLength(1);
    });

    it('should remove doc on update if it no longer matches filter', () => {
      const def = defineView('f', 'orders')
        .where('amount', '$gte', 50)
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { amount: 100 } }));
      expect(engine.getView('f')!.rows).toHaveLength(1);

      engine.pushChange(makeChange({ type: 'update', documentId: '1', after: { amount: 10 } }));
      expect(engine.getView('f')!.rows).toHaveLength(0);
    });
  });

  describe('Aggregations', () => {
    function aggView(name: string): ViewDefinitionConfig {
      return defineView(name, 'orders')
        .count('total')
        .sum('amount', 'total_amount')
        .avg('amount', 'avg_amount')
        .min('amount', 'min_amount')
        .max('amount', 'max_amount')
        .refreshOn('immediate')
        .build();
    }

    it('should compute count', () => {
      engine.registerView(aggView('agg'));
      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 20 } }));

      const result = engine.getView('agg')!;
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveProperty('total', 2);
    });

    it('should compute sum', () => {
      engine.registerView(aggView('agg'));
      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 20 } }));

      expect(engine.getView('agg')!.rows[0]).toHaveProperty('total_amount', 30);
    });

    it('should compute avg', () => {
      engine.registerView(aggView('agg'));
      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 30 } }));

      expect(engine.getView('agg')!.rows[0]).toHaveProperty('avg_amount', 20);
    });

    it('should compute min', () => {
      engine.registerView(aggView('agg'));
      engine.pushChange(makeChange({ documentId: '1', after: { amount: 30 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 10 } }));

      expect(engine.getView('agg')!.rows[0]).toHaveProperty('min_amount', 10);
    });

    it('should compute max', () => {
      engine.registerView(aggView('agg'));
      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 30 } }));

      expect(engine.getView('agg')!.rows[0]).toHaveProperty('max_amount', 30);
    });
  });

  describe('GroupBy', () => {
    it('should produce correct groups', () => {
      const def = defineView('grouped', 'orders')
        .count('count')
        .sum('amount', 'total')
        .groupByFields('category')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { category: 'A', amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { category: 'B', amount: 20 } }));
      engine.pushChange(makeChange({ documentId: '3', after: { category: 'A', amount: 30 } }));

      const result = engine.getView('grouped')!;
      expect(result.rows).toHaveLength(2);

      const groupA = result.rows.find((r) => r.category === 'A');
      const groupB = result.rows.find((r) => r.category === 'B');
      expect(groupA).toBeDefined();
      expect(groupA!.count).toBe(2);
      expect(groupA!.total).toBe(40);
      expect(groupB).toBeDefined();
      expect(groupB!.count).toBe(1);
      expect(groupB!.total).toBe(20);
    });
  });

  describe('Sort and Limit', () => {
    it('should sort rows ascending', () => {
      const def = defineView('sorted', 'orders')
        .orderBy('amount', 'asc')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { amount: 30 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '3', after: { amount: 20 } }));

      const rows = engine.getView('sorted')!.rows;
      expect(rows[0]).toEqual({ amount: 10 });
      expect(rows[2]).toEqual({ amount: 30 });
    });

    it('should sort rows descending', () => {
      const def = defineView('sorted-desc', 'orders')
        .orderBy('amount', 'desc')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { amount: 10 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { amount: 30 } }));
      engine.pushChange(makeChange({ documentId: '3', after: { amount: 20 } }));

      const rows = engine.getView('sorted-desc')!.rows;
      expect(rows[0]).toEqual({ amount: 30 });
      expect(rows[2]).toEqual({ amount: 10 });
    });

    it('should apply limit', () => {
      const def = defineView('limited', 'orders').withLimit(2).refreshOn('immediate').build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { a: 1 } }));
      engine.pushChange(makeChange({ documentId: '2', after: { a: 2 } }));
      engine.pushChange(makeChange({ documentId: '3', after: { a: 3 } }));

      expect(engine.getView('limited')!.rows).toHaveLength(2);
    });
  });

  describe('Reactive Observable', () => {
    it('should return reactive observable via view$()', async () => {
      engine.registerView(immediateView('reactive'));

      const initial = await firstValueFrom(engine.view$('reactive'));
      expect(initial.rows).toHaveLength(0);

      engine.pushChange(makeChange({ documentId: '1', after: { x: 1 } }));

      const updated = await firstValueFrom(engine.view$('reactive'));
      expect(updated.rows).toHaveLength(1);
    });

    it('should throw for unknown view in view$()', () => {
      expect(() => engine.view$('nope')).toThrow('not found');
    });
  });

  describe('View removal and engine destruction', () => {
    it('should remove a view', () => {
      engine.registerView(immediateView('removable'));
      expect(engine.getViewNames()).toContain('removable');

      engine.removeView('removable');
      expect(engine.getViewNames()).not.toContain('removable');
      expect(engine.getView('removable')).toBeNull();
    });

    it('should destroy engine and clean up all views', () => {
      engine.registerView(immediateView('v1'));
      engine.registerView(immediateView('v2'));
      expect(engine.getViewNames()).toHaveLength(2);

      engine.destroy();
      expect(engine.getViewNames()).toHaveLength(0);
    });
  });

  describe('Manual refresh', () => {
    it('should manually refresh a view', () => {
      const def = defineView('manual-v', 'orders').refreshOn('immediate').build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { val: 42 } }));

      engine.refresh('manual-v');
      const result = engine.getView('manual-v')!;
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('Column selection', () => {
    it('should select specific columns', () => {
      const def = defineView('col-select', 'orders')
        .select('name', 'amount')
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(
        makeChange({
          documentId: '1',
          after: { name: 'Order 1', amount: 100, category: 'A', extra: 'data' },
        })
      );

      const rows = engine.getView('col-select')!.rows;
      expect(rows[0]).toEqual({ name: 'Order 1', amount: 100 });
      expect(rows[0]).not.toHaveProperty('category');
      expect(rows[0]).not.toHaveProperty('extra');
    });

    it('should support column aliases', () => {
      const def = defineView('col-alias', 'orders')
        .select({ name: 'amount', source: 'orders', alias: 'total' })
        .refreshOn('immediate')
        .build();
      engine.registerView(def);

      engine.pushChange(makeChange({ documentId: '1', after: { amount: 100 } }));

      const rows = engine.getView('col-alias')!.rows;
      expect(rows[0]).toEqual({ total: 100 });
    });
  });
});

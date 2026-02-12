import { describe, it, expect } from 'vitest';
import { VisualQueryModel, createVisualQueryModel } from '../visual-query-model.js';

describe('VisualQueryModel', () => {
  it('should create model with collection name', () => {
    const model = createVisualQueryModel('users');
    const plan = model.toQueryPlan();
    expect(plan.collection).toBe('users');
  });

  it('should add and get filters', () => {
    const model = new VisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.addFilter('age', 'gte', 18);

    const filters = model.getFilters();
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual({ field: 'status', operator: 'eq', value: 'active' });
    expect(filters[1]).toEqual({ field: 'age', operator: 'gte', value: 18 });
  });

  it('should remove filter by index', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.addFilter('age', 'gte', 18);

    model.removeFilter(0);
    const filters = model.getFilters();
    expect(filters).toHaveLength(1);
    expect(filters[0]!.field).toBe('age');
  });

  it('should update filter at index', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');

    model.updateFilter(0, { value: 'inactive' });
    const filters = model.getFilters();
    expect(filters[0]).toEqual({ field: 'status', operator: 'eq', value: 'inactive' });
  });

  it('should add and get sorts', () => {
    const model = createVisualQueryModel('users');
    model.addSort('name', 'asc');
    model.addSort('createdAt', 'desc');

    const sorts = model.getSorts();
    expect(sorts).toHaveLength(2);
    expect(sorts[0]).toEqual({ field: 'name', direction: 'asc' });
    expect(sorts[1]).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('should remove sort by index', () => {
    const model = createVisualQueryModel('users');
    model.addSort('name', 'asc');
    model.addSort('createdAt', 'desc');

    model.removeSort(0);
    const sorts = model.getSorts();
    expect(sorts).toHaveLength(1);
    expect(sorts[0]!.field).toBe('createdAt');
  });

  it('should set limit and offset', () => {
    const model = createVisualQueryModel('users');
    model.setLimit(10);
    model.setOffset(20);

    expect(model.getLimit()).toBe(10);

    const plan = model.toQueryPlan();
    expect(plan.pagination).toEqual({ limit: 10, skip: 20 });
  });

  it('should add and remove aggregates', () => {
    const model = createVisualQueryModel('orders');
    model.addAggregate('count', '*');
    model.addAggregate('sum', 'amount');

    const aggregates = model.getAggregates();
    expect(aggregates).toHaveLength(2);
    expect(aggregates[0]).toEqual({ function: 'count', field: '*' });
    expect(aggregates[1]).toEqual({ function: 'sum', field: 'amount' });

    model.removeAggregate(0);
    expect(model.getAggregates()).toHaveLength(1);
    expect(model.getAggregates()[0]!.field).toBe('amount');
  });

  it('should convert to query plan', () => {
    const model = createVisualQueryModel('products');
    model.addFilter('price', 'gte', 10);
    model.addFilter('category', 'eq', 'electronics');
    model.addSort('price', 'desc');
    model.setLimit(20);

    const plan = model.toQueryPlan();

    expect(plan.collection).toBe('products');
    expect(plan.where).toBeDefined();
    expect(plan.where!.operator).toBe('and');
    expect(plan.where!.conditions).toHaveLength(2);
    expect(plan.sort).toEqual([{ field: 'price', direction: 'desc' }]);
    expect(plan.pagination).toEqual({ limit: 20 });
  });

  it('should clone and create an independent copy', () => {
    const original = createVisualQueryModel('users');
    original.addFilter('status', 'eq', 'active');
    original.addSort('name', 'asc');
    original.setLimit(10);

    const cloned = original.clone();
    cloned.addFilter('age', 'gte', 18);
    cloned.setLimit(20);

    expect(original.getFilters()).toHaveLength(1);
    expect(cloned.getFilters()).toHaveLength(2);
    expect(original.getLimit()).toBe(10);
    expect(cloned.getLimit()).toBe(20);
  });

  it('should clear all conditions', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.addSort('name', 'asc');
    model.addAggregate('count', '*');
    model.setLimit(10);
    model.setOffset(5);

    model.clear();

    expect(model.getFilters()).toHaveLength(0);
    expect(model.getSorts()).toHaveLength(0);
    expect(model.getAggregates()).toHaveLength(0);
    expect(model.getLimit()).toBeUndefined();

    const plan = model.toQueryPlan();
    expect(plan.where).toBeUndefined();
    expect(plan.sort).toBeUndefined();
    expect(plan.pagination).toBeUndefined();
    expect(plan.aggregates).toBeUndefined();
  });
});

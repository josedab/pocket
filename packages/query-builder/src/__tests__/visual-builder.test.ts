import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VisualBuilder, createVisualBuilder } from '../visual-builder.js';
import type { FieldSchema } from '../visual-builder.js';

const schema: FieldSchema[] = [
  { name: 'name', type: 'string', required: true },
  { name: 'email', type: 'string', required: true },
  { name: 'age', type: 'number' },
  { name: 'isAdmin', type: 'boolean' },
  { name: 'createdAt', type: 'date' },
];

describe('VisualBuilder', () => {
  let builder: VisualBuilder;

  beforeEach(() => {
    builder = createVisualBuilder('users', schema);
  });

  afterEach(() => {
    builder.dispose();
  });

  describe('field selection', () => {
    it('should start with all fields selected', () => {
      expect(builder.state.selectedFields).toEqual(['name', 'email', 'age', 'isAdmin', 'createdAt']);
    });

    it('should toggle fields', () => {
      builder.toggleField('age');
      expect(builder.state.selectedFields).not.toContain('age');

      builder.toggleField('age');
      expect(builder.state.selectedFields).toContain('age');
    });

    it('should select and deselect all', () => {
      builder.deselectAllFields();
      expect(builder.state.selectedFields).toHaveLength(0);

      builder.selectAllFields();
      expect(builder.state.selectedFields).toHaveLength(5);
    });
  });

  describe('filters', () => {
    it('should add a filter condition', () => {
      const id = builder.addFilter('name', 'eq', 'Alice');
      expect(id).toBeDefined();
      expect(builder.state.filters.children).toHaveLength(1);
    });

    it('should add nested groups', () => {
      const groupId = builder.addGroup('or');
      builder.addFilter('age', 'gte', 18, groupId);
      builder.addFilter('isAdmin', 'eq', true, groupId);

      const group = builder.state.filters.children?.find((c) => c.id === groupId);
      expect(group?.logicalOperator).toBe('or');
      expect(group?.children).toHaveLength(2);
    });

    it('should remove a filter', () => {
      const id = builder.addFilter('name', 'eq', 'Alice');
      builder.removeFilter(id);
      expect(builder.state.filters.children).toHaveLength(0);
    });

    it('should update filter value', () => {
      const id = builder.addFilter('name', 'eq', 'Alice');
      builder.updateFilterValue(id, 'Bob');

      const node = builder.state.filters.children?.find((c) => c.id === id);
      expect(node?.value).toBe('Bob');
    });

    it('should update filter operator', () => {
      const id = builder.addFilter('name', 'eq', 'Alice');
      builder.updateFilterOperator(id, 'contains');

      const node = builder.state.filters.children?.find((c) => c.id === id);
      expect(node?.operator).toBe('contains');
    });

    it('should move filter between groups', () => {
      const filterId = builder.addFilter('name', 'eq', 'Alice');
      const groupId = builder.addGroup('or');

      builder.moveFilter(filterId, groupId);

      expect(builder.state.filters.children).toHaveLength(1); // only the group
      const group = builder.state.filters.children?.find((c) => c.id === groupId);
      expect(group?.children).toHaveLength(1);
    });
  });

  describe('sorting', () => {
    it('should add and remove sort clauses', () => {
      const id = builder.addSort('name', 'asc');
      expect(builder.state.sorts).toHaveLength(1);
      expect(builder.state.sorts[0]?.field).toBe('name');

      builder.removeSort(id);
      expect(builder.state.sorts).toHaveLength(0);
    });

    it('should default to ascending', () => {
      builder.addSort('age');
      expect(builder.state.sorts[0]?.direction).toBe('asc');
    });
  });

  describe('pagination', () => {
    it('should set limit and skip', () => {
      builder.setLimit(10);
      builder.setSkip(20);
      expect(builder.state.limit).toBe(10);
      expect(builder.state.skip).toBe(20);
    });

    it('should clear limit', () => {
      builder.setLimit(10);
      builder.setLimit(undefined);
      expect(builder.state.limit).toBeUndefined();
    });
  });

  describe('aggregates', () => {
    it('should add and remove aggregates', () => {
      const id = builder.addAggregate('count', 'name', 'total');
      expect(builder.state.aggregates).toHaveLength(1);
      expect(builder.state.aggregates[0]?.fn).toBe('count');

      builder.removeAggregate(id);
      expect(builder.state.aggregates).toHaveLength(0);
    });
  });

  describe('getOperatorsForField', () => {
    it('should return string operators', () => {
      const ops = builder.getOperatorsForField('name');
      expect(ops).toContain('eq');
      expect(ops).toContain('contains');
      expect(ops).toContain('startsWith');
    });

    it('should return number operators', () => {
      const ops = builder.getOperatorsForField('age');
      expect(ops).toContain('gt');
      expect(ops).toContain('between');
    });

    it('should return boolean operators', () => {
      const ops = builder.getOperatorsForField('isAdmin');
      expect(ops).toContain('eq');
      expect(ops).not.toContain('contains');
    });

    it('should return empty for unknown fields', () => {
      const ops = builder.getOperatorsForField('nonexistent');
      expect(ops).toHaveLength(0);
    });
  });

  describe('toQueryPlan', () => {
    it('should produce empty plan for no filters', () => {
      const plan = builder.toQueryPlan();
      expect(plan.collection).toBe('users');
      expect(plan.where).toBeUndefined();
    });

    it('should produce plan with filters', () => {
      builder.addFilter('name', 'eq', 'Alice');
      builder.addFilter('age', 'gte', 18);

      const plan = builder.toQueryPlan();
      expect(plan.where?.operator).toBe('and');
      expect(plan.where?.conditions).toHaveLength(2);
    });

    it('should include sort in plan', () => {
      builder.addSort('name', 'desc');
      const plan = builder.toQueryPlan();
      expect(plan.sort).toHaveLength(1);
      expect(plan.sort?.[0]?.direction).toBe('desc');
    });

    it('should include pagination in plan', () => {
      builder.setLimit(10);
      builder.setSkip(5);
      const plan = builder.toQueryPlan();
      expect(plan.pagination?.limit).toBe(10);
      expect(plan.pagination?.skip).toBe(5);
    });

    it('should include aggregates in plan', () => {
      builder.addAggregate('avg', 'age', 'avgAge');
      const plan = builder.toQueryPlan();
      expect(plan.aggregates).toHaveLength(1);
      expect(plan.aggregates?.[0]?.function).toBe('avg');
    });

    it('should only include select when not all fields', () => {
      builder.toggleField('age');
      const plan = builder.toQueryPlan();
      expect(plan.select).toBeDefined();
      expect(plan.select?.fields).not.toContain('age');
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      builder.addFilter('name', 'eq', 'Alice');
      builder.addSort('age', 'desc');
      builder.setLimit(5);

      builder.reset();

      expect(builder.state.filters.children).toHaveLength(0);
      expect(builder.state.sorts).toHaveLength(0);
      expect(builder.state.limit).toBeUndefined();
      expect(builder.state.selectedFields).toHaveLength(5);
    });
  });

  describe('observables', () => {
    it('should emit state changes', () => {
      const states: unknown[] = [];
      builder.state$.subscribe((s) => states.push(s));

      builder.addFilter('name', 'eq', 'Alice');

      expect(states.length).toBeGreaterThanOrEqual(2); // initial + update
    });

    it('should emit events', () => {
      const events: unknown[] = [];
      builder.events$.subscribe((e) => { if (e) events.push(e); });

      builder.addFilter('name', 'eq', 'test');

      expect(events.length).toBeGreaterThan(0);
    });
  });
});

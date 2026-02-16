/**
 * Visual Query Builder — no-code query construction interface.
 *
 * Provides a programmatic model for visually building Pocket queries through
 * drag-and-drop filter groups, field selection, and sort configuration.
 * Outputs a QueryPlan that can be executed, serialized to code, or optimized.
 *
 * @module @pocket/query-builder
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type {
  FilterCondition,
  FilterOperator,
  LogicalGroup,
  LogicalOperator,
  QueryPlan,
  SortDirection,
  AggregateFunction,
} from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface FieldSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  required?: boolean;
}

export interface VisualFilterNode {
  id: string;
  type: 'condition' | 'group';
  /** For condition nodes */
  field?: string;
  operator?: FilterOperator;
  value?: unknown;
  /** For group nodes */
  logicalOperator?: LogicalOperator;
  children?: VisualFilterNode[];
}

export interface VisualSortNode {
  id: string;
  field: string;
  direction: SortDirection;
}

export interface VisualAggregateNode {
  id: string;
  fn: AggregateFunction;
  field: string;
  alias?: string;
}

export interface VisualBuilderState {
  collection: string;
  selectedFields: string[];
  filters: VisualFilterNode;
  sorts: VisualSortNode[];
  aggregates: VisualAggregateNode[];
  limit?: number;
  skip?: number;
}

export interface VisualBuilderEvent {
  type: 'filter-added' | 'filter-removed' | 'filter-updated' | 'sort-added'
    | 'sort-removed' | 'field-toggled' | 'limit-changed' | 'state-reset';
  nodeId?: string;
  timestamp: number;
}

/** Operators available for each field type */
export const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  string: ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'nin', 'regex', 'exists'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'nin', 'exists'],
  boolean: ['eq', 'neq', 'exists'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  array: ['contains', 'exists'],
  object: ['exists'],
};

// ── Visual Builder ────────────────────────────────────────

/**
 * Programmatic visual query builder that manages filter trees,
 * field selection, and sort configuration as observable state.
 *
 * Designed to back a drag-and-drop UI component while remaining
 * framework-agnostic. All state changes emit through RxJS observables.
 */
export class VisualBuilder {
  private readonly stateSubject: BehaviorSubject<VisualBuilderState>;
  private readonly eventsSubject: BehaviorSubject<VisualBuilderEvent | null>;
  private readonly schema: FieldSchema[];
  private nextId = 1;

  constructor(collection: string, schema: FieldSchema[]) {
    this.schema = schema;
    this.stateSubject = new BehaviorSubject<VisualBuilderState>({
      collection,
      selectedFields: schema.map((f) => f.name),
      filters: this.createGroup('and'),
      sorts: [],
      aggregates: [],
    });
    this.eventsSubject = new BehaviorSubject<VisualBuilderEvent | null>(null);
  }

  /** Current builder state */
  get state$(): Observable<VisualBuilderState> {
    return this.stateSubject.asObservable();
  }

  /** Builder events */
  get events$(): Observable<VisualBuilderEvent | null> {
    return this.eventsSubject.asObservable();
  }

  /** Current state snapshot */
  get state(): VisualBuilderState {
    return this.stateSubject.getValue();
  }

  /** Available fields from the schema */
  get fields(): FieldSchema[] {
    return [...this.schema];
  }

  /** Get available operators for a given field */
  getOperatorsForField(fieldName: string): FilterOperator[] {
    const field = this.schema.find((f) => f.name === fieldName);
    if (!field) return [];
    return OPERATORS_BY_TYPE[field.type] ?? ['eq', 'neq', 'exists'];
  }

  // ── Field Selection ───────────────────────────────────

  /** Toggle a field in the result projection */
  toggleField(fieldName: string): void {
    const state = this.stateSubject.getValue();
    const idx = state.selectedFields.indexOf(fieldName);
    const selectedFields = [...state.selectedFields];

    if (idx >= 0) {
      selectedFields.splice(idx, 1);
    } else {
      selectedFields.push(fieldName);
    }

    this.update({ ...state, selectedFields });
    this.emit('field-toggled');
  }

  /** Select all fields */
  selectAllFields(): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, selectedFields: this.schema.map((f) => f.name) });
    this.emit('field-toggled');
  }

  /** Deselect all fields */
  deselectAllFields(): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, selectedFields: [] });
    this.emit('field-toggled');
  }

  // ── Filters ───────────────────────────────────────────

  /** Add a filter condition to a group (defaults to root group) */
  addFilter(
    field: string,
    operator: FilterOperator,
    value: unknown,
    parentGroupId?: string,
  ): string {
    const state = this.stateSubject.getValue();
    const condition: VisualFilterNode = {
      id: this.genId(),
      type: 'condition',
      field,
      operator,
      value,
    };

    const filters = this.cloneNode(state.filters);
    const parent = parentGroupId ? this.findNode(filters, parentGroupId) : filters;
    if (parent?.children) {
      parent.children.push(condition);
    }

    this.update({ ...state, filters });
    this.emit('filter-added', condition.id);
    return condition.id;
  }

  /** Add a logical group (AND/OR/NOT) */
  addGroup(logicalOperator: LogicalOperator, parentGroupId?: string): string {
    const state = this.stateSubject.getValue();
    const group = this.createGroup(logicalOperator);
    const filters = this.cloneNode(state.filters);
    const parent = parentGroupId ? this.findNode(filters, parentGroupId) : filters;
    if (parent?.children) {
      parent.children.push(group);
    }

    this.update({ ...state, filters });
    this.emit('filter-added', group.id);
    return group.id;
  }

  /** Remove a filter node by ID */
  removeFilter(nodeId: string): void {
    const state = this.stateSubject.getValue();
    const filters = this.cloneNode(state.filters);
    this.removeNode(filters, nodeId);
    this.update({ ...state, filters });
    this.emit('filter-removed', nodeId);
  }

  /** Update a filter condition's value */
  updateFilterValue(nodeId: string, value: unknown): void {
    const state = this.stateSubject.getValue();
    const filters = this.cloneNode(state.filters);
    const node = this.findNode(filters, nodeId);
    if (node && node.type === 'condition') {
      node.value = value;
    }
    this.update({ ...state, filters });
    this.emit('filter-updated', nodeId);
  }

  /** Update a filter condition's operator */
  updateFilterOperator(nodeId: string, operator: FilterOperator): void {
    const state = this.stateSubject.getValue();
    const filters = this.cloneNode(state.filters);
    const node = this.findNode(filters, nodeId);
    if (node && node.type === 'condition') {
      node.operator = operator;
    }
    this.update({ ...state, filters });
    this.emit('filter-updated', nodeId);
  }

  /** Move a filter node to a different parent group */
  moveFilter(nodeId: string, targetGroupId: string): void {
    const state = this.stateSubject.getValue();
    const filters = this.cloneNode(state.filters);
    const node = this.findAndDetach(filters, nodeId);
    if (!node) return;

    const target = this.findNode(filters, targetGroupId);
    if (target?.children) {
      target.children.push(node);
    }
    this.update({ ...state, filters });
    this.emit('filter-updated', nodeId);
  }

  // ── Sorting ───────────────────────────────────────────

  /** Add a sort clause */
  addSort(field: string, direction: SortDirection = 'asc'): string {
    const state = this.stateSubject.getValue();
    const sort: VisualSortNode = { id: this.genId(), field, direction };
    this.update({ ...state, sorts: [...state.sorts, sort] });
    this.emit('sort-added', sort.id);
    return sort.id;
  }

  /** Remove a sort clause */
  removeSort(sortId: string): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, sorts: state.sorts.filter((s) => s.id !== sortId) });
    this.emit('sort-removed', sortId);
  }

  // ── Pagination ────────────────────────────────────────

  /** Set result limit */
  setLimit(limit: number | undefined): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, limit });
    this.emit('limit-changed');
  }

  /** Set result offset */
  setSkip(skip: number | undefined): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, skip });
    this.emit('limit-changed');
  }

  // ── Aggregates ────────────────────────────────────────

  /** Add an aggregate function */
  addAggregate(fn: AggregateFunction, field: string, alias?: string): string {
    const state = this.stateSubject.getValue();
    const agg: VisualAggregateNode = { id: this.genId(), fn, field, alias };
    this.update({ ...state, aggregates: [...state.aggregates, agg] });
    return agg.id;
  }

  /** Remove an aggregate */
  removeAggregate(aggId: string): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, aggregates: state.aggregates.filter((a) => a.id !== aggId) });
  }

  // ── Output ────────────────────────────────────────────

  /** Convert the current visual state to a QueryPlan */
  toQueryPlan(): QueryPlan {
    const state = this.stateSubject.getValue();

    const plan: QueryPlan = {
      collection: state.collection,
    };

    if (state.selectedFields.length > 0 && state.selectedFields.length < this.schema.length) {
      plan.select = { fields: [...state.selectedFields] };
    }

    const where = this.nodeToLogicalGroup(state.filters);
    if (where.conditions.length > 0) {
      plan.where = where;
    }

    if (state.sorts.length > 0) {
      plan.sort = state.sorts.map((s) => ({ field: s.field, direction: s.direction }));
    }

    if (state.limit !== undefined || state.skip !== undefined) {
      plan.pagination = {};
      if (state.limit !== undefined) plan.pagination.limit = state.limit;
      if (state.skip !== undefined) plan.pagination.skip = state.skip;
    }

    if (state.aggregates.length > 0) {
      plan.aggregates = state.aggregates.map((a) => ({
        function: a.fn,
        field: a.field,
        alias: a.alias,
      }));
    }

    return plan;
  }

  /** Reset the builder to initial state */
  reset(): void {
    this.stateSubject.next({
      collection: this.state.collection,
      selectedFields: this.schema.map((f) => f.name),
      filters: this.createGroup('and'),
      sorts: [],
      aggregates: [],
    });
    this.emit('state-reset');
  }

  /** Clean up observables */
  dispose(): void {
    this.stateSubject.complete();
    this.eventsSubject.complete();
  }

  // ── Internals ─────────────────────────────────────────

  private genId(): string {
    return `vn-${this.nextId++}`;
  }

  private createGroup(operator: LogicalOperator): VisualFilterNode {
    return {
      id: this.genId(),
      type: 'group',
      logicalOperator: operator,
      children: [],
    };
  }

  private cloneNode(node: VisualFilterNode): VisualFilterNode {
    return JSON.parse(JSON.stringify(node)) as VisualFilterNode;
  }

  private findNode(root: VisualFilterNode, id: string): VisualFilterNode | undefined {
    if (root.id === id) return root;
    for (const child of root.children ?? []) {
      const found = this.findNode(child, id);
      if (found) return found;
    }
    return undefined;
  }

  private removeNode(root: VisualFilterNode, id: string): boolean {
    if (!root.children) return false;
    const idx = root.children.findIndex((c) => c.id === id);
    if (idx >= 0) {
      root.children.splice(idx, 1);
      return true;
    }
    return root.children.some((c) => this.removeNode(c, id));
  }

  private findAndDetach(root: VisualFilterNode, id: string): VisualFilterNode | undefined {
    if (!root.children) return undefined;
    const idx = root.children.findIndex((c) => c.id === id);
    if (idx >= 0) {
      return root.children.splice(idx, 1)[0];
    }
    for (const child of root.children) {
      const found = this.findAndDetach(child, id);
      if (found) return found;
    }
    return undefined;
  }

  private nodeToLogicalGroup(node: VisualFilterNode): LogicalGroup {
    const conditions: (FilterCondition | LogicalGroup)[] = [];

    for (const child of node.children ?? []) {
      if (child.type === 'condition' && child.field && child.operator) {
        conditions.push({
          field: child.field,
          operator: child.operator,
          value: child.value,
        });
      } else if (child.type === 'group') {
        const group = this.nodeToLogicalGroup(child);
        if (group.conditions.length > 0) {
          conditions.push(group);
        }
      }
    }

    return {
      operator: node.logicalOperator ?? 'and',
      conditions,
    };
  }

  private update(state: VisualBuilderState): void {
    this.stateSubject.next(state);
  }

  private emit(type: VisualBuilderEvent['type'], nodeId?: string): void {
    this.eventsSubject.next({ type, nodeId, timestamp: Date.now() });
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new visual query builder for a collection */
export function createVisualBuilder(collection: string, schema: FieldSchema[]): VisualBuilder {
  return new VisualBuilder(collection, schema);
}

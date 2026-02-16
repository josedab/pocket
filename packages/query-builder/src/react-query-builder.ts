/**
 * React Query Builder Components for Pocket
 *
 * Provides component models and state management for building
 * drag-and-drop visual query builders. Framework-agnostic core
 * that emits state via observables for consumption by React, Vue, etc.
 *
 * @module react-query-builder
 *
 * @example
 * ```typescript
 * import { createReactQueryBuilder } from '@pocket/query-builder';
 *
 * const builder = createReactQueryBuilder({
 *   collections: [
 *     { name: 'users', fields: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }] }
 *   ],
 *   defaultCollection: 'users',
 * });
 *
 * builder.toggleField('name');
 * builder.addFilter('age');
 * builder.updateFilter('f-1', { operator: 'gte', value: 18 });
 * builder.addSort('name');
 *
 * const plan = builder.generateQuery();
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link VisualBuilder}
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { AggregateFunction, FilterOperator, QueryPlan, SortDirection } from './types.js';

// ── Helpers ──────────────────────────────────────────────

let _nextId = 1;

/**
 * Generates a unique identifier for UI elements.
 * @internal
 */
function generateId(prefix: string): string {
  return `${prefix}-${_nextId++}`;
}

// ── Types ────────────────────────────────────────────────

/**
 * An item that can be dragged in the visual query builder.
 *
 * @example
 * ```typescript
 * const item: DragItem = {
 *   id: 'drag-1',
 *   type: 'field',
 *   data: { fieldName: 'email' },
 * };
 * ```
 */
export interface DragItem {
  /** Unique identifier for the drag item */
  id: string;
  /** The category of the dragged element */
  type: 'field' | 'filter' | 'sort' | 'aggregate';
  /** Arbitrary payload associated with the drag item */
  data: Record<string, unknown>;
}

/**
 * A zone that accepts dropped items in the visual builder.
 *
 * @example
 * ```typescript
 * const zone: DropZone = {
 *   id: 'filters-zone',
 *   accepts: ['filter'],
 *   items: [],
 *   maxItems: 10,
 * };
 * ```
 */
export interface DropZone {
  /** Unique identifier for the drop zone */
  id: string;
  /** Item types this zone accepts */
  accepts: DragItem['type'][];
  /** Currently placed items */
  items: DragItem[];
  /** Maximum number of items allowed */
  maxItems?: number;
}

/**
 * A single filter row in the visual query builder.
 *
 * @see {@link ReactQueryBuilder.addFilter}
 */
export interface FilterRowModel {
  /** Unique identifier for the filter row */
  id: string;
  /** The document field to filter on */
  field: string;
  /** The comparison operator */
  operator: FilterOperator;
  /** The value to compare against */
  value: unknown;
  /** Whether this filter is active */
  enabled: boolean;
  /** Logical connector to the previous filter */
  logicalOperator?: 'and' | 'or';
}

/**
 * A single sort row in the visual query builder.
 *
 * @see {@link ReactQueryBuilder.addSort}
 */
export interface SortRowModel {
  /** Unique identifier for the sort row */
  id: string;
  /** The document field to sort by */
  field: string;
  /** The sort direction */
  direction: SortDirection;
}

/**
 * A single aggregate row in the visual query builder.
 *
 * @see {@link ReactQueryBuilder.addAggregate}
 */
export interface AggregateRowModel {
  /** Unique identifier for the aggregate row */
  id: string;
  /** The aggregate function to apply */
  function: AggregateFunction;
  /** The field to aggregate */
  field: string;
  /** Optional alias for the computed result */
  alias?: string;
}

/**
 * Complete UI state of the visual query builder.
 *
 * @see {@link ReactQueryBuilder.state$}
 */
export interface QueryBuilderUIState {
  /** The selected collection name */
  collection: string;
  /** Fields included in the result projection */
  selectedFields: string[];
  /** Active filter rows */
  filters: FilterRowModel[];
  /** Active sort rows */
  sorts: SortRowModel[];
  /** Active aggregate rows */
  aggregates: AggregateRowModel[];
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
  /** Whether the builder has unsaved changes */
  isDirty: boolean;
  /** Current validation errors */
  validationErrors: string[];
  /** The generated query plan, if available */
  generatedQuery?: QueryPlan;
  /** The generated code string, if available */
  generatedCode?: string;
}

/**
 * Configuration for the visual query builder.
 *
 * @example
 * ```typescript
 * const config: QueryBuilderUIConfig = {
 *   collections: [
 *     { name: 'users', fields: [{ name: 'name', type: 'string' }] },
 *   ],
 *   defaultCollection: 'users',
 *   enableDragDrop: true,
 *   enableLivePreview: true,
 * };
 * ```
 *
 * @see {@link createReactQueryBuilder}
 */
export interface QueryBuilderUIConfig {
  /** Available collections and their field schemas */
  collections: { name: string; fields: { name: string; type: string }[] }[];
  /** Collection to select on initialization */
  defaultCollection?: string;
  /** Enable drag-and-drop reordering */
  enableDragDrop?: boolean;
  /** Enable live query preview */
  enableLivePreview?: boolean;
  /** Enable code generation output */
  enableCodeGeneration?: boolean;
  /** Maximum number of filter rows allowed */
  maxFilters?: number;
  /** Maximum number of sort rows allowed */
  maxSorts?: number;
}

/**
 * An event emitted by the visual query builder.
 *
 * @see {@link ReactQueryBuilder.events$}
 */
export interface QueryBuilderUIEvent {
  /** The type of event that occurred */
  type:
    | 'collection-changed'
    | 'field-toggled'
    | 'filter-added'
    | 'filter-removed'
    | 'filter-updated'
    | 'sort-added'
    | 'sort-removed'
    | 'sort-updated'
    | 'aggregate-added'
    | 'aggregate-removed'
    | 'limit-changed'
    | 'reset'
    | 'query-generated';
  /** Timestamp of the event */
  timestamp: number;
  /** Optional event payload */
  data?: unknown;
}

// ── ReactQueryBuilder ────────────────────────────────────

/**
 * Reactive visual query builder that manages UI state for constructing
 * Pocket queries through drag-and-drop interfaces.
 *
 * Designed to be framework-agnostic: all state changes emit through
 * RxJS observables for consumption by React, Vue, Angular, or vanilla JS.
 *
 * @example
 * ```typescript
 * const builder = new ReactQueryBuilder({
 *   collections: [
 *     { name: 'users', fields: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }] }
 *   ],
 * });
 *
 * builder.state$.subscribe((state) => console.log('State changed:', state));
 * builder.setCollection('users');
 * builder.addFilter('age');
 * builder.updateFilter('f-1', { operator: 'gte', value: 18 });
 *
 * const plan = builder.generateQuery();
 * builder.dispose();
 * ```
 *
 * @see {@link createReactQueryBuilder}
 * @see {@link QueryBuilderUIConfig}
 * @see {@link QueryBuilderUIState}
 */
export class ReactQueryBuilder {
  private readonly stateSubject: BehaviorSubject<QueryBuilderUIState>;
  private readonly eventsSubject: Subject<QueryBuilderUIEvent>;
  private readonly config: QueryBuilderUIConfig;

  /**
   * Creates a new ReactQueryBuilder.
   *
   * @param config - The builder configuration
   */
  constructor(config: QueryBuilderUIConfig) {
    this.config = config;

    const initialCollection = config.defaultCollection ?? config.collections[0]?.name ?? '';
    const collectionDef = config.collections.find((c) => c.name === initialCollection);
    const initialFields = collectionDef?.fields.map((f) => f.name) ?? [];

    this.stateSubject = new BehaviorSubject<QueryBuilderUIState>({
      collection: initialCollection,
      selectedFields: initialFields,
      filters: [],
      sorts: [],
      aggregates: [],
      isDirty: false,
      validationErrors: [],
    });
    this.eventsSubject = new Subject<QueryBuilderUIEvent>();
  }

  /** Observable stream of UI state changes */
  get state$(): Observable<QueryBuilderUIState> {
    return this.stateSubject.asObservable();
  }

  /** Observable stream of builder events */
  get events$(): Observable<QueryBuilderUIEvent> {
    return this.eventsSubject.asObservable();
  }

  // ── Collection ───────────────────────────────────────

  /**
   * Sets the active collection and resets field selection.
   *
   * @param name - The collection name
   *
   * @example
   * ```typescript
   * builder.setCollection('products');
   * ```
   */
  setCollection(name: string): void {
    const collectionDef = this.config.collections.find((c) => c.name === name);
    const fields = collectionDef?.fields.map((f) => f.name) ?? [];

    this.update({
      ...this.stateSubject.getValue(),
      collection: name,
      selectedFields: fields,
      filters: [],
      sorts: [],
      aggregates: [],
      isDirty: true,
    });
    this.emit('collection-changed', { collection: name });
  }

  // ── Field Selection ──────────────────────────────────

  /**
   * Toggles a field in the result projection.
   *
   * @param fieldName - The field name to toggle
   *
   * @example
   * ```typescript
   * builder.toggleField('email');
   * ```
   */
  toggleField(fieldName: string): void {
    const state = this.stateSubject.getValue();
    const idx = state.selectedFields.indexOf(fieldName);
    const selectedFields = [...state.selectedFields];

    if (idx >= 0) {
      selectedFields.splice(idx, 1);
    } else {
      selectedFields.push(fieldName);
    }

    this.update({ ...state, selectedFields, isDirty: true });
    this.emit('field-toggled', { field: fieldName });
  }

  // ── Filters ──────────────────────────────────────────

  /**
   * Adds a new filter row.
   *
   * @param field - Optional initial field name (defaults to first available field)
   * @returns The created filter row model
   *
   * @example
   * ```typescript
   * const filter = builder.addFilter('status');
   * builder.updateFilter(filter.id, { operator: 'eq', value: 'active' });
   * ```
   */
  addFilter(field?: string): FilterRowModel {
    const state = this.stateSubject.getValue();

    if (this.config.maxFilters !== undefined && state.filters.length >= this.config.maxFilters) {
      return state.filters[state.filters.length - 1]!;
    }

    const collectionDef = this.config.collections.find((c) => c.name === state.collection);
    const defaultField = field ?? collectionDef?.fields[0]?.name ?? '';

    const filter: FilterRowModel = {
      id: generateId('f'),
      field: defaultField,
      operator: 'eq',
      value: '',
      enabled: true,
      logicalOperator: state.filters.length > 0 ? 'and' : undefined,
    };

    this.update({ ...state, filters: [...state.filters, filter], isDirty: true });
    this.emit('filter-added', { filterId: filter.id });
    return filter;
  }

  /**
   * Updates an existing filter row.
   *
   * @param id - The filter row ID
   * @param updates - Partial filter fields to update
   *
   * @example
   * ```typescript
   * builder.updateFilter('f-1', { operator: 'gte', value: 18 });
   * ```
   */
  updateFilter(id: string, updates: Partial<FilterRowModel>): void {
    const state = this.stateSubject.getValue();
    const filters = state.filters.map((f) => (f.id === id ? { ...f, ...updates } : f));

    this.update({ ...state, filters, isDirty: true });
    this.emit('filter-updated', { filterId: id });
  }

  /**
   * Removes a filter row by ID.
   *
   * @param id - The filter row ID
   *
   * @example
   * ```typescript
   * builder.removeFilter('f-1');
   * ```
   */
  removeFilter(id: string): void {
    const state = this.stateSubject.getValue();
    const filters = state.filters.filter((f) => f.id !== id);

    // Clear logical operator from first remaining filter
    if (filters.length > 0 && filters[0]!.logicalOperator) {
      filters[0] = { ...filters[0]!, logicalOperator: undefined };
    }

    this.update({ ...state, filters, isDirty: true });
    this.emit('filter-removed', { filterId: id });
  }

  // ── Sorts ────────────────────────────────────────────

  /**
   * Adds a new sort row.
   *
   * @param field - Optional initial field name
   * @returns The created sort row model
   *
   * @example
   * ```typescript
   * const sort = builder.addSort('name');
   * ```
   */
  addSort(field?: string): SortRowModel {
    const state = this.stateSubject.getValue();

    if (this.config.maxSorts !== undefined && state.sorts.length >= this.config.maxSorts) {
      return state.sorts[state.sorts.length - 1]!;
    }

    const collectionDef = this.config.collections.find((c) => c.name === state.collection);
    const defaultField = field ?? collectionDef?.fields[0]?.name ?? '';

    const sort: SortRowModel = {
      id: generateId('s'),
      field: defaultField,
      direction: 'asc',
    };

    this.update({ ...state, sorts: [...state.sorts, sort], isDirty: true });
    this.emit('sort-added', { sortId: sort.id });
    return sort;
  }

  /**
   * Updates an existing sort row.
   *
   * @param id - The sort row ID
   * @param updates - Partial sort fields to update
   *
   * @example
   * ```typescript
   * builder.updateSort('s-1', { direction: 'desc' });
   * ```
   */
  updateSort(id: string, updates: Partial<SortRowModel>): void {
    const state = this.stateSubject.getValue();
    const sorts = state.sorts.map((s) => (s.id === id ? { ...s, ...updates } : s));

    this.update({ ...state, sorts, isDirty: true });
    this.emit('sort-updated', { sortId: id });
  }

  /**
   * Removes a sort row by ID.
   *
   * @param id - The sort row ID
   *
   * @example
   * ```typescript
   * builder.removeSort('s-1');
   * ```
   */
  removeSort(id: string): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, sorts: state.sorts.filter((s) => s.id !== id), isDirty: true });
    this.emit('sort-removed', { sortId: id });
  }

  // ── Aggregates ───────────────────────────────────────

  /**
   * Adds a new aggregate row.
   *
   * @param fn - The aggregate function (defaults to 'count')
   * @param field - The field to aggregate (defaults to first available field)
   * @returns The created aggregate row model
   *
   * @example
   * ```typescript
   * const agg = builder.addAggregate('avg', 'price');
   * ```
   */
  addAggregate(fn?: AggregateFunction, field?: string): AggregateRowModel {
    const state = this.stateSubject.getValue();
    const collectionDef = this.config.collections.find((c) => c.name === state.collection);
    const defaultField = field ?? collectionDef?.fields[0]?.name ?? '';

    const aggregate: AggregateRowModel = {
      id: generateId('a'),
      function: fn ?? 'count',
      field: defaultField,
    };

    this.update({ ...state, aggregates: [...state.aggregates, aggregate], isDirty: true });
    this.emit('aggregate-added', { aggregateId: aggregate.id });
    return aggregate;
  }

  /**
   * Removes an aggregate row by ID.
   *
   * @param id - The aggregate row ID
   *
   * @example
   * ```typescript
   * builder.removeAggregate('a-1');
   * ```
   */
  removeAggregate(id: string): void {
    const state = this.stateSubject.getValue();
    this.update({
      ...state,
      aggregates: state.aggregates.filter((a) => a.id !== id),
      isDirty: true,
    });
    this.emit('aggregate-removed', { aggregateId: id });
  }

  // ── Pagination ───────────────────────────────────────

  /**
   * Sets the result limit.
   *
   * @param limit - Maximum number of results, or undefined to clear
   *
   * @example
   * ```typescript
   * builder.setLimit(25);
   * ```
   */
  setLimit(limit: number | undefined): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, limit, isDirty: true });
    this.emit('limit-changed', { limit });
  }

  /**
   * Sets the result offset.
   *
   * @param offset - Number of results to skip, or undefined to clear
   *
   * @example
   * ```typescript
   * builder.setOffset(10);
   * ```
   */
  setOffset(offset: number | undefined): void {
    const state = this.stateSubject.getValue();
    this.update({ ...state, offset, isDirty: true });
    this.emit('limit-changed', { offset });
  }

  // ── Reordering ───────────────────────────────────────

  /**
   * Moves a filter row from one index to another.
   *
   * @param fromIndex - The source index
   * @param toIndex - The destination index
   *
   * @example
   * ```typescript
   * builder.moveFilter(0, 2);
   * ```
   */
  moveFilter(fromIndex: number, toIndex: number): void {
    const state = this.stateSubject.getValue();
    const filters = [...state.filters];

    if (fromIndex < 0 || fromIndex >= filters.length) return;
    if (toIndex < 0 || toIndex >= filters.length) return;

    const [moved] = filters.splice(fromIndex, 1);
    filters.splice(toIndex, 0, moved!);

    this.update({ ...state, filters, isDirty: true });
    this.emit('filter-updated', { fromIndex, toIndex });
  }

  /**
   * Moves a sort row from one index to another.
   *
   * @param fromIndex - The source index
   * @param toIndex - The destination index
   *
   * @example
   * ```typescript
   * builder.moveSort(0, 1);
   * ```
   */
  moveSort(fromIndex: number, toIndex: number): void {
    const state = this.stateSubject.getValue();
    const sorts = [...state.sorts];

    if (fromIndex < 0 || fromIndex >= sorts.length) return;
    if (toIndex < 0 || toIndex >= sorts.length) return;

    const [moved] = sorts.splice(fromIndex, 1);
    sorts.splice(toIndex, 0, moved!);

    this.update({ ...state, sorts, isDirty: true });
    this.emit('sort-updated', { fromIndex, toIndex });
  }

  // ── Output ───────────────────────────────────────────

  /**
   * Generates a {@link QueryPlan} from the current UI state.
   *
   * @returns The generated query plan
   *
   * @example
   * ```typescript
   * const plan = builder.generateQuery();
   * console.log(plan.collection);
   * console.log(plan.where?.conditions.length);
   * ```
   */
  generateQuery(): QueryPlan {
    const state = this.stateSubject.getValue();
    const plan: QueryPlan = {
      collection: state.collection,
    };

    // Select
    const collectionDef = this.config.collections.find((c) => c.name === state.collection);
    const allFields = collectionDef?.fields.map((f) => f.name) ?? [];
    if (state.selectedFields.length > 0 && state.selectedFields.length < allFields.length) {
      plan.select = { fields: [...state.selectedFields] };
    }

    // Where
    const enabledFilters = state.filters.filter((f) => f.enabled);
    if (enabledFilters.length > 0) {
      plan.where = {
        operator: 'and',
        conditions: enabledFilters.map((f) => ({
          field: f.field,
          operator: f.operator,
          value: f.value,
        })),
      };
    }

    // Sort
    if (state.sorts.length > 0) {
      plan.sort = state.sorts.map((s) => ({ field: s.field, direction: s.direction }));
    }

    // Pagination
    if (state.limit !== undefined || state.offset !== undefined) {
      plan.pagination = {};
      if (state.limit !== undefined) plan.pagination.limit = state.limit;
      if (state.offset !== undefined) plan.pagination.skip = state.offset;
    }

    // Aggregates
    if (state.aggregates.length > 0) {
      plan.aggregates = state.aggregates.map((a) => ({
        function: a.function,
        field: a.field,
        alias: a.alias,
      }));
    }

    this.update({ ...state, generatedQuery: plan, isDirty: false });
    this.emit('query-generated', { plan });
    return plan;
  }

  /**
   * Generates a TypeScript code string from the current UI state.
   *
   * @returns The generated TypeScript code
   *
   * @example
   * ```typescript
   * const code = builder.generateCode();
   * console.log(code);
   * ```
   */
  generateCode(): string {
    const plan = this.generateQuery();
    const lines: string[] = [];

    lines.push("import { createQueryBuilder } from '@pocket/query-builder';");
    lines.push('');
    lines.push(`const query = createQueryBuilder('${plan.collection}')`);

    if (plan.select) {
      const fields = plan.select.fields.map((f) => `'${f}'`).join(', ');
      lines.push(`  .select(${fields})`);
    }

    if (plan.where) {
      for (const condition of plan.where.conditions) {
        if ('field' in condition) {
          const fc = condition;
          const val = typeof fc.value === 'string' ? `'${fc.value}'` : JSON.stringify(fc.value);
          lines.push(`  .where('${fc.field}', '${fc.operator}', ${val})`);
        }
      }
    }

    if (plan.sort) {
      for (const s of plan.sort) {
        lines.push(`  .orderBy('${s.field}', '${s.direction}')`);
      }
    }

    if (plan.pagination?.skip !== undefined) {
      lines.push(`  .skip(${plan.pagination.skip})`);
    }
    if (plan.pagination?.limit !== undefined) {
      lines.push(`  .limit(${plan.pagination.limit})`);
    }

    if (plan.aggregates) {
      for (const agg of plan.aggregates) {
        const alias = agg.alias ? `, '${agg.alias}'` : '';
        lines.push(`  .${agg.function}('${agg.field}'${alias})`);
      }
    }

    lines.push('  .build();');

    const code = lines.join('\n');
    const state = this.stateSubject.getValue();
    this.update({ ...state, generatedCode: code });
    return code;
  }

  /**
   * Validates the current builder state and returns any errors.
   *
   * @returns An array of validation error messages (empty if valid)
   *
   * @example
   * ```typescript
   * const errors = builder.validate();
   * if (errors.length > 0) {
   *   console.warn('Validation errors:', errors);
   * }
   * ```
   */
  validate(): string[] {
    const state = this.stateSubject.getValue();
    const errors: string[] = [];

    if (!state.collection) {
      errors.push('A collection must be selected.');
    }

    const collectionDef = this.config.collections.find((c) => c.name === state.collection);
    if (state.collection && !collectionDef) {
      errors.push(`Unknown collection: "${state.collection}".`);
    }

    const availableFields = collectionDef?.fields.map((f) => f.name) ?? [];

    for (const filter of state.filters) {
      if (!filter.field) {
        errors.push(`Filter "${filter.id}" is missing a field.`);
      } else if (availableFields.length > 0 && !availableFields.includes(filter.field)) {
        errors.push(`Filter "${filter.id}" references unknown field "${filter.field}".`);
      }
    }

    for (const sort of state.sorts) {
      if (!sort.field) {
        errors.push(`Sort "${sort.id}" is missing a field.`);
      } else if (availableFields.length > 0 && !availableFields.includes(sort.field)) {
        errors.push(`Sort "${sort.id}" references unknown field "${sort.field}".`);
      }
    }

    for (const agg of state.aggregates) {
      if (!agg.field) {
        errors.push(`Aggregate "${agg.id}" is missing a field.`);
      }
    }

    if (state.limit !== undefined && state.limit < 0) {
      errors.push('Limit must be a non-negative number.');
    }

    if (state.offset !== undefined && state.offset < 0) {
      errors.push('Offset must be a non-negative number.');
    }

    this.update({ ...state, validationErrors: errors });
    return errors;
  }

  /**
   * Resets the builder to its initial state.
   *
   * @example
   * ```typescript
   * builder.reset();
   * ```
   */
  reset(): void {
    const collectionDef = this.config.collections.find(
      (c) => c.name === this.stateSubject.getValue().collection
    );
    const fields = collectionDef?.fields.map((f) => f.name) ?? [];

    this.stateSubject.next({
      collection: this.stateSubject.getValue().collection,
      selectedFields: fields,
      filters: [],
      sorts: [],
      aggregates: [],
      isDirty: false,
      validationErrors: [],
    });
    this.emit('reset');
  }

  /**
   * Returns a snapshot of the current UI state.
   *
   * @returns The current state
   *
   * @example
   * ```typescript
   * const state = builder.getState();
   * console.log(state.filters.length);
   * ```
   */
  getState(): QueryBuilderUIState {
    return this.stateSubject.getValue();
  }

  /**
   * Cleans up all observables and subscriptions.
   *
   * @example
   * ```typescript
   * builder.dispose();
   * ```
   */
  dispose(): void {
    this.stateSubject.complete();
    this.eventsSubject.complete();
  }

  // ── Internals ────────────────────────────────────────

  /** @internal */
  private update(state: QueryBuilderUIState): void {
    this.stateSubject.next(state);
  }

  /** @internal */
  private emit(type: QueryBuilderUIEvent['type'], data?: unknown): void {
    this.eventsSubject.next({ type, timestamp: Date.now(), data });
  }
}

// ── Factory ──────────────────────────────────────────────

/**
 * Creates a new {@link ReactQueryBuilder} instance.
 *
 * @param config - The builder configuration
 * @returns A new ReactQueryBuilder
 *
 * @example
 * ```typescript
 * import { createReactQueryBuilder } from '@pocket/query-builder';
 *
 * const builder = createReactQueryBuilder({
 *   collections: [
 *     { name: 'users', fields: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }] }
 *   ],
 *   defaultCollection: 'users',
 * });
 *
 * builder.addFilter('age');
 * builder.updateFilter('f-1', { operator: 'gte', value: 18 });
 * const plan = builder.generateQuery();
 * ```
 */
export function createReactQueryBuilder(config: QueryBuilderUIConfig): ReactQueryBuilder {
  return new ReactQueryBuilder(config);
}

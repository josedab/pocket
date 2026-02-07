/**
 * VisualQueryModel - Data model for a visual query builder UI.
 *
 * Provides a mutable model for constructing queries through a visual
 * interface, with methods to add, remove, and update filters, sorts,
 * aggregates, and pagination settings.
 *
 * @module visual-query-model
 *
 * @example
 * ```typescript
 * import { createVisualQueryModel } from '@pocket/query-builder';
 *
 * const model = createVisualQueryModel('users');
 * model.addFilter('status', 'eq', 'active');
 * model.addSort('name', 'asc');
 * model.setLimit(10);
 *
 * const plan = model.toQueryPlan();
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryCodeGenerator}
 */

import type {
  AggregateClause,
  AggregateFunction,
  FilterOperator,
  QueryPlan,
  SortClause,
  SortDirection,
} from './types.js';

/**
 * A visual filter entry used by the visual query model.
 */
export interface VisualFilter {
  /** The document field to filter on */
  field: string;
  /** The comparison operator */
  operator: string;
  /** The value to compare against */
  value: unknown;
}

/**
 * Mutable data model for constructing queries visually.
 *
 * The `VisualQueryModel` stores query parameters in a flat, editable
 * structure suitable for UI bindings. Call {@link toQueryPlan} to
 * convert the model to a {@link QueryPlan} for execution.
 *
 * @example
 * ```typescript
 * const model = new VisualQueryModel('products');
 * model.addFilter('price', 'gte', 10);
 * model.addSort('price', 'desc');
 * model.setLimit(20);
 *
 * const plan = model.toQueryPlan();
 * ```
 *
 * @see {@link createVisualQueryModel}
 * @see {@link QueryPlan}
 */
export class VisualQueryModel {
  /** @internal */
  private _collection: string;
  /** @internal */
  private _filters: VisualFilter[] = [];
  /** @internal */
  private _sorts: SortClause[] = [];
  /** @internal */
  private _aggregates: AggregateClause[] = [];
  /** @internal */
  private _limit?: number;
  /** @internal */
  private _offset?: number;

  /**
   * Creates a new VisualQueryModel for the given collection.
   *
   * @param collection - The target collection name
   */
  constructor(collection: string) {
    this._collection = collection;
  }

  /**
   * Adds a filter condition to the model.
   *
   * @param field - The field to filter on
   * @param operator - The comparison operator
   * @param value - The value to compare against
   */
  addFilter(field: string, operator: string, value: unknown): void {
    this._filters.push({ field, operator, value });
  }

  /**
   * Removes a filter by index.
   *
   * @param index - The index of the filter to remove
   */
  removeFilter(index: number): void {
    this._filters.splice(index, 1);
  }

  /**
   * Updates a filter at the given index with partial updates.
   *
   * @param index - The index of the filter to update
   * @param updates - Partial filter fields to update
   */
  updateFilter(index: number, updates: Partial<VisualFilter>): void {
    if (index >= 0 && index < this._filters.length) {
      this._filters[index] = { ...this._filters[index]!, ...updates };
    }
  }

  /**
   * Adds a sort clause.
   *
   * @param field - The field to sort by
   * @param direction - The sort direction
   */
  addSort(field: string, direction: SortDirection): void {
    this._sorts.push({ field, direction });
  }

  /**
   * Removes a sort clause by index.
   *
   * @param index - The index of the sort to remove
   */
  removeSort(index: number): void {
    this._sorts.splice(index, 1);
  }

  /**
   * Sets the maximum number of results.
   *
   * @param limit - The result limit
   */
  setLimit(limit: number): void {
    this._limit = limit;
  }

  /**
   * Sets the result offset.
   *
   * @param offset - The number of results to skip
   */
  setOffset(offset: number): void {
    this._offset = offset;
  }

  /**
   * Adds an aggregation function.
   *
   * @param func - The aggregate function name
   * @param field - The field to aggregate
   */
  addAggregate(func: string, field: string): void {
    this._aggregates.push({ function: func as AggregateFunction, field });
  }

  /**
   * Removes an aggregation by index.
   *
   * @param index - The index of the aggregate to remove
   */
  removeAggregate(index: number): void {
    this._aggregates.splice(index, 1);
  }

  /**
   * Returns the current filters.
   */
  getFilters(): VisualFilter[] {
    return [...this._filters];
  }

  /**
   * Returns the current sort clauses.
   */
  getSorts(): SortClause[] {
    return [...this._sorts];
  }

  /**
   * Returns the current aggregates.
   */
  getAggregates(): AggregateClause[] {
    return [...this._aggregates];
  }

  /**
   * Returns the current limit, or undefined if not set.
   */
  getLimit(): number | undefined {
    return this._limit;
  }

  /**
   * Converts the visual model to a {@link QueryPlan}.
   *
   * @returns A query plan representing the current model state
   */
  toQueryPlan(): QueryPlan {
    const plan: QueryPlan = {
      collection: this._collection,
    };

    if (this._filters.length > 0) {
      plan.where = {
        operator: 'and',
        conditions: this._filters.map((f) => ({
          field: f.field,
          operator: f.operator as FilterOperator,
          value: f.value,
        })),
      };
    }

    if (this._sorts.length > 0) {
      plan.sort = [...this._sorts];
    }

    if (this._limit !== undefined || this._offset !== undefined) {
      plan.pagination = {};
      if (this._limit !== undefined) plan.pagination.limit = this._limit;
      if (this._offset !== undefined) plan.pagination.skip = this._offset;
    }

    if (this._aggregates.length > 0) {
      plan.aggregates = [...this._aggregates];
    }

    return plan;
  }

  /**
   * Resets all conditions, sorts, aggregates, and pagination.
   */
  clear(): void {
    this._filters = [];
    this._sorts = [];
    this._aggregates = [];
    this._limit = undefined;
    this._offset = undefined;
  }

  /**
   * Creates a deep copy of this model.
   *
   * @returns A new independent VisualQueryModel
   */
  clone(): VisualQueryModel {
    const cloned = new VisualQueryModel(this._collection);
    cloned._filters = this._filters.map((f) => ({ ...f }));
    cloned._sorts = this._sorts.map((s) => ({ ...s }));
    cloned._aggregates = this._aggregates.map((a) => ({ ...a }));
    cloned._limit = this._limit;
    cloned._offset = this._offset;
    return cloned;
  }
}

/**
 * Creates a new {@link VisualQueryModel} instance.
 *
 * @param collection - The target collection name
 * @returns A new VisualQueryModel
 *
 * @example
 * ```typescript
 * import { createVisualQueryModel } from '@pocket/query-builder';
 *
 * const model = createVisualQueryModel('users');
 * model.addFilter('age', 'gte', 18);
 * const plan = model.toQueryPlan();
 * ```
 */
export function createVisualQueryModel(collection: string): VisualQueryModel {
  return new VisualQueryModel(collection);
}

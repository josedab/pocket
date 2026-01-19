import type { Observable } from 'rxjs';
import type { LiveQuery, LiveQueryOptions } from '../observable/live-query.js';
import type { Document } from '../types/document.js';
import type { QueryFilter, QuerySpec, SortDirection, SortSpec } from '../types/query.js';

/**
 * Type-safe query builder using fluent interface
 */
export class QueryBuilder<T extends Document> {
  private spec: QuerySpec<T> = {};
  private readonly executor: (spec: QuerySpec<T>) => Promise<T[]>;
  private readonly liveQueryFactory: () => (
    spec: QuerySpec<T>,
    options?: LiveQueryOptions
  ) => LiveQuery<T>;

  constructor(
    executor: (spec: QuerySpec<T>) => Promise<T[]>,
    liveQueryFactory: () => (spec: QuerySpec<T>, options?: LiveQueryOptions) => LiveQuery<T>
  ) {
    this.executor = executor;
    this.liveQueryFactory = liveQueryFactory;
  }

  /**
   * Add a field condition
   */
  where<K extends keyof T & string>(field: K): FieldQuery<T, T[K]> {
    return new FieldQuery<T, T[K]>(this, field);
  }

  /**
   * Add a raw filter
   */
  filter(filter: QueryFilter<T>): this {
    this.spec.filter = {
      ...this.spec.filter,
      ...filter,
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Add logical AND conditions
   */
  and(...filters: QueryFilter<T>[]): this {
    const existing = this.spec.filter?.$and ?? [];
    this.spec.filter = {
      ...this.spec.filter,
      $and: [...existing, ...filters],
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Add logical OR conditions
   */
  or(...filters: QueryFilter<T>[]): this {
    const existing = this.spec.filter?.$or ?? [];
    this.spec.filter = {
      ...this.spec.filter,
      $or: [...existing, ...filters],
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Add a sort specification
   */
  sort(field: keyof T & string, direction: SortDirection = 'asc'): this {
    const sorts = this.spec.sort ?? [];
    this.spec.sort = [...sorts, { field, direction }];
    return this;
  }

  /**
   * Sort by multiple fields
   */
  sortBy(sorts: SortSpec<T>[]): this {
    this.spec.sort = [...(this.spec.sort ?? []), ...sorts];
    return this;
  }

  /**
   * Skip documents
   */
  skip(count: number): this {
    this.spec.skip = count;
    return this;
  }

  /**
   * Limit number of documents
   */
  limit(count: number): this {
    this.spec.limit = count;
    return this;
  }

  /**
   * Set projection (fields to include/exclude)
   */
  select(projection: Partial<Record<keyof T, 0 | 1>>): this {
    this.spec.projection = projection;
    return this;
  }

  /**
   * Include only specified fields
   */
  include(...fields: (keyof T & string)[]): this {
    const projection: Partial<Record<keyof T, 0 | 1>> = {};
    for (const field of fields) {
      projection[field] = 1;
    }
    this.spec.projection = projection;
    return this;
  }

  /**
   * Exclude specified fields
   */
  exclude(...fields: (keyof T & string)[]): this {
    const projection: Partial<Record<keyof T, 0 | 1>> = {};
    for (const field of fields) {
      projection[field] = 0;
    }
    this.spec.projection = projection;
    return this;
  }

  /**
   * Get the query specification
   */
  getSpec(): QuerySpec<T> {
    return { ...this.spec };
  }

  /**
   * Execute the query and return results
   */
  async exec(): Promise<T[]> {
    return this.executor(this.spec);
  }

  /**
   * Execute and return first result
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).exec();
    return results[0] ?? null;
  }

  /**
   * Create a live query observable
   */
  live(options?: LiveQueryOptions): Observable<T[]> {
    const factory = this.liveQueryFactory();
    const liveQuery = factory(this.spec, options);
    return liveQuery.observable();
  }

  /**
   * Internal: Add a field condition to the filter
   */
  _addCondition(field: string, condition: unknown): this {
    this.spec.filter = {
      ...this.spec.filter,
      [field]: condition,
    } as QueryFilter<T>;
    return this;
  }
}

/**
 * Field-specific query builder for type-safe conditions
 */
export class FieldQuery<T extends Document, V> {
  private readonly builder: QueryBuilder<T>;
  private readonly field: keyof T & string;

  constructor(builder: QueryBuilder<T>, field: keyof T & string) {
    this.builder = builder;
    this.field = field;
  }

  /**
   * Equal to
   */
  equals(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, value);
  }

  /**
   * Equal to (alias)
   */
  eq(value: V): QueryBuilder<T> {
    return this.equals(value);
  }

  /**
   * Not equal to
   */
  notEquals(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $ne: value });
  }

  /**
   * Not equal to (alias)
   */
  ne(value: V): QueryBuilder<T> {
    return this.notEquals(value);
  }

  /**
   * Greater than
   */
  greaterThan(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gt: value });
  }

  /**
   * Greater than (alias)
   */
  gt(value: V): QueryBuilder<T> {
    return this.greaterThan(value);
  }

  /**
   * Greater than or equal
   */
  greaterThanOrEqual(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gte: value });
  }

  /**
   * Greater than or equal (alias)
   */
  gte(value: V): QueryBuilder<T> {
    return this.greaterThanOrEqual(value);
  }

  /**
   * Less than
   */
  lessThan(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $lt: value });
  }

  /**
   * Less than (alias)
   */
  lt(value: V): QueryBuilder<T> {
    return this.lessThan(value);
  }

  /**
   * Less than or equal
   */
  lessThanOrEqual(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $lte: value });
  }

  /**
   * Less than or equal (alias)
   */
  lte(value: V): QueryBuilder<T> {
    return this.lessThanOrEqual(value);
  }

  /**
   * In array
   */
  in(values: V[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $in: values });
  }

  /**
   * Not in array
   */
  notIn(values: V[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $nin: values });
  }

  /**
   * Between two values (inclusive)
   */
  between(min: V, max: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gte: min, $lte: max });
  }

  /**
   * Exists (is not null/undefined)
   */
  exists(): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $ne: null });
  }

  /**
   * Does not exist (is null/undefined)
   */
  notExists(): QueryBuilder<T> {
    return this.builder._addCondition(this.field, null);
  }

  // String-specific methods (type-safe when V extends string)

  /**
   * Matches regex pattern
   */
  matches(pattern: RegExp | string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $regex: pattern });
  }

  /**
   * Starts with
   */
  startsWith(prefix: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $startsWith: prefix });
  }

  /**
   * Ends with
   */
  endsWith(suffix: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $endsWith: suffix });
  }

  /**
   * Contains substring
   */
  contains(substring: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $contains: substring });
  }

  // Array-specific methods (type-safe when V extends array)

  /**
   * Array contains all values
   */
  all(values: unknown[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $all: values });
  }

  /**
   * Array has size
   */
  size(length: number): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $size: length });
  }

  /**
   * Array element matches condition
   */
  elemMatch(condition: Record<string, unknown>): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $elemMatch: condition });
  }
}

/**
 * Create a new query builder
 */
export function createQueryBuilder<T extends Document>(
  executor: (spec: QuerySpec<T>) => Promise<T[]>,
  liveQueryFactory: () => (spec: QuerySpec<T>, options?: LiveQueryOptions) => LiveQuery<T>
): QueryBuilder<T> {
  return new QueryBuilder(executor, liveQueryFactory);
}

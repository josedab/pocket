/**
 * QueryBuilder - Fluent API for constructing type-safe database queries.
 *
 * Provides a chainable interface for building complex queries against
 * Pocket database collections with compile-time type safety.
 *
 * @module query-builder
 *
 * @example Basic query
 * ```typescript
 * import { createQueryBuilder } from '@pocket/query-builder';
 *
 * const query = createQueryBuilder('users')
 *   .select('name', 'email')
 *   .where('status', 'eq', 'active')
 *   .orderBy('name', 'asc')
 *   .limit(10)
 *   .build();
 * ```
 *
 * @example Complex query with logical groups
 * ```typescript
 * const query = createQueryBuilder('products')
 *   .select('name', 'price', 'category')
 *   .where('price', 'gte', 10)
 *   .or()
 *     .where('category', 'eq', 'featured')
 *     .where('rating', 'gte', 4.5)
 *   .endGroup()
 *   .orderBy('price', 'desc')
 *   .limit(20)
 *   .build();
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryOptimizer}
 * @see {@link QuerySerializer}
 */

import type {
  AggregateClause,
  FilterCondition,
  FilterOperator,
  LogicalGroup,
  LogicalOperator,
  QueryExplanation,
  QueryPlan,
  SelectClause,
  SortClause,
  SortDirection,
} from './types.js';
import { QueryOptimizer } from './query-optimizer.js';
import { QuerySerializer } from './query-serializer.js';

/**
 * Fluent query builder for Pocket databases.
 *
 * The `QueryBuilder` class provides a chainable API for constructing
 * database queries. Each method returns `this` to enable method chaining.
 * Call {@link build} to produce the final {@link QueryPlan}.
 *
 * @example
 * ```typescript
 * const builder = new QueryBuilder();
 * const plan = builder
 *   .collection('users')
 *   .select('name', 'email')
 *   .where('age', 'gte', 18)
 *   .orderBy('name')
 *   .limit(50)
 *   .build();
 * ```
 *
 * @see {@link createQueryBuilder} for a convenient factory function
 * @see {@link QueryPlan} for the output format
 */
export class QueryBuilder {
  /** @internal */
  private _collection = '';
  /** @internal */
  private _select?: SelectClause;
  /** @internal */
  private _rootGroup: LogicalGroup = { operator: 'and', conditions: [] };
  /** @internal */
  private _groupStack: LogicalGroup[] = [];
  /** @internal */
  private _sort: SortClause[] = [];
  /** @internal */
  private _limit?: number;
  /** @internal */
  private _skip?: number;
  /** @internal */
  private _cursor?: string;
  /** @internal */
  private _aggregates: AggregateClause[] = [];

  /**
   * Creates a new QueryBuilder instance.
   *
   * @param collectionName - Optional collection name to query
   *
   * @example
   * ```typescript
   * const builder = new QueryBuilder('users');
   * ```
   */
  constructor(collectionName?: string) {
    if (collectionName) {
      this._collection = collectionName;
    }
    this._groupStack = [this._rootGroup];
  }

  /**
   * Sets the target collection for the query.
   *
   * @param name - The collection name
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.collection('users');
   * ```
   */
  collection(name: string): this {
    this._collection = name;
    return this;
  }

  /**
   * Selects specific fields to include in results.
   *
   * @param fields - The field names to select
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.select('name', 'email', 'age');
   * ```
   */
  select(...fields: string[]): this {
    this._select = { fields };
    return this;
  }

  /**
   * Adds a filter condition to the current logical group.
   *
   * @param field - The field to filter on
   * @param operator - The comparison operator
   * @param value - The value to compare against
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.where('age', 'gte', 18);
   * builder.where('status', 'in', ['active', 'pending']);
   * builder.where('name', 'contains', 'john');
   * ```
   */
  where(field: string, operator: FilterOperator, value: unknown): this {
    const condition: FilterCondition = { field, operator, value };
    const currentGroup = this._groupStack[this._groupStack.length - 1]!;
    currentGroup.conditions.push(condition);
    return this;
  }

  /**
   * Starts an AND logical group.
   *
   * All conditions added until {@link endGroup} is called will be
   * combined with AND logic.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder
   *   .and()
   *     .where('status', 'eq', 'active')
   *     .where('age', 'gte', 18)
   *   .endGroup();
   * ```
   */
  and(): this {
    return this._startGroup('and');
  }

  /**
   * Starts an OR logical group.
   *
   * At least one condition added until {@link endGroup} is called
   * must match.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder
   *   .or()
   *     .where('role', 'eq', 'admin')
   *     .where('role', 'eq', 'moderator')
   *   .endGroup();
   * ```
   */
  or(): this {
    return this._startGroup('or');
  }

  /**
   * Ends the current logical group, returning to the parent group.
   *
   * @returns This builder for chaining
   * @throws Error if there is no group to end
   *
   * @example
   * ```typescript
   * builder
   *   .or()
   *     .where('status', 'eq', 'active')
   *     .where('status', 'eq', 'pending')
   *   .endGroup();
   * ```
   */
  endGroup(): this {
    if (this._groupStack.length <= 1) {
      throw new Error('No group to end. Call and() or or() first.');
    }
    this._groupStack.pop();
    return this;
  }

  /**
   * Adds a sort clause for ordering results.
   *
   * Multiple sort clauses can be added for multi-field sorting.
   *
   * @param field - The field to sort by
   * @param direction - The sort direction (defaults to `'asc'`)
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder
   *   .orderBy('lastName', 'asc')
   *   .orderBy('firstName', 'asc');
   * ```
   */
  orderBy(field: string, direction: SortDirection = 'asc'): this {
    this._sort.push({ field, direction });
    return this;
  }

  /**
   * Sets the maximum number of results to return.
   *
   * @param n - The maximum number of results
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.limit(10);
   * ```
   */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /**
   * Sets the number of results to skip (offset).
   *
   * @param n - The number of results to skip
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.skip(20).limit(10); // Page 3
   * ```
   */
  skip(n: number): this {
    this._skip = n;
    return this;
  }

  /**
   * Adds a count aggregate.
   *
   * @param field - The field to count (defaults to `'*'`)
   * @param alias - Optional alias for the result
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.count('id', 'totalUsers');
   * ```
   */
  count(field = '*', alias?: string): this {
    this._aggregates.push({ function: 'count', field, alias });
    return this;
  }

  /**
   * Adds a sum aggregate.
   *
   * @param field - The field to sum
   * @param alias - Optional alias for the result
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.sum('price', 'totalRevenue');
   * ```
   */
  sum(field: string, alias?: string): this {
    this._aggregates.push({ function: 'sum', field, alias });
    return this;
  }

  /**
   * Adds an average aggregate.
   *
   * @param field - The field to average
   * @param alias - Optional alias for the result
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.avg('rating', 'averageRating');
   * ```
   */
  avg(field: string, alias?: string): this {
    this._aggregates.push({ function: 'avg', field, alias });
    return this;
  }

  /**
   * Adds a min aggregate.
   *
   * @param field - The field to find the minimum of
   * @param alias - Optional alias for the result
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.min('price', 'lowestPrice');
   * ```
   */
  min(field: string, alias?: string): this {
    this._aggregates.push({ function: 'min', field, alias });
    return this;
  }

  /**
   * Adds a max aggregate.
   *
   * @param field - The field to find the maximum of
   * @param alias - Optional alias for the result
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.max('price', 'highestPrice');
   * ```
   */
  max(field: string, alias?: string): this {
    this._aggregates.push({ function: 'max', field, alias });
    return this;
  }

  /**
   * Builds the query plan from the current builder state.
   *
   * @returns The constructed query plan
   * @throws Error if no collection has been set
   *
   * @example
   * ```typescript
   * const plan = builder
   *   .collection('users')
   *   .where('status', 'eq', 'active')
   *   .build();
   * ```
   *
   * @see {@link QueryPlan}
   */
  build(): QueryPlan {
    if (!this._collection) {
      throw new Error('Collection name is required. Call collection() first.');
    }

    const plan: QueryPlan = {
      collection: this._collection,
    };

    if (this._select) {
      plan.select = { ...this._select };
    }

    if (this._rootGroup.conditions.length > 0) {
      plan.where = this._cloneGroup(this._rootGroup);
    }

    if (this._sort.length > 0) {
      plan.sort = [...this._sort];
    }

    if (this._limit !== undefined || this._skip !== undefined || this._cursor !== undefined) {
      plan.pagination = {};
      if (this._limit !== undefined) plan.pagination.limit = this._limit;
      if (this._skip !== undefined) plan.pagination.skip = this._skip;
      if (this._cursor !== undefined) plan.pagination.cursor = this._cursor;
    }

    if (this._aggregates.length > 0) {
      plan.aggregates = [...this._aggregates];
    }

    return plan;
  }

  /**
   * Explains the query plan with optimization suggestions.
   *
   * @returns A query explanation with complexity and index suggestions
   *
   * @example
   * ```typescript
   * const explanation = builder
   *   .collection('users')
   *   .where('email', 'eq', 'test@example.com')
   *   .explain();
   *
   * console.log(explanation.description);
   * console.log('Complexity:', explanation.estimatedComplexity);
   * console.log('Suggested indexes:', explanation.suggestedIndexes);
   * ```
   *
   * @see {@link QueryExplanation}
   */
  explain(): QueryExplanation {
    const plan = this.build();
    const optimizer = new QueryOptimizer();
    const serializer = new QuerySerializer();

    return {
      plan,
      description: serializer.toReadable(plan),
      estimatedComplexity: optimizer.estimateComplexity(plan),
      suggestedIndexes: optimizer.suggestIndexes(plan).map(
        (s) => s.fields.join(', ')
      ),
    };
  }

  /**
   * Generates TypeScript code that reproduces this query.
   *
   * @returns A TypeScript code string
   *
   * @example
   * ```typescript
   * const code = builder
   *   .collection('users')
   *   .where('status', 'eq', 'active')
   *   .toCode();
   *
   * console.log(code);
   * // createQueryBuilder('users')
   * //   .where('status', 'eq', 'active')
   * //   .build()
   * ```
   */
  toCode(): string {
    const plan = this.build();
    const serializer = new QuerySerializer();
    return serializer.toCode(plan);
  }

  /**
   * Creates a deep copy of this query builder.
   *
   * @returns A new QueryBuilder with the same state
   *
   * @example
   * ```typescript
   * const base = createQueryBuilder('users')
   *   .where('status', 'eq', 'active');
   *
   * const withSort = base.clone().orderBy('name');
   * const withLimit = base.clone().limit(10);
   * ```
   */
  clone(): QueryBuilder {
    const cloned = new QueryBuilder(this._collection);
    if (this._select) {
      cloned._select = { fields: [...this._select.fields] };
    }
    cloned._rootGroup = this._cloneGroup(this._rootGroup);
    cloned._groupStack = [cloned._rootGroup];
    cloned._sort = this._sort.map((s) => ({ ...s }));
    cloned._limit = this._limit;
    cloned._skip = this._skip;
    cloned._cursor = this._cursor;
    cloned._aggregates = this._aggregates.map((a) => ({ ...a }));
    return cloned;
  }

  /**
   * Resets all builder state, clearing the query.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.reset().collection('products');
   * ```
   */
  reset(): this {
    this._collection = '';
    this._select = undefined;
    this._rootGroup = { operator: 'and', conditions: [] };
    this._groupStack = [this._rootGroup];
    this._sort = [];
    this._limit = undefined;
    this._skip = undefined;
    this._cursor = undefined;
    this._aggregates = [];
    return this;
  }

  /**
   * Creates a QueryBuilder from an existing query plan.
   *
   * @param plan - The query plan to reconstruct
   * @returns A new QueryBuilder matching the plan
   *
   * @example
   * ```typescript
   * const plan: QueryPlan = { collection: 'users', ... };
   * const builder = QueryBuilder.from(plan);
   * const modified = builder.limit(20).build();
   * ```
   *
   * @see {@link QueryPlan}
   */
  static from(plan: QueryPlan): QueryBuilder {
    const builder = new QueryBuilder(plan.collection);

    if (plan.select) {
      builder.select(...plan.select.fields);
    }

    if (plan.where) {
      builder._rootGroup = JSON.parse(JSON.stringify(plan.where));
      builder._groupStack = [builder._rootGroup];
    }

    if (plan.sort) {
      builder._sort = plan.sort.map((s) => ({ ...s }));
    }

    if (plan.pagination) {
      if (plan.pagination.limit !== undefined) builder._limit = plan.pagination.limit;
      if (plan.pagination.skip !== undefined) builder._skip = plan.pagination.skip;
      if (plan.pagination.cursor !== undefined) builder._cursor = plan.pagination.cursor;
    }

    if (plan.aggregates) {
      builder._aggregates = plan.aggregates.map((a) => ({ ...a }));
    }

    return builder;
  }

  /** @internal */
  private _startGroup(operator: LogicalOperator): this {
    const group: LogicalGroup = { operator, conditions: [] };
    const currentGroup = this._groupStack[this._groupStack.length - 1]!;
    currentGroup.conditions.push(group);
    this._groupStack.push(group);
    return this;
  }

  /** @internal */
  private _cloneGroup(group: LogicalGroup): LogicalGroup {
    return {
      operator: group.operator,
      conditions: group.conditions.map((c) => {
        if ('operator' in c && 'conditions' in c) {
          return this._cloneGroup(c);
        }
        return { ...(c) };
      }),
    };
  }
}

/**
 * Creates a new {@link QueryBuilder} instance.
 *
 * This is the recommended way to start building queries.
 *
 * @param collection - Optional collection name to query
 * @returns A new QueryBuilder instance
 *
 * @example
 * ```typescript
 * import { createQueryBuilder } from '@pocket/query-builder';
 *
 * const plan = createQueryBuilder('users')
 *   .select('name', 'email')
 *   .where('status', 'eq', 'active')
 *   .orderBy('name')
 *   .limit(10)
 *   .build();
 * ```
 *
 * @see {@link QueryBuilder}
 */
export function createQueryBuilder(collection?: string): QueryBuilder {
  return new QueryBuilder(collection);
}

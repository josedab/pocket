/**
 * Types for the Pocket Query Builder.
 *
 * This module defines all types used by the query builder to construct,
 * optimize, and serialize database queries with full type safety.
 *
 * @module types
 */

/**
 * Filter operators for comparing field values.
 *
 * - `'eq'`: Equal to
 * - `'neq'`: Not equal to
 * - `'gt'`: Greater than
 * - `'gte'`: Greater than or equal to
 * - `'lt'`: Less than
 * - `'lte'`: Less than or equal to
 * - `'in'`: Value is in array
 * - `'nin'`: Value is not in array
 * - `'contains'`: String contains value
 * - `'startsWith'`: String starts with value
 * - `'endsWith'`: String ends with value
 * - `'exists'`: Field exists
 * - `'regex'`: Matches regular expression
 * - `'between'`: Value is between two bounds
 *
 * @see {@link FilterCondition}
 */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists'
  | 'regex'
  | 'between';

/**
 * Logical operators for combining filter conditions.
 *
 * - `'and'`: All conditions must match
 * - `'or'`: At least one condition must match
 * - `'not'`: Negates the group
 *
 * @see {@link LogicalGroup}
 */
export type LogicalOperator = 'and' | 'or' | 'not';

/**
 * Sort direction for ordering results.
 *
 * - `'asc'`: Ascending order (A-Z, 0-9)
 * - `'desc'`: Descending order (Z-A, 9-0)
 *
 * @see {@link SortClause}
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Aggregate functions for computing summary values.
 *
 * - `'count'`: Count of matching documents
 * - `'sum'`: Sum of field values
 * - `'avg'`: Average of field values
 * - `'min'`: Minimum field value
 * - `'max'`: Maximum field value
 *
 * @see {@link AggregateClause}
 */
export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * A single filter condition comparing a field to a value.
 *
 * @example
 * ```typescript
 * const condition: FilterCondition = {
 *   field: 'age',
 *   operator: 'gte',
 *   value: 18
 * };
 * ```
 *
 * @see {@link FilterOperator}
 */
export interface FilterCondition {
  /** The document field to compare */
  field: string;
  /** The comparison operator */
  operator: FilterOperator;
  /** The value to compare against */
  value: unknown;
}

/**
 * A group of filter conditions combined with a logical operator.
 *
 * Logical groups can be nested to create complex filter expressions.
 *
 * @example
 * ```typescript
 * const group: LogicalGroup = {
 *   operator: 'and',
 *   conditions: [
 *     { field: 'status', operator: 'eq', value: 'active' },
 *     { field: 'age', operator: 'gte', value: 18 }
 *   ]
 * };
 * ```
 *
 * @see {@link LogicalOperator}
 * @see {@link FilterCondition}
 */
export interface LogicalGroup {
  /** The logical operator combining conditions */
  operator: LogicalOperator;
  /** The conditions or nested groups */
  conditions: (FilterCondition | LogicalGroup)[];
}

/**
 * A sort clause specifying field and direction for ordering results.
 *
 * @see {@link SortDirection}
 */
export interface SortClause {
  /** The field to sort by */
  field: string;
  /** The sort direction */
  direction: SortDirection;
}

/**
 * An aggregate clause specifying a summary computation.
 *
 * @see {@link AggregateFunction}
 */
export interface AggregateClause {
  /** The aggregate function to apply */
  function: AggregateFunction;
  /** The field to aggregate */
  field: string;
  /** Optional alias for the result */
  alias?: string;
}

/**
 * A select clause specifying which fields to include in results.
 */
export interface SelectClause {
  /** The fields to include */
  fields: string[];
}

/**
 * Pagination parameters for limiting and offsetting results.
 */
export interface PaginationClause {
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip */
  skip?: number;
  /** Cursor for cursor-based pagination */
  cursor?: string;
}

/**
 * A complete query plan describing a database query.
 *
 * The query plan is the intermediate representation produced by
 * {@link QueryBuilder.build} and consumed by the query optimizer,
 * serializer, and execution engine.
 *
 * @example
 * ```typescript
 * const plan: QueryPlan = {
 *   collection: 'users',
 *   select: { fields: ['name', 'email'] },
 *   where: {
 *     operator: 'and',
 *     conditions: [
 *       { field: 'status', operator: 'eq', value: 'active' }
 *     ]
 *   },
 *   sort: [{ field: 'name', direction: 'asc' }],
 *   pagination: { limit: 10 }
 * };
 * ```
 *
 * @see {@link QueryBuilder}
 * @see {@link QueryOptimizer}
 * @see {@link QuerySerializer}
 */
export interface QueryPlan {
  /** The target collection name */
  collection: string;
  /** Fields to select */
  select?: SelectClause;
  /** Filter conditions */
  where?: LogicalGroup;
  /** Sort ordering */
  sort?: SortClause[];
  /** Pagination parameters */
  pagination?: PaginationClause;
  /** Aggregate computations */
  aggregates?: AggregateClause[];
}

/**
 * An explanation of a query plan with optimization suggestions.
 *
 * Produced by {@link QueryBuilder.explain} to help developers
 * understand and optimize their queries.
 *
 * @see {@link QueryBuilder.explain}
 * @see {@link QueryOptimizer}
 */
export interface QueryExplanation {
  /** The query plan being explained */
  plan: QueryPlan;
  /** Human-readable description of the query */
  description: string;
  /** Estimated computational complexity */
  estimatedComplexity: 'low' | 'medium' | 'high';
  /** Suggested indexes to improve performance */
  suggestedIndexes: string[];
}

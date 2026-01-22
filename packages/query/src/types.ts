/**
 * Types for Query Subscriptions Language
 */

/**
 * Query operator types
 */
export type QueryOperator =
  | 'eq' // equals
  | 'neq' // not equals
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'in' // in array
  | 'nin' // not in array
  | 'contains' // string contains
  | 'startsWith' // string starts with
  | 'endsWith' // string ends with
  | 'regex' // regex match
  | 'exists' // field exists
  | 'type' // type check
  | 'between' // between range
  | 'near' // geospatial near
  | 'within'; // geospatial within

/**
 * Logical operator types
 */
export type LogicalOperator = 'and' | 'or' | 'not';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Field condition
 */
export interface FieldCondition {
  /** Field path */
  field: string;
  /** Operator */
  operator: QueryOperator;
  /** Comparison value */
  value: unknown;
}

/**
 * Logical condition (compound)
 */
export interface LogicalCondition {
  /** Logical operator */
  operator: LogicalOperator;
  /** Child conditions */
  conditions: Condition[];
}

/**
 * Query condition (either field or logical)
 */
export type Condition = FieldCondition | LogicalCondition;

/**
 * Sort specification
 */
export interface SortSpec {
  /** Field to sort by */
  field: string;
  /** Sort direction */
  direction: SortDirection;
}

/**
 * Pagination specification
 */
export interface PaginationSpec {
  /** Number of items to skip */
  offset?: number;
  /** Maximum items to return */
  limit?: number;
  /** Cursor for cursor-based pagination */
  cursor?: string;
}

/**
 * Projection specification
 */
export interface ProjectionSpec {
  /** Fields to include (empty = all) */
  include?: string[];
  /** Fields to exclude */
  exclude?: string[];
}

/**
 * Aggregation types
 */
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'group' | 'distinct';

/**
 * Aggregation specification
 */
export interface AggregationSpec {
  /** Aggregation type */
  type: AggregationType;
  /** Field to aggregate (if applicable) */
  field?: string;
  /** Group by fields (for group aggregation) */
  groupBy?: string[];
  /** Alias for result */
  alias?: string;
}

/**
 * Computed field specification
 */
export interface ComputedFieldSpec {
  /** Field name for the computed result */
  name: string;
  /** Expression to compute */
  expression: string;
  /** Dependencies (fields used in expression) */
  dependencies: string[];
}

/**
 * Full query definition
 */
export interface QueryDefinition {
  /** Collection to query */
  collection: string;
  /** Query conditions */
  where?: Condition;
  /** Sort specifications */
  orderBy?: SortSpec[];
  /** Pagination */
  pagination?: PaginationSpec;
  /** Projection */
  select?: ProjectionSpec;
  /** Aggregations */
  aggregate?: AggregationSpec[];
  /** Computed fields */
  computed?: ComputedFieldSpec[];
  /** Join other collections */
  join?: JoinSpec[];
  /** Enable live updates */
  live?: boolean;
}

/**
 * Join specification
 */
export interface JoinSpec {
  /** Collection to join */
  collection: string;
  /** Local field for join */
  localField: string;
  /** Foreign field for join */
  foreignField: string;
  /** Result field name */
  as: string;
  /** Optional where condition for joined docs */
  where?: Condition;
}

/**
 * Query result
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Result documents */
  data: T[];
  /** Total count (if available) */
  total?: number;
  /** Pagination cursor */
  cursor?: string;
  /** Has more results */
  hasMore?: boolean;
  /** Aggregation results */
  aggregations?: Record<string, unknown>;
  /** Query execution time (ms) */
  executionTime?: number;
}

/**
 * Query execution options
 */
export interface QueryOptions {
  /** Skip cache */
  skipCache?: boolean;
  /** Cache TTL in ms */
  cacheTTL?: number;
  /** Debounce live updates (ms) */
  debounce?: number;
  /** Include soft-deleted documents */
  includeSoftDeleted?: boolean;
}

/**
 * Query subscription event
 */
export interface QuerySubscriptionEvent<T = Record<string, unknown>> {
  /** Event type */
  type: 'initial' | 'added' | 'modified' | 'removed' | 'reset';
  /** Affected documents */
  documents: T[];
  /** Changed document (for single doc events) */
  document?: T;
  /** Full result set */
  result: QueryResult<T>;
  /** Event timestamp */
  timestamp: number;
}

/**
 * Query cache entry
 */
export interface QueryCacheEntry<T = Record<string, unknown>> {
  /** Query hash */
  hash: string;
  /** Query definition */
  query: QueryDefinition;
  /** Cached result */
  result: QueryResult<T>;
  /** Cache timestamp */
  timestamp: number;
  /** Expiry timestamp */
  expiresAt: number;
}

/**
 * Query builder configuration
 */
export interface QueryBuilderConfig {
  /** Default page size */
  defaultPageSize?: number;
  /** Maximum page size */
  maxPageSize?: number;
  /** Default cache TTL (ms) */
  defaultCacheTTL?: number;
  /** Enable automatic indexing suggestions */
  suggestIndexes?: boolean;
  /** Debug mode */
  debug?: boolean;
}

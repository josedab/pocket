/**
 * Comparison operators for query conditions.
 */
export type ComparisonOperator =
  | 'eq'
  | 'ne'
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
  | 'regex';

/**
 * Aggregate operation types.
 */
export type AggregateOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * A where clause that filters documents by field, operator, and value.
 */
export interface WhereClause<T> {
  readonly field: keyof T & string;
  readonly operator: ComparisonOperator;
  readonly value: unknown;
}

/**
 * A sort clause for ordering results.
 */
export interface SortClause<T> {
  readonly field: keyof T & string;
  readonly direction: 'asc' | 'desc';
}

/**
 * A projection spec indicating which fields to include.
 */
export type ProjectionSpec<T> = Partial<Record<keyof T & string, boolean>>;

/**
 * An aggregate clause for computing aggregate values.
 */
export interface AggregateClause<T> {
  readonly field: keyof T & string;
  readonly operation: AggregateOperation;
  readonly alias: string;
}

/**
 * A group-by clause with optional having condition.
 */
export interface GroupByClause<T> {
  readonly fields: readonly (keyof T & string)[];
  readonly having?: WhereClause<T>;
}

/**
 * A join clause for combining collections.
 */
export interface JoinClause {
  readonly collection: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly as: string;
  readonly type: 'inner' | 'left';
}

/**
 * A step in a query execution plan.
 */
export interface QueryStep {
  readonly type: string;
  readonly description: string;
  readonly collection?: string;
  readonly index?: string;
}

/**
 * A query execution plan with cost estimation.
 */
export interface QueryPlan {
  readonly steps: readonly QueryStep[];
  readonly estimatedCost: number;
  readonly usesIndex: boolean;
}

/**
 * Configuration for PocketQL.
 */
export interface PocketQLConfig {
  readonly strict?: boolean;
  readonly maxResults?: number;
  readonly enableExplain?: boolean;
}

/**
 * Logical grouping of where clauses.
 */
export interface LogicalGroup<T> {
  readonly type: 'and' | 'or';
  readonly clauses: readonly WhereClause<T>[];
}

/**
 * Represents a fully constructed, type-safe query expression.
 */
export interface QueryExpression<T> {
  readonly collection: string;
  readonly where: readonly WhereClause<T>[];
  readonly logicalGroups: readonly LogicalGroup<T>[];
  readonly sort: readonly SortClause<T>[];
  readonly projection: ProjectionSpec<T> | null;
  readonly aggregates: readonly AggregateClause<T>[];
  readonly groupBy: GroupByClause<T> | null;
  readonly joins: readonly JoinClause[];
  readonly limit: number | null;
  readonly skip: number | null;
}

/**
 * A compiled query ready for execution.
 */
export interface CompiledQuery<T = unknown> {
  readonly expression: QueryExpression<T>;
  readonly filterFn: (item: T) => boolean;
  readonly sortFn: ((a: T, b: T) => number) | null;
  readonly projectFn: ((item: T) => Partial<T>) | null;
}

/**
 * Validation result for a query expression.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Result of an aggregate query.
 */
export type AggregateResult = Readonly<Record<string, number>>;

/**
 * Result of a join query.
 */
export type JoinedResult = Readonly<Record<string, unknown>>;

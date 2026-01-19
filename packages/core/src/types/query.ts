import type { Document } from './document.js';

/**
 * Comparison operators for queries
 */
export interface ComparisonOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
}

/**
 * String-specific operators
 */
export interface StringOperators extends ComparisonOperators<string> {
  $regex?: RegExp | string;
  $startsWith?: string;
  $endsWith?: string;
  $contains?: string;
}

/**
 * Array operators
 */
export interface ArrayOperators<T> {
  $all?: T[];
  $elemMatch?: QueryCondition<T>;
  $size?: number;
}

/**
 * Logical operators
 */
export interface LogicalOperators<T extends Document> {
  $and?: QueryFilter<T>[];
  $or?: QueryFilter<T>[];
  $not?: QueryFilter<T>;
  $nor?: QueryFilter<T>[];
}

/**
 * Query condition for a single field
 */
export type QueryCondition<T> =
  | T
  | ComparisonOperators<T>
  | (T extends string ? StringOperators : never);

/**
 * Query filter for document fields
 */
export type QueryFilter<T extends Document> = {
  [K in keyof T]?: QueryCondition<T[K]>;
} & LogicalOperators<T>;

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort specification
 */
export type SortSpec<T extends Document> = {
  field: keyof T & string;
  direction: SortDirection;
};

/**
 * Complete query specification
 */
export interface QuerySpec<T extends Document> {
  /** Filter conditions */
  filter?: QueryFilter<T>;
  /** Sort specifications */
  sort?: SortSpec<T>[];
  /** Number of documents to skip */
  skip?: number;
  /** Maximum number of documents to return */
  limit?: number;
  /** Fields to include/exclude */
  projection?: Partial<Record<keyof T, 0 | 1>>;
}

/**
 * Query execution plan
 */
export interface QueryPlan {
  /** Index to use (null for full scan) */
  indexName: string | null;
  /** Whether index covers the query */
  indexCovers: boolean;
  /** Estimated documents to scan */
  estimatedScan: number;
  /** Whether sort can use index */
  sortUsingIndex: boolean;
  /** Query execution steps */
  steps: QueryPlanStep[];
}

/**
 * Individual step in query plan
 */
export interface QueryPlanStep {
  type: 'index-scan' | 'collection-scan' | 'filter' | 'sort' | 'skip' | 'limit';
  description: string;
  estimatedCost: number;
}

/**
 * Query result with metadata
 */
export interface QueryResult<T extends Document> {
  /** Matching documents */
  documents: T[];
  /** Total count (before skip/limit) */
  totalCount?: number;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Query plan used */
  plan?: QueryPlan;
}

/**
 * Field path type for nested field access
 */
export type FieldPath<T> = keyof T & string;

/**
 * Extract the value type for a field path
 */
export type FieldValue<T, K extends keyof T> = T[K];

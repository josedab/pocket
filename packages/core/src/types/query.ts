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
export interface SortSpec<T extends Document> {
  field: keyof T & string;
  direction: SortDirection;
}

/**
 * Cursor direction for pagination
 */
export type CursorDirection = 'after' | 'before';

/**
 * Cursor-based pagination specification
 */
export interface CursorSpec {
  /** The cursor value (typically a document ID or field value) */
  value: string;
  /** Direction: 'after' to get items after cursor, 'before' to get items before */
  direction: CursorDirection;
  /** The field to use for cursor comparison (defaults to '_id') */
  field?: string;
}

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
  /** Cursor-based pagination */
  cursor?: CursorSpec;
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
  /** Next cursor for pagination (if applicable) */
  nextCursor?: string;
  /** Previous cursor for pagination (if applicable) */
  prevCursor?: string;
  /** Whether there are more results */
  hasMore?: boolean;
}

/**
 * Query execution statistics
 */
export interface QueryExecutionStats {
  /** Total execution time in milliseconds */
  totalTimeMs: number;
  /** Number of documents scanned */
  documentsScanned: number;
  /** Number of index hits (if index was used) */
  indexHits: number;
  /** Number of documents returned */
  documentsReturned: number;
  /** Whether query used an index */
  usedIndex: boolean;
  /** Index name if used */
  indexName?: string;
}

/**
 * Full query explanation result
 */
export interface QueryExplainResult {
  /** The query plan that will be/was used */
  plan: QueryPlan;
  /** Execution statistics (only present after execution) */
  execution?: QueryExecutionStats;
  /** Suggestions for improving query performance */
  suggestions?: string[];
}

/**
 * Field path type for nested field access
 */
export type FieldPath<T> = keyof T & string;

/**
 * Extract the value type for a field path
 */
export type FieldValue<T, K extends keyof T> = T[K];

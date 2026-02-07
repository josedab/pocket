/**
 * Types for cross-database polyglot queries
 */

/**
 * Supported database adapter types
 */
export type AdapterType = 'postgres' | 'mysql' | 'mongodb' | 'sqlite' | 'memory' | 'custom';

/**
 * Database adapter interface for polyglot query federation
 */
export interface DatabaseAdapter {
  /** Unique adapter name */
  name: string;
  /** Database type */
  type: AdapterType;
  /** Connect to the database */
  connect(): Promise<void>;
  /** Disconnect from the database */
  disconnect(): Promise<void>;
  /** Execute a polyglot query */
  execute<T = Record<string, unknown>>(query: PolyglotQuery): Promise<PolyglotResult<T>>;
  /** Check adapter health */
  healthCheck(): Promise<boolean>;
}

/**
 * Cross-database join specification
 */
export interface JoinSpec {
  /** Target adapter name */
  targetAdapter: string;
  /** Target collection/table name */
  targetCollection: string;
  /** Local field to join on */
  localField: string;
  /** Foreign field to join on */
  foreignField: string;
  /** Join type */
  type: 'inner' | 'left' | 'right';
}

/**
 * A polyglot query that can be executed across adapters
 */
export interface PolyglotQuery {
  /** Source collection/table name */
  source: string;
  /** Target collection/table for mutations (defaults to source) */
  target?: string;
  /** Operation type */
  operation: 'select' | 'insert' | 'update' | 'delete';
  /** Filter criteria */
  filter?: Record<string, unknown>;
  /** Fields to include in result */
  projection?: string[];
  /** Sort specification (field -> 1 for asc, -1 for desc) */
  sort?: Record<string, 1 | -1>;
  /** Maximum number of results */
  limit?: number;
  /** Data for insert/update operations */
  data?: Record<string, unknown> | Record<string, unknown>[];
  /** Cross-adapter join specification */
  join?: JoinSpec;
}

/**
 * Result of a polyglot query execution
 */
export interface PolyglotResult<T = Record<string, unknown>> {
  /** Result data */
  data: T[];
  /** Total number of matching documents */
  totalCount: number;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Adapter names involved in the query */
  sources: string[];
}

/**
 * Configuration for a single adapter
 */
export interface AdapterConfig {
  /** Unique adapter name */
  name: string;
  /** Database type */
  type: AdapterType;
  /** Connection options */
  connectionOptions?: Record<string, unknown>;
}

/**
 * Configuration for the query federation
 */
export interface FederationConfig {
  /** Adapter configurations */
  adapters: AdapterConfig[];
  /** Default adapter name for queries without explicit target */
  defaultAdapter?: string;
  /** Query timeout in milliseconds */
  queryTimeout: number;
}

/**
 * A single step in a query execution plan
 */
export interface QueryStep {
  /** Adapter name */
  adapter: string;
  /** Operation to perform */
  operation: string;
  /** Filter criteria for this step */
  filter?: Record<string, unknown>;
  /** Projection for this step */
  projection?: string[];
}

/**
 * Query execution plan
 */
export interface QueryPlan {
  /** Ordered list of steps */
  steps: QueryStep[];
  /** Estimated cost (arbitrary units) */
  estimatedCost: number;
}

/**
 * Default federation configuration
 */
export const DEFAULT_FEDERATION_CONFIG: FederationConfig = {
  adapters: [],
  queryTimeout: 30_000,
};

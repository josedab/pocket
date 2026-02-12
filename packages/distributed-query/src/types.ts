/**
 * Types for distributed query execution
 */

/**
 * Range of data held by a node for a specific collection
 */
export interface DataRange {
  /** Collection name */
  collection: string;
  /** Optional key range boundaries */
  keyRange?: { min: string; max: string };
}

/**
 * Information about a node in the distributed cluster
 */
export interface NodeInfo {
  /** Unique node identifier */
  id: string;
  /** Network address of the node */
  address?: string;
  /** Current status of the node */
  status: 'active' | 'inactive' | 'unreachable';
  /** Timestamp of last heartbeat */
  lastSeen: number;
  /** List of capabilities this node supports */
  capabilities: string[];
  /** Data ranges held by this node */
  dataRanges?: DataRange[];
}

/**
 * Aggregation specification for distributed queries
 */
export interface AggregationSpec {
  /** Aggregation function to apply */
  function: 'sum' | 'avg' | 'min' | 'max' | 'count';
  /** Field to aggregate */
  field: string;
  /** Optional field to group results by */
  groupBy?: string;
}

/**
 * A distributed query to execute across nodes
 */
export interface DistributedQuery {
  /** Unique query identifier */
  id: string;
  /** Target collection */
  collection: string;
  /** Filter criteria */
  filter?: Record<string, unknown>;
  /** Aggregation specification */
  aggregation?: AggregationSpec;
  /** Sort specification: field name to direction */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Maximum number of results to return */
  limit?: number;
  /** Query timeout in milliseconds */
  timeout?: number;
}

/**
 * A sub-query assigned to a specific node
 */
export interface SubQuery {
  /** Target node identifier */
  nodeId: string;
  /** The query to execute */
  query: DistributedQuery;
  /** Current execution status */
  status: 'pending' | 'executing' | 'completed' | 'failed';
}

/**
 * Result of a distributed query execution
 */
export interface QueryResult {
  /** Identifier of the originating query */
  queryId: string;
  /** Result data rows */
  data: unknown[];
  /** Aggregation results keyed by group or field */
  aggregationResult?: Record<string, number>;
  /** Node IDs that responded successfully */
  respondedNodes: string[];
  /** Node IDs that failed to respond */
  failedNodes: string[];
  /** Total execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Configuration for the distributed query engine
 */
export interface DistributedQueryConfig {
  /** Maximum number of nodes to fan out a query to */
  maxFanout: number;
  /** Default query timeout in milliseconds */
  timeoutMs: number;
  /** Minimum number of nodes that must respond for a valid result */
  quorumSize?: number;
  /** Number of retry attempts for failed sub-queries */
  retryAttempts: number;
}

/**
 * Message exchanged between nodes
 */
export interface NodeMessage {
  /** Message type */
  type: 'query-request' | 'query-response' | 'heartbeat' | 'node-join' | 'node-leave';
  /** Identifier of the sending node */
  senderId: string;
  /** Message payload */
  payload: unknown;
}

/**
 * Default distributed query configuration
 */
export const DEFAULT_DISTRIBUTED_CONFIG: DistributedQueryConfig = {
  maxFanout: 10,
  timeoutMs: 30_000,
  quorumSize: undefined,
  retryAttempts: 2,
};

/**
 * Distributed Query Engine - Orchestrates distributed query execution
 */

import type {
  DistributedQuery,
  DistributedQueryConfig,
  NodeInfo,
  NodeMessage,
  QueryResult,
} from './types.js';
import { DEFAULT_DISTRIBUTED_CONFIG } from './types.js';
import { NodeRegistry } from './node-registry.js';
import { QueryDecomposer } from './query-decomposer.js';
import { ResultAggregator } from './result-aggregator.js';

/**
 * Execution statistics for the engine
 */
export interface EngineStats {
  /** Total number of queries executed */
  totalQueries: number;
  /** Number of successful queries */
  successfulQueries: number;
  /** Number of failed queries */
  failedQueries: number;
  /** Average execution time in milliseconds */
  avgExecutionTimeMs: number;
  /** Number of registered nodes */
  registeredNodes: number;
}

/**
 * Orchestrates distributed query decomposition, execution, and aggregation
 */
export class DistributedQueryEngine {
  private readonly config: DistributedQueryConfig;
  private readonly localNodeId: string;
  private readonly registry: NodeRegistry;
  private readonly decomposer: QueryDecomposer;
  private readonly aggregator: ResultAggregator;

  private totalQueries = 0;
  private successfulQueries = 0;
  private failedQueries = 0;
  private totalExecutionTimeMs = 0;

  constructor(config: DistributedQueryConfig = DEFAULT_DISTRIBUTED_CONFIG, localNodeId?: string) {
    this.config = { ...DEFAULT_DISTRIBUTED_CONFIG, ...config };
    this.localNodeId = localNodeId ?? `node-${Date.now()}`;
    this.registry = new NodeRegistry();
    this.decomposer = new QueryDecomposer(this.config);
    this.aggregator = new ResultAggregator();
  }

  /**
   * Execute a distributed query across available nodes
   */
  execute(query: DistributedQuery): QueryResult {
    const startTime = Date.now();
    this.totalQueries++;

    try {
      const activeNodes = this.registry.getActiveNodes();

      if (activeNodes.length === 0) {
        // No remote nodes — execute locally and return empty result
        const result: QueryResult = {
          queryId: query.id,
          data: [],
          respondedNodes: [this.localNodeId],
          failedNodes: [],
          executionTimeMs: Date.now() - startTime,
        };
        this.successfulQueries++;
        this.totalExecutionTimeMs += result.executionTimeMs;
        return result;
      }

      const subQueries = this.decomposer.decompose(query, activeNodes);

      // Simulate execution: each sub-query produces a partial result
      const partialResults: QueryResult[] = subQueries.map((sq) => ({
        queryId: query.id,
        data: [],
        respondedNodes: [sq.nodeId],
        failedNodes: [],
        executionTimeMs: 0,
      }));

      const merged = this.aggregator.merge(partialResults);

      // Apply post-merge operations
      let data = merged.data;

      if (query.aggregation) {
        merged.aggregationResult = this.aggregator.aggregate(data, query.aggregation);
      }

      if (query.sort) {
        data = this.aggregator.sort(data, query.sort);
      }

      if (query.limit) {
        data = this.aggregator.applyLimit(data, query.limit);
      }

      const result: QueryResult = {
        ...merged,
        data,
        executionTimeMs: Date.now() - startTime,
      };

      this.successfulQueries++;
      this.totalExecutionTimeMs += result.executionTimeMs;
      return result;
    } catch {
      this.failedQueries++;
      const executionTimeMs = Date.now() - startTime;
      this.totalExecutionTimeMs += executionTimeMs;

      return {
        queryId: query.id,
        data: [],
        respondedNodes: [],
        failedNodes: this.registry.getActiveNodes().map((n) => n.id),
        executionTimeMs,
      };
    }
  }

  /**
   * Register a peer node with the engine
   */
  registerNode(node: NodeInfo): void {
    this.registry.register(node);
  }

  /**
   * Handle an incoming query request from another node
   */
  handleQueryRequest(message: NodeMessage): QueryResult {
    if (message.type !== 'query-request') {
      return {
        queryId: '',
        data: [],
        respondedNodes: [this.localNodeId],
        failedNodes: [],
        executionTimeMs: 0,
      };
    }

    const query = message.payload as DistributedQuery;
    return {
      queryId: query.id,
      data: [],
      respondedNodes: [this.localNodeId],
      failedNodes: [],
      executionTimeMs: 0,
    };
  }

  /**
   * Get execution statistics
   */
  getStats(): EngineStats {
    return {
      totalQueries: this.totalQueries,
      successfulQueries: this.successfulQueries,
      failedQueries: this.failedQueries,
      avgExecutionTimeMs:
        this.totalQueries > 0 ? this.totalExecutionTimeMs / this.totalQueries : 0,
      registeredNodes: this.registry.getNodeCount(),
    };
  }
}

/**
 * Create a distributed query engine
 */
export function createDistributedQueryEngine(
  config?: Partial<DistributedQueryConfig>,
  localNodeId?: string
): DistributedQueryEngine {
  return new DistributedQueryEngine(
    { ...DEFAULT_DISTRIBUTED_CONFIG, ...config },
    localNodeId
  );
}

/**
 * Data-locality-aware query planner for distributed queries.
 * Decomposes queries with cost estimation and node affinity.
 */
import type { DistributedQuery, NodeInfo, SubQuery } from './types.js';

export interface QueryPlan {
  queryId: string;
  strategy: 'scatter-gather' | 'targeted' | 'local-only' | 'broadcast';
  subPlans: SubPlan[];
  estimatedCost: number;
  estimatedLatencyMs: number;
}

export interface SubPlan {
  nodeId: string;
  subQuery: SubQuery;
  priority: number;
  estimatedRows: number;
  dataLocality: 'local' | 'remote' | 'cached';
}

export interface PlannerConfig {
  preferLocalExecution?: boolean;
  maxFanout?: number;
  latencyWeightMs?: number;
}

/**
 * Plans distributed query execution with data locality awareness.
 */
export class QueryPlanner {
  private readonly config: Required<PlannerConfig>;

  constructor(config?: PlannerConfig) {
    this.config = {
      preferLocalExecution: config?.preferLocalExecution ?? true,
      maxFanout: config?.maxFanout ?? 10,
      latencyWeightMs: config?.latencyWeightMs ?? 50,
    };
  }

  /** Create an execution plan for a distributed query */
  plan(query: DistributedQuery, nodes: NodeInfo[], localNodeId?: string): QueryPlan {
    const activeNodes = nodes.filter((n) => n.status === 'active');

    if (activeNodes.length === 0) {
      return this.createLocalOnlyPlan(query, localNodeId);
    }

    // Score each node for this query
    const scoredNodes = activeNodes
      .map((node) => ({
        node,
        score: this.scoreNodeForQuery(node, query),
        isLocal: node.id === localNodeId,
      }))
      .sort((a, b) => b.score - a.score);

    // Determine strategy
    const strategy = this.determineStrategy(query, scoredNodes);

    // Build sub-plans
    const selectedNodes = scoredNodes.slice(0, this.config.maxFanout);
    const subPlans: SubPlan[] = selectedNodes.map(({ node, score, isLocal }) => ({
      nodeId: node.id,
      subQuery: {
        nodeId: node.id,
        query: { ...query },
        status: 'pending' as const,
      },
      priority: score,
      estimatedRows: this.estimateRows(node, query),
      dataLocality: isLocal ? ('local' as const) : ('remote' as const),
    }));

    // Prioritize local execution
    if (this.config.preferLocalExecution) {
      subPlans.sort((a, b) => {
        if (a.dataLocality === 'local' && b.dataLocality !== 'local') return -1;
        if (a.dataLocality !== 'local' && b.dataLocality === 'local') return 1;
        return b.priority - a.priority;
      });
    }

    const estimatedCost = subPlans.reduce((sum, sp) => sum + 1 / Math.max(sp.priority, 0.1), 0);
    const estimatedLatency =
      subPlans.length > 0
        ? this.config.latencyWeightMs * (subPlans.some((sp) => sp.dataLocality !== 'local') ? 2 : 1)
        : 0;

    return {
      queryId: query.id,
      strategy,
      subPlans,
      estimatedCost,
      estimatedLatencyMs: estimatedLatency,
    };
  }

  /** Explain a query plan in human-readable format */
  explain(plan: QueryPlan): string {
    const lines: string[] = [
      `Query Plan: ${plan.queryId}`,
      `Strategy: ${plan.strategy}`,
      `Estimated Cost: ${plan.estimatedCost.toFixed(2)}`,
      `Estimated Latency: ${plan.estimatedLatencyMs}ms`,
      `Sub-plans: ${plan.subPlans.length}`,
      '---',
    ];

    for (const sp of plan.subPlans) {
      lines.push(`  Node: ${sp.nodeId} (${sp.dataLocality})`);
      lines.push(`    Priority: ${sp.priority}`);
      lines.push(`    Est. Rows: ${sp.estimatedRows}`);
    }

    return lines.join('\n');
  }

  private determineStrategy(
    query: DistributedQuery,
    scoredNodes: { node: NodeInfo; score: number }[]
  ): QueryPlan['strategy'] {
    // If only one node has data, use targeted
    const nodesWithData = scoredNodes.filter((n) => n.score > 1);
    if (nodesWithData.length <= 1) return 'targeted';

    // If query has specific filter, use scatter-gather
    if (query.filter && Object.keys(query.filter).length > 0) return 'scatter-gather';

    // If aggregation, need all nodes
    if (query.aggregation) return 'broadcast';

    return 'scatter-gather';
  }

  private scoreNodeForQuery(node: NodeInfo, query: DistributedQuery): number {
    let score = 1.0; // base score

    // Bonus for having the collection
    if (node.dataRanges) {
      for (const range of node.dataRanges) {
        if (range.collection === query.collection) {
          score += 5.0;
          // Bonus for key range overlap with filter
          if (query.filter && range.keyRange) {
            score += 2.0;
          }
        }
      }
    }

    // Bonus for capabilities
    if (node.capabilities) {
      if (query.aggregation && node.capabilities.includes('aggregation')) score += 1.0;
      if (node.capabilities.includes('index')) score += 0.5;
    }

    return score;
  }

  private estimateRows(node: NodeInfo, query: DistributedQuery): number {
    // Rough estimation based on data ranges
    if (node.dataRanges) {
      for (const range of node.dataRanges) {
        if (range.collection === query.collection) return 100;
      }
    }
    return 50;
  }

  private createLocalOnlyPlan(query: DistributedQuery, localNodeId?: string): QueryPlan {
    return {
      queryId: query.id,
      strategy: 'local-only',
      subPlans: localNodeId
        ? [
            {
              nodeId: localNodeId,
              subQuery: { nodeId: localNodeId, query, status: 'pending' },
              priority: 10,
              estimatedRows: 100,
              dataLocality: 'local',
            },
          ]
        : [],
      estimatedCost: 1,
      estimatedLatencyMs: 5,
    };
  }
}

export function createQueryPlanner(config?: PlannerConfig): QueryPlanner {
  return new QueryPlanner(config);
}

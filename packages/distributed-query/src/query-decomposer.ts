/**
 * Query Decomposer - Splits queries into sub-queries for distributed execution
 */

import type { DistributedQuery, DistributedQueryConfig, NodeInfo, SubQuery } from './types.js';

/**
 * Decomposes a distributed query into sub-queries routed to appropriate nodes
 */
export class QueryDecomposer {
  private readonly config: DistributedQueryConfig;

  constructor(config: DistributedQueryConfig) {
    this.config = config;
  }

  /**
   * Decompose a query into sub-queries, one per selected node, respecting maxFanout
   */
  decompose(query: DistributedQuery, nodes: NodeInfo[]): SubQuery[] {
    const selected = this.selectNodes(query, nodes);
    const limited = selected.slice(0, this.config.maxFanout);

    return limited.map((node) => ({
      nodeId: node.id,
      query: { ...query },
      status: 'pending' as const,
    }));
  }

  /**
   * Select the best nodes for a query based on data ranges and capabilities
   */
  selectNodes(query: DistributedQuery, availableNodes: NodeInfo[]): NodeInfo[] {
    const active = availableNodes.filter((n) => n.status === 'active');

    // Score each node by relevance
    const scored = active.map((node) => ({
      node,
      score: this.scoreNode(node, query),
    }));

    // Sort by score descending (higher = better match)
    scored.sort((a, b) => b.score - a.score);

    // Return only nodes with a positive score
    return scored.filter((s) => s.score > 0).map((s) => s.node);
  }

  /**
   * Score a node for a given query based on data range coverage
   */
  private scoreNode(node: NodeInfo, query: DistributedQuery): number {
    let score = 1; // base score for any active node

    if (!node.dataRanges || node.dataRanges.length === 0) {
      // Node without explicit ranges is assumed to hold all data
      return score;
    }

    const matchingRange = node.dataRanges.find((r) => r.collection === query.collection);
    if (!matchingRange) {
      return 0; // node does not hold data for the target collection
    }

    // Bonus for having a specific key range match
    if (matchingRange.keyRange) {
      score += 1;
    }

    // Bonus for relevant capabilities
    if (query.aggregation && node.capabilities.includes('aggregation')) {
      score += 1;
    }

    return score;
  }
}

/**
 * Create a query decomposer
 */
export function createQueryDecomposer(config: DistributedQueryConfig): QueryDecomposer {
  return new QueryDecomposer(config);
}

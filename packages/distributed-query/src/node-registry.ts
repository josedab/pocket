/**
 * Node Registry - Manages the set of known nodes in the cluster
 */

import type { NodeInfo } from './types.js';

/**
 * Registry for tracking nodes in a distributed cluster
 */
export class NodeRegistry {
  private readonly nodes = new Map<string, NodeInfo>();

  /**
   * Register or update a node
   */
  register(node: NodeInfo): void {
    this.nodes.set(node.id, { ...node });
  }

  /**
   * Remove a node from the registry
   */
  deregister(nodeId: string): boolean {
    return this.nodes.delete(nodeId);
  }

  /**
   * Get information about a specific node
   */
  getNode(nodeId: string): NodeInfo | undefined {
    const node = this.nodes.get(nodeId);
    return node ? { ...node } : undefined;
  }

  /**
   * Get all nodes with active status
   */
  getActiveNodes(): NodeInfo[] {
    return [...this.nodes.values()].filter((n) => n.status === 'active');
  }

  /**
   * Get nodes that hold data for the given collection
   */
  getNodesForCollection(collection: string): NodeInfo[] {
    return this.getActiveNodes().filter((node) => {
      if (!node.dataRanges || node.dataRanges.length === 0) {
        // Nodes without explicit data ranges are assumed to hold all data
        return true;
      }
      return node.dataRanges.some((range) => range.collection === collection);
    });
  }

  /**
   * Update the status of a node
   */
  updateStatus(nodeId: string, status: NodeInfo['status']): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.status = status;
    return true;
  }

  /**
   * Update the lastSeen timestamp for a node
   */
  heartbeat(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.lastSeen = Date.now();
    node.status = 'active';
    return true;
  }

  /**
   * Remove nodes that have not been seen within the given TTL
   */
  pruneInactive(ttlMs: number): string[] {
    const now = Date.now();
    const pruned: string[] = [];

    for (const [id, node] of this.nodes) {
      if (now - node.lastSeen > ttlMs) {
        this.nodes.delete(id);
        pruned.push(id);
      }
    }

    return pruned;
  }

  /**
   * Get the total number of registered nodes
   */
  getNodeCount(): number {
    return this.nodes.size;
  }
}

/**
 * Create a node registry
 */
export function createNodeRegistry(): NodeRegistry {
  return new NodeRegistry();
}

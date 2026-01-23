import { getDistanceFunction } from './distance.js';
import type { DistanceMetric, HNSWParams, Vector, VectorIndex } from './types.js';

/**
 * HNSW Node
 */
interface HNSWNode {
  id: string;
  vector: Vector;
  level: number;
  neighbors: Map<number, Set<string>>; // level -> neighbor IDs
}

/**
 * HNSW (Hierarchical Navigable Small World) vector index
 * Provides approximate nearest neighbor search with O(log N) complexity
 */
export class HNSWIndex implements VectorIndex {
  readonly name: string;
  private nodes = new Map<string, HNSWNode>();
  private entryPoint: string | null = null;
  private maxLevel = 0;
  private readonly metric: DistanceMetric;
  private readonly distanceFn: (a: Vector, b: Vector) => number;

  // HNSW parameters
  private readonly efConstruction: number;
  private readonly efSearch: number;
  private readonly m: number;
  private readonly m0: number;
  // mL is kept for potential future use in level probability calculations
  // private readonly mL: number;

  constructor(name: string, metric: DistanceMetric = 'cosine', params: HNSWParams = {}) {
    this.name = name;
    this.metric = metric;
    this.distanceFn = getDistanceFunction(metric);

    // Default HNSW parameters
    this.efConstruction = params.efConstruction ?? 200;
    this.efSearch = params.efSearch ?? 50;
    this.m = params.m ?? 16;
    this.m0 = params.m0 ?? this.m * 2;
  }

  /**
   * Generate random level for new node
   */
  private getRandomLevel(): number {
    let level = 0;
    while (Math.random() < 1 / this.m && level < 16) {
      level++;
    }
    return level;
  }

  /**
   * Add a vector to the index
   */
  add(id: string, vector: Vector): void {
    // Check if already exists
    if (this.nodes.has(id)) {
      // Update existing node
      const node = this.nodes.get(id)!;
      node.vector = vector;
      return;
    }

    const level = this.getRandomLevel();
    const newNode: HNSWNode = {
      id,
      vector,
      level,
      neighbors: new Map(),
    };

    // Initialize neighbor sets for each level
    for (let l = 0; l <= level; l++) {
      newNode.neighbors.set(l, new Set());
    }

    this.nodes.set(id, newNode);

    // If this is the first node
    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      return;
    }

    // Search for entry point at each level
    let currentId = this.entryPoint;

    // Traverse from top level to node's level
    for (let l = this.maxLevel; l > level; l--) {
      const [closestId] = this.searchLayer(vector, currentId, 1, l);
      if (closestId) {
        currentId = closestId;
      }
    }

    // Insert at each level from node's level to 0
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const neighbors = this.searchLayer(vector, currentId, this.efConstruction, l);

      // Select M best neighbors
      const maxNeighbors = l === 0 ? this.m0 : this.m;
      const selectedNeighbors = neighbors.slice(0, maxNeighbors);

      // Add bidirectional edges
      for (const neighborId of selectedNeighbors) {
        newNode.neighbors.get(l)!.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (neighborNode?.neighbors.has(l)) {
          neighborNode.neighbors.get(l)!.add(id);

          // Prune if necessary
          if (neighborNode.neighbors.get(l)!.size > maxNeighbors) {
            this.pruneNeighbors(neighborNode, l, maxNeighbors);
          }
        }
      }

      if (neighbors.length > 0) {
        currentId = neighbors[0]!;
      }
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.entryPoint = id;
      this.maxLevel = level;
    }
  }

  /**
   * Search a single layer for nearest neighbors
   */
  private searchLayer(query: Vector, entryId: string, ef: number, level: number): string[] {
    const visited = new Set<string>([entryId]);
    const candidates: { id: string; distance: number }[] = [];
    const results: { id: string; distance: number }[] = [];

    const entryNode = this.nodes.get(entryId);
    if (!entryNode) return [];

    const entryDist = this.distanceFn(query, entryNode.vector);
    candidates.push({ id: entryId, distance: entryDist });
    results.push({ id: entryId, distance: entryDist });

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      // Get furthest result
      results.sort((a, b) => a.distance - b.distance);
      const furthestResult = results[results.length - 1]!;

      // Stop if current is further than furthest result
      if (current.distance > furthestResult.distance) {
        break;
      }

      // Explore neighbors
      const currentNode = this.nodes.get(current.id);
      if (!currentNode) continue;

      const neighbors = currentNode.neighbors.get(level);
      if (!neighbors) continue;

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const distance = this.distanceFn(query, neighborNode.vector);

        // Add to results if closer than furthest result (recalculate furthest after sort)
        const currentFurthest = results[results.length - 1];
        if (results.length < ef || (currentFurthest && distance < currentFurthest.distance)) {
          candidates.push({ id: neighborId, distance });
          results.push({ id: neighborId, distance });

          // Keep only ef best results
          if (results.length > ef) {
            results.sort((a, b) => a.distance - b.distance);
            results.pop();
          }
        }
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.map((r) => r.id);
  }

  /**
   * Prune neighbors to keep only the closest ones
   */
  private pruneNeighbors(node: HNSWNode, level: number, maxNeighbors: number): void {
    const neighbors = node.neighbors.get(level);
    if (!neighbors || neighbors.size <= maxNeighbors) return;

    const distances: { id: string; distance: number }[] = [];

    for (const neighborId of neighbors) {
      const neighborNode = this.nodes.get(neighborId);
      if (neighborNode) {
        distances.push({
          id: neighborId,
          distance: this.distanceFn(node.vector, neighborNode.vector),
        });
      }
    }

    distances.sort((a, b) => a.distance - b.distance);

    // Keep only maxNeighbors closest
    const newNeighbors = new Set(distances.slice(0, maxNeighbors).map((d) => d.id));

    // Remove edges from pruned neighbors
    for (const neighborId of neighbors) {
      if (!newNeighbors.has(neighborId)) {
        const neighborNode = this.nodes.get(neighborId);
        if (neighborNode?.neighbors.has(level)) {
          neighborNode.neighbors.get(level)!.delete(node.id);
        }
      }
    }

    node.neighbors.set(level, newNeighbors);
  }

  /**
   * Remove a vector from the index
   */
  remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove all edges to this node
    for (let l = 0; l <= node.level; l++) {
      const neighbors = node.neighbors.get(l);
      if (neighbors) {
        for (const neighborId of neighbors) {
          const neighborNode = this.nodes.get(neighborId);
          if (neighborNode?.neighbors.has(l)) {
            neighborNode.neighbors.get(l)!.delete(id);
          }
        }
      }
    }

    this.nodes.delete(id);

    // Update entry point if necessary
    if (this.entryPoint === id) {
      if (this.nodes.size === 0) {
        this.entryPoint = null;
        this.maxLevel = 0;
      } else {
        // Find a new entry point
        let newEntry: string | null = null;
        let newMaxLevel = 0;

        for (const [nodeId, nodeData] of this.nodes) {
          if (nodeData.level > newMaxLevel) {
            newMaxLevel = nodeData.level;
            newEntry = nodeId;
          }
        }

        this.entryPoint = newEntry;
        this.maxLevel = newMaxLevel;
      }
    }
  }

  /**
   * Check if a vector exists
   */
  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Get a vector by ID
   */
  get(id: string): Vector | undefined {
    return this.nodes.get(id)?.vector;
  }

  /**
   * Search for nearest neighbors
   */
  search(query: Vector, k: number): { id: string; distance: number }[] {
    if (this.entryPoint === null) {
      return [];
    }

    let currentId = this.entryPoint;

    // Traverse from top level to level 1
    for (let l = this.maxLevel; l > 0; l--) {
      const [closestId] = this.searchLayer(query, currentId, 1, l);
      if (closestId) {
        currentId = closestId;
      }
    }

    // Search at level 0 with efSearch
    const candidates = this.searchLayer(query, currentId, Math.max(this.efSearch, k), 0);

    // Return top k results with distances
    return candidates.slice(0, k).map((id) => {
      const node = this.nodes.get(id)!;
      return {
        id,
        distance: this.distanceFn(query, node.vector),
      };
    });
  }

  /**
   * Rebuild the index from scratch
   */
  rebuild(): void {
    const entries = Array.from(this.nodes.entries()).map(([id, node]) => ({
      id,
      vector: node.vector,
    }));

    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;

    for (const { id, vector } of entries) {
      this.add(id, vector);
    }
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;
  }

  /**
   * Get all vector IDs
   */
  getIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get index statistics
   */
  stats(): { count: number; memoryBytes: number } {
    let memoryBytes = 0;

    for (const node of this.nodes.values()) {
      // Vector storage
      memoryBytes += node.vector.length * 8;

      // Neighbor storage (rough estimate)
      for (const neighbors of node.neighbors.values()) {
        memoryBytes += neighbors.size * 50; // String ID references
      }
    }

    return {
      count: this.nodes.size,
      memoryBytes,
    };
  }

  /**
   * Get distance metric
   */
  getMetric(): DistanceMetric {
    return this.metric;
  }

  /**
   * Get HNSW parameters
   */
  getParams(): HNSWParams {
    return {
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      m: this.m,
      m0: this.m0,
    };
  }
}

/**
 * Create an HNSW index
 */
export function createHNSWIndex(
  name: string,
  metric: DistanceMetric = 'cosine',
  params?: HNSWParams
): HNSWIndex {
  return new HNSWIndex(name, metric, params);
}

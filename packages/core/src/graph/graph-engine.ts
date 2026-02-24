/**
 * Graph Layer — adds graph traversal over document relationships.
 */

/** An edge between two documents. */
export interface GraphEdge {
  readonly id: string;
  readonly sourceCollection: string;
  readonly sourceId: string;
  readonly targetCollection: string;
  readonly targetId: string;
  readonly label: string;
  readonly properties?: Record<string, unknown>;
  readonly createdAt: number;
}

/** A node reference in a traversal result. */
export interface GraphNode {
  readonly collection: string;
  readonly documentId: string;
}

/** Traversal direction. */
export type TraversalDirection = 'outgoing' | 'incoming' | 'both';

/** Traversal options. */
export interface TraversalOptions {
  readonly direction?: TraversalDirection;
  readonly label?: string;
  readonly maxDepth?: number;
  readonly limit?: number;
}

/** Result of a graph traversal. */
export interface TraversalResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly depth: number;
}

/** Pattern match for graph queries. */
export interface MatchPattern {
  readonly sourceLabel?: string;
  readonly edgeLabel: string;
  readonly targetLabel?: string;
}

/** Graph query result. */
export interface GraphQueryResult {
  readonly matches: readonly {
    readonly source: GraphNode;
    readonly edge: GraphEdge;
    readonly target: GraphNode;
  }[];
  readonly count: number;
}

export class GraphEngine {
  private readonly edges: GraphEdge[] = [];
  private readonly edgeIndex = new Map<string, GraphEdge[]>();
  private readonly reverseIndex = new Map<string, GraphEdge[]>();
  private edgeCounter = 0;

  addEdge(
    sourceCollection: string,
    sourceId: string,
    targetCollection: string,
    targetId: string,
    label: string,
    properties?: Record<string, unknown>
  ): GraphEdge {
    const edge: GraphEdge = {
      id: `edge-${++this.edgeCounter}`,
      sourceCollection,
      sourceId,
      targetCollection,
      targetId,
      label,
      properties,
      createdAt: Date.now(),
    };
    this.edges.push(edge);
    const srcKey = `${sourceCollection}:${sourceId}`;
    const tgtKey = `${targetCollection}:${targetId}`;
    this.edgeIndex.set(srcKey, [...(this.edgeIndex.get(srcKey) ?? []), edge]);
    this.reverseIndex.set(tgtKey, [...(this.reverseIndex.get(tgtKey) ?? []), edge]);
    return edge;
  }

  removeEdge(edgeId: string): boolean {
    const idx = this.edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) return false;
    const edge = this.edges[idx]!;
    this.edges.splice(idx, 1);
    const srcKey = `${edge.sourceCollection}:${edge.sourceId}`;
    const tgtKey = `${edge.targetCollection}:${edge.targetId}`;
    this.edgeIndex.set(
      srcKey,
      (this.edgeIndex.get(srcKey) ?? []).filter((e) => e.id !== edgeId)
    );
    this.reverseIndex.set(
      tgtKey,
      (this.reverseIndex.get(tgtKey) ?? []).filter((e) => e.id !== edgeId)
    );
    return true;
  }

  getEdges(collection: string, id: string, options?: TraversalOptions): readonly GraphEdge[] {
    const direction = options?.direction ?? 'both';
    const key = `${collection}:${id}`;
    let result: GraphEdge[] = [];
    if (direction === 'outgoing' || direction === 'both')
      result = result.concat(this.edgeIndex.get(key) ?? []);
    if (direction === 'incoming' || direction === 'both')
      result = result.concat(this.reverseIndex.get(key) ?? []);
    if (options?.label) result = result.filter((e) => e.label === options.label);
    return options?.limit ? result.slice(0, options.limit) : result;
  }

  traverse(collection: string, id: string, options?: TraversalOptions): TraversalResult {
    const maxDepth = options?.maxDepth ?? 3;
    const direction = options?.direction ?? 'outgoing';
    const label = options?.label;
    const limit = options?.limit ?? 1000;

    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    visited.add(`${collection}:${id}`);

    const queue: { collection: string; id: string; depth: number }[] = [
      { collection, id, depth: 0 },
    ];
    let maxReachedDepth = 0;

    while (queue.length > 0 && nodes.length < limit) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const edges = this.getEdges(current.collection, current.id, { direction, label });
      for (const edge of edges) {
        const isSource =
          edge.sourceCollection === current.collection && edge.sourceId === current.id;
        const nextCol = isSource ? edge.targetCollection : edge.sourceCollection;
        const nextId = isSource ? edge.targetId : edge.sourceId;
        const nextKey = `${nextCol}:${nextId}`;
        if (visited.has(nextKey)) continue;
        visited.add(nextKey);

        nodes.push({ collection: nextCol, documentId: nextId });
        allEdges.push(edge);
        maxReachedDepth = Math.max(maxReachedDepth, current.depth + 1);
        queue.push({ collection: nextCol, id: nextId, depth: current.depth + 1 });
      }
    }

    return { nodes, edges: allEdges, depth: maxReachedDepth };
  }

  match(pattern: MatchPattern): GraphQueryResult {
    const matches: { source: GraphNode; edge: GraphEdge; target: GraphNode }[] = [];
    for (const edge of this.edges) {
      if (edge.label !== pattern.edgeLabel) continue;
      if (pattern.sourceLabel && edge.sourceCollection !== pattern.sourceLabel) continue;
      if (pattern.targetLabel && edge.targetCollection !== pattern.targetLabel) continue;
      matches.push({
        source: { collection: edge.sourceCollection, documentId: edge.sourceId },
        edge,
        target: { collection: edge.targetCollection, documentId: edge.targetId },
      });
    }
    return { matches, count: matches.length };
  }

  shortestPath(
    fromCol: string,
    fromId: string,
    toCol: string,
    toId: string,
    maxDepth = 10
  ): readonly GraphNode[] | null {
    const targetKey = `${toCol}:${toId}`;
    const visited = new Set<string>();
    visited.add(`${fromCol}:${fromId}`);
    const queue: { collection: string; id: string; path: GraphNode[] }[] = [
      { collection: fromCol, id: fromId, path: [{ collection: fromCol, documentId: fromId }] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth + 1) continue;
      const edges = this.getEdges(current.collection, current.id, { direction: 'both' });
      for (const edge of edges) {
        const isSource =
          edge.sourceCollection === current.collection && edge.sourceId === current.id;
        const nextCol = isSource ? edge.targetCollection : edge.sourceCollection;
        const nextId = isSource ? edge.targetId : edge.sourceId;
        const nextKey = `${nextCol}:${nextId}`;
        if (visited.has(nextKey)) continue;
        visited.add(nextKey);
        const nextPath = [...current.path, { collection: nextCol, documentId: nextId }];
        if (nextKey === targetKey) return nextPath;
        queue.push({ collection: nextCol, id: nextId, path: nextPath });
      }
    }
    return null;
  }

  get edgeCount(): number {
    return this.edges.length;
  }
}

export function createGraphEngine(): GraphEngine {
  return new GraphEngine();
}

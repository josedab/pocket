/**
 * Collection Graph Accessor — provides a fluent graph API
 * on top of a Pocket collection for multi-model queries.
 *
 * Usage:
 * ```ts
 * const graph = createCollectionGraph('users', engine);
 * graph.linkTo('posts', 'u1', 'p1', 'authored');
 * const related = graph.from('u1').outgoing('authored').results();
 * ```
 */

import type { GraphEdge, GraphNode, TraversalResult } from './graph-engine.js';
import { GraphEngine } from './graph-engine.js';

/** A fluent traversal builder for a specific starting node. */
export interface GraphTraversalBuilder {
  /** Traverse outgoing edges. */
  outgoing(label?: string): GraphTraversalBuilder;
  /** Traverse incoming edges. */
  incoming(label?: string): GraphTraversalBuilder;
  /** Traverse edges in both directions. */
  both(label?: string): GraphTraversalBuilder;
  /** Set maximum traversal depth. */
  depth(maxDepth: number): GraphTraversalBuilder;
  /** Limit the number of results. */
  limit(n: number): GraphTraversalBuilder;
  /** Execute the traversal and return results. */
  results(): TraversalResult;
  /** Get just the connected node IDs. */
  nodeIds(): readonly string[];
  /** Get the edges traversed. */
  edges(): readonly GraphEdge[];
}

/** Graph accessor for a specific collection. */
export class CollectionGraph {
  private readonly engine: GraphEngine;
  private readonly collectionName: string;

  constructor(collectionName: string, engine?: GraphEngine) {
    this.collectionName = collectionName;
    this.engine = engine ?? new GraphEngine();
  }

  /** Create a link from a document in this collection to a document in another collection. */
  linkTo(
    targetCollection: string,
    sourceId: string,
    targetId: string,
    label: string,
    properties?: Record<string, unknown>
  ): GraphEdge {
    return this.engine.addEdge(
      this.collectionName,
      sourceId,
      targetCollection,
      targetId,
      label,
      properties
    );
  }

  /** Create a link between two documents in this collection. */
  link(
    sourceId: string,
    targetId: string,
    label: string,
    properties?: Record<string, unknown>
  ): GraphEdge {
    return this.engine.addEdge(
      this.collectionName,
      sourceId,
      this.collectionName,
      targetId,
      label,
      properties
    );
  }

  /** Remove a link by edge ID. */
  unlink(edgeId: string): boolean {
    return this.engine.removeEdge(edgeId);
  }

  /** Start a fluent traversal from a document in this collection. */
  from(documentId: string): GraphTraversalBuilder {
    return createTraversalBuilder(this.engine, this.collectionName, documentId);
  }

  /** Find all documents linked to a target via a specific label. */
  findLinked(
    documentId: string,
    label: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'outgoing'
  ): readonly GraphNode[] {
    const result = this.engine.traverse(this.collectionName, documentId, {
      direction,
      label,
      maxDepth: 1,
    });
    return result.nodes;
  }

  /** Find shortest path between two documents. */
  pathTo(
    fromId: string,
    toCollection: string,
    toId: string,
    maxDepth?: number
  ): readonly GraphNode[] | null {
    return this.engine.shortestPath(this.collectionName, fromId, toCollection, toId, maxDepth);
  }

  /** Match a pattern starting from this collection. */
  matchPattern(
    edgeLabel: string,
    targetCollection?: string
  ): readonly {
    source: GraphNode;
    edge: GraphEdge;
    target: GraphNode;
  }[] {
    const result = this.engine.match({
      sourceLabel: this.collectionName,
      edgeLabel,
      targetLabel: targetCollection,
    });
    return result.matches;
  }

  /** Get the underlying graph engine (for advanced use). */
  getEngine(): GraphEngine {
    return this.engine;
  }

  /** Total number of edges involving this collection. */
  get edgeCount(): number {
    return this.engine.edgeCount;
  }
}

function createTraversalBuilder(
  engine: GraphEngine,
  collection: string,
  documentId: string
): GraphTraversalBuilder {
  let direction: 'outgoing' | 'incoming' | 'both' = 'outgoing';
  let label: string | undefined;
  let maxDepth = 3;
  let resultLimit = 1000;

  const builder: GraphTraversalBuilder = {
    outgoing(l?: string) {
      direction = 'outgoing';
      label = l;
      return builder;
    },
    incoming(l?: string) {
      direction = 'incoming';
      label = l;
      return builder;
    },
    both(l?: string) {
      direction = 'both';
      label = l;
      return builder;
    },
    depth(d: number) {
      maxDepth = d;
      return builder;
    },
    limit(n: number) {
      resultLimit = n;
      return builder;
    },
    results() {
      return engine.traverse(collection, documentId, {
        direction,
        label,
        maxDepth,
        limit: resultLimit,
      });
    },
    nodeIds() {
      return this.results().nodes.map((n) => n.documentId);
    },
    edges() {
      return this.results().edges;
    },
  };

  return builder;
}

export function createCollectionGraph(
  collectionName: string,
  engine?: GraphEngine
): CollectionGraph {
  return new CollectionGraph(collectionName, engine);
}

/**
 * Merkle DAG for @pocket/sync-blockchain.
 *
 * Builds and manages a directed acyclic graph of document versions
 * where each node is content-addressed and linked to its parents.
 * Enables data integrity verification, conflict detection, and
 * proof of inclusion.
 *
 * ## Structure
 *
 * ```
 *     [genesis] ← [v1] ← [v2] ← [v3 (head)]
 *                    ↖
 *                     [v2b] ← [v3b (head)]   ← fork/conflict
 * ```
 *
 * @example
 * ```typescript
 * const dag = createMerkleDAG(contentStore);
 * const cid = await dag.addNode(data, [parentCid]);
 * const conflicts = dag.detectConflicts('docId');
 * ```
 *
 * @module @pocket/sync-blockchain/merkle-dag
 */

import type { ContentStore } from './content-store.js';
import type { DAGConflict, InclusionProof, MerkleDAGNode } from './types.js';

/** Internal node metadata tracked by the DAG. */
interface DAGNodeMeta {
  readonly node: MerkleDAGNode;
  /** CIDs of child nodes (nodes that reference this as a parent). */
  readonly children: string[];
  /** Document ID this node belongs to. */
  readonly documentId: string;
}

/**
 * Merkle DAG manager.
 *
 * Maintains a DAG of content-addressed nodes, supporting conflict
 * detection, ancestry traversal, and integrity proofs.
 *
 * @example
 * ```typescript
 * const dag = createMerkleDAG(contentStore);
 *
 * // Add genesis node
 * const genesis = await dag.addNode(data, [], 'doc1', 'did:pocket:alice');
 *
 * // Add child node
 * const v2 = await dag.addNode(newData, [genesis], 'doc1', 'did:pocket:alice');
 *
 * // Detect conflicts (forks)
 * const conflicts = dag.detectConflicts('doc1');
 * ```
 */
export class MerkleDAG {
  private readonly nodes = new Map<string, DAGNodeMeta>();
  private readonly documentHeads = new Map<string, Set<string>>();

  constructor(private readonly store: ContentStore) {}

  /**
   * Add a new node to the DAG.
   *
   * @param data - Raw data for the node.
   * @param parents - CID hashes of parent nodes.
   * @param documentId - The document this version belongs to.
   * @param author - DID of the author.
   * @returns The CID hash of the new node.
   */
  async addNode(
    data: Uint8Array,
    parents: string[],
    documentId: string,
    author: string,
  ): Promise<string> {
    // Verify all parents exist
    for (const parentHash of parents) {
      if (!this.nodes.has(parentHash)) {
        throw new Error(`Parent node not found: ${parentHash}`);
      }
    }

    // Store content and get CID
    const cid = await this.store.put(data);

    const node: MerkleDAGNode = {
      cid,
      parents: [...parents],
      timestamp: Date.now(),
      author,
      data,
      size: data.byteLength,
    };

    const meta: DAGNodeMeta = {
      node,
      children: [],
      documentId,
    };

    this.nodes.set(cid.hash, meta);

    // Update parent → child links
    for (const parentHash of parents) {
      const parentMeta = this.nodes.get(parentHash);
      if (parentMeta) {
        this.nodes.set(parentHash, {
          ...parentMeta,
          children: [...parentMeta.children, cid.hash],
        });
      }
    }

    // Update document heads
    this.updateHeads(documentId, cid.hash, parents);

    return cid.hash;
  }

  /**
   * Get a node by its CID hash.
   */
  getNode(hash: string): MerkleDAGNode | null {
    const meta = this.nodes.get(hash);
    return meta?.node ?? null;
  }

  /**
   * Check if a node exists in the DAG.
   */
  hasNode(hash: string): boolean {
    return this.nodes.has(hash);
  }

  /**
   * Get the current head CIDs for a document.
   * Multiple heads indicate a conflict (fork).
   */
  getHeads(documentId: string): string[] {
    const heads = this.documentHeads.get(documentId);
    return heads ? Array.from(heads) : [];
  }

  /**
   * Detect conflicts (forks) for a document.
   * A conflict exists when there are multiple heads.
   */
  detectConflicts(documentId: string): DAGConflict | null {
    const heads = this.getHeads(documentId);
    if (heads.length <= 1) {
      return null;
    }

    const commonAncestor = this.findCommonAncestor(heads[0]!, heads[1]!);

    return {
      heads,
      commonAncestor,
      resolvable: commonAncestor !== null,
    };
  }

  /**
   * Resolve a conflict by creating a merge node that has all heads as parents.
   */
  async resolveConflict(
    documentId: string,
    mergedData: Uint8Array,
    author: string,
  ): Promise<string | null> {
    const heads = this.getHeads(documentId);
    if (heads.length <= 1) {
      return null;
    }

    return this.addNode(mergedData, heads, documentId, author);
  }

  /**
   * Find the common ancestor of two nodes.
   * Returns `null` if no common ancestor exists.
   */
  findCommonAncestor(hashA: string, hashB: string): string | null {
    const ancestorsA = this.getAncestors(hashA);
    const ancestorsB = new Set(this.getAncestors(hashB));

    // Also check if one is an ancestor of the other
    if (ancestorsB.has(hashA)) return hashA;
    if (ancestorsA.includes(hashB)) return hashB;

    for (const ancestor of ancestorsA) {
      if (ancestorsB.has(ancestor)) {
        return ancestor;
      }
    }
    return null;
  }

  /**
   * Get all ancestors of a node (ordered from nearest to farthest).
   */
  getAncestors(hash: string): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [];

    const meta = this.nodes.get(hash);
    if (!meta) return ancestors;

    for (const parent of meta.node.parents) {
      queue.push(parent);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      ancestors.push(current);

      const currentMeta = this.nodes.get(current);
      if (currentMeta) {
        for (const parent of currentMeta.node.parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      }
    }

    return ancestors;
  }

  /**
   * Get all descendants of a node.
   */
  getDescendants(hash: string): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [];

    const meta = this.nodes.get(hash);
    if (!meta) return descendants;

    for (const child of meta.children) {
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      descendants.push(current);

      const currentMeta = this.nodes.get(current);
      if (currentMeta) {
        for (const child of currentMeta.children) {
          if (!visited.has(child)) {
            queue.push(child);
          }
        }
      }
    }

    return descendants;
  }

  /**
   * Verify data integrity of a node by checking its content hash.
   */
  async verifyIntegrity(hash: string): Promise<boolean> {
    const meta = this.nodes.get(hash);
    if (!meta) return false;

    return this.store.validateCID(meta.node.cid, meta.node.data);
  }

  /**
   * Verify the entire hash chain from a node back to genesis.
   */
  async verifyChain(hash: string): Promise<boolean> {
    const visited = new Set<string>();
    const queue = [hash];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const isValid = await this.verifyIntegrity(current);
      if (!isValid) return false;

      const meta = this.nodes.get(current);
      if (meta) {
        for (const parent of meta.node.parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      }
    }

    return true;
  }

  /**
   * Generate a proof that a CID is included in the DAG under a given root.
   */
  generateInclusionProof(targetHash: string, rootHash: string): InclusionProof | null {
    const path = this.findPath(targetHash, rootHash);
    if (!path) return null;

    return {
      targetCid: targetHash,
      rootCid: rootHash,
      path,
      timestamp: Date.now(),
    };
  }

  /**
   * Verify an inclusion proof.
   */
  verifyInclusionProof(proof: InclusionProof): boolean {
    // Verify path connects target to root
    if (proof.path.length === 0) return false;
    if (proof.path[0] !== proof.targetCid) return false;
    if (proof.path[proof.path.length - 1] !== proof.rootCid) return false;

    // Verify each step in the path is connected
    for (let i = 0; i < proof.path.length - 1; i++) {
      const current = proof.path[i]!;
      const next = proof.path[i + 1]!;
      const meta = this.nodes.get(current);
      if (!meta) return false;

      const isChild = meta.children.includes(next);
      const isParent = meta.node.parents.includes(next);
      if (!isChild && !isParent) return false;
    }

    return true;
  }

  /**
   * Get all document IDs tracked by the DAG.
   */
  getDocumentIds(): string[] {
    return Array.from(this.documentHeads.keys());
  }

  /**
   * Get the total number of nodes in the DAG.
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Find a path between two nodes in the DAG.
   * Returns the path as an array of CID hashes, or null if no path exists.
   */
  private findPath(fromHash: string, toHash: string): string[] | null {
    if (fromHash === toHash) return [fromHash];

    const visited = new Set<string>();
    const queue: { hash: string; path: string[] }[] = [
      { hash: fromHash, path: [fromHash] },
    ];

    while (queue.length > 0) {
      const { hash: current, path } = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const meta = this.nodes.get(current);
      if (!meta) continue;

      // Traverse both parents and children
      const neighbors = [...meta.node.parents, ...meta.children];
      for (const neighbor of neighbors) {
        if (neighbor === toHash) {
          return [...path, neighbor];
        }
        if (!visited.has(neighbor)) {
          queue.push({ hash: neighbor, path: [...path, neighbor] });
        }
      }
    }

    return null;
  }

  /**
   * Update the head set for a document after adding a new node.
   */
  private updateHeads(documentId: string, newHash: string, parents: string[]): void {
    let heads = this.documentHeads.get(documentId);
    if (!heads) {
      heads = new Set<string>();
      this.documentHeads.set(documentId, heads);
    }

    // Remove parents from heads (they are no longer tips)
    for (const parent of parents) {
      heads.delete(parent);
    }

    // Add new node as a head
    heads.add(newHash);
  }
}

/**
 * Create a new MerkleDAG instance.
 *
 * @example
 * ```typescript
 * const store = createContentStore();
 * const dag = createMerkleDAG(store);
 * ```
 */
export function createMerkleDAG(store: ContentStore): MerkleDAG {
  return new MerkleDAG(store);
}

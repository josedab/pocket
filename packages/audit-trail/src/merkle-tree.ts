/**
 * Merkle tree implementation for tamper-evident audit trail
 */

import type { MerkleNode, MerkleProof, ProofStep } from './types.js';
import { hashPair } from './hash.js';

/**
 * A Merkle tree that supports incremental leaf addition and proof generation.
 */
export class MerkleTree {
  private leaves: string[] = [];
  private root: MerkleNode | null = null;

  constructor(leaves?: string[]) {
    if (leaves && leaves.length > 0) {
      this.leaves = [...leaves];
      this.rebuild();
    }
  }

  /**
   * Add a new leaf hash to the tree and rebuild.
   */
  addLeaf(hash: string): void {
    this.leaves.push(hash);
    this.rebuild();
  }

  /**
   * Get the Merkle root hash. Returns empty string for empty tree.
   */
  getRoot(): string {
    return this.root?.hash ?? '';
  }

  /**
   * Generate an inclusion proof for the leaf at the given index.
   */
  generateProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.leaves.length})`);
    }

    const leaf = this.leaves[leafIndex]!;
    const path: ProofStep[] = [];

    // Build levels bottom-up to record sibling info
    let currentLevel: string[] = [...this.leaves];
    let index = leafIndex;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        const right = currentLevel[i + 1] ?? left;

        if (i === index || i + 1 === index) {
          if (i === index) {
            // Current node is on the left; sibling is on the right
            path.push({ hash: right, direction: 'right' });
          } else {
            // Current node is on the right; sibling is on the left
            path.push({ hash: left, direction: 'left' });
          }
        }

        nextLevel.push(hashPair(left, right));
      }

      index = Math.floor(index / 2);
      currentLevel = nextLevel;
    }

    return {
      leaf,
      path,
      root: this.getRoot(),
    };
  }

  /**
   * Verify that a Merkle proof is valid.
   */
  verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leaf;

    for (const step of proof.path) {
      if (step.direction === 'left') {
        currentHash = hashPair(step.hash, currentHash);
      } else {
        currentHash = hashPair(currentHash, step.hash);
      }
    }

    return currentHash === proof.root;
  }

  /**
   * Get the number of leaves in the tree.
   */
  getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Rebuild the tree from current leaves.
   */
  rebuild(): void {
    if (this.leaves.length === 0) {
      this.root = null;
      return;
    }

    let nodes: MerkleNode[] = this.leaves.map((hash) => ({
      hash,
      data: hash,
    }));

    while (nodes.length > 1) {
      const nextLevel: MerkleNode[] = [];

      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i]!;
        const right = nodes[i + 1] ?? left;

        nextLevel.push({
          hash: hashPair(left.hash, right.hash),
          left,
          right,
        });
      }

      nodes = nextLevel;
    }

    this.root = nodes[0]!;
  }
}

/**
 * Factory function to create a MerkleTree.
 */
export function createMerkleTree(leaves?: string[]): MerkleTree {
  return new MerkleTree(leaves);
}

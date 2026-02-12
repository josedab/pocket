import { describe, it, expect } from 'vitest';
import { MerkleTree, createMerkleTree } from '../merkle-tree.js';
import { computeHash } from '../hash.js';

describe('MerkleTree', () => {
  it('should build a tree from leaves', () => {
    const leaves = ['aaa', 'bbb', 'ccc', 'ddd'];
    const tree = createMerkleTree(leaves);

    expect(tree.getRoot()).toBeTruthy();
    expect(tree.getLeafCount()).toBe(4);
  });

  it('should generate and verify a valid proof', () => {
    const leaves = ['aaa', 'bbb', 'ccc', 'ddd'];
    const tree = createMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.generateProof(i);
      expect(proof.leaf).toBe(leaves[i]);
      expect(proof.root).toBe(tree.getRoot());
      expect(tree.verifyProof(proof)).toBe(true);
    }
  });

  it('should reject an invalid proof (tampered hash)', () => {
    const leaves = ['aaa', 'bbb', 'ccc', 'ddd'];
    const tree = createMerkleTree(leaves);
    const proof = tree.generateProof(1);

    // Tamper with the leaf
    const tampered = { ...proof, leaf: 'tampered' };
    expect(tree.verifyProof(tampered)).toBe(false);
  });

  it('should add a leaf incrementally', () => {
    const tree = createMerkleTree(['aaa', 'bbb']);
    const rootBefore = tree.getRoot();

    tree.addLeaf('ccc');
    expect(tree.getLeafCount()).toBe(3);
    expect(tree.getRoot()).not.toBe(rootBefore);

    // Proof should still verify for all leaves
    for (let i = 0; i < 3; i++) {
      const proof = tree.generateProof(i);
      expect(tree.verifyProof(proof)).toBe(true);
    }
  });

  it('should handle a single leaf tree', () => {
    const tree = createMerkleTree(['only-leaf']);

    expect(tree.getRoot()).toBe('only-leaf');
    expect(tree.getLeafCount()).toBe(1);

    const proof = tree.generateProof(0);
    expect(proof.leaf).toBe('only-leaf');
    expect(tree.verifyProof(proof)).toBe(true);
  });

  it('should handle an empty tree', () => {
    const tree = createMerkleTree();

    expect(tree.getRoot()).toBe('');
    expect(tree.getLeafCount()).toBe(0);
  });

  it('should throw for out-of-range leaf index', () => {
    const tree = createMerkleTree(['aaa']);

    expect(() => tree.generateProof(-1)).toThrow();
    expect(() => tree.generateProof(1)).toThrow();
  });

  it('should produce consistent roots for same input', () => {
    const leaves = ['x', 'y', 'z'];
    const tree1 = createMerkleTree(leaves);
    const tree2 = createMerkleTree(leaves);

    expect(tree1.getRoot()).toBe(tree2.getRoot());
  });
});

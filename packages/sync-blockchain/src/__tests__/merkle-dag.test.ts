import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ContentStore, createContentStore } from '../content-store.js';
import { MerkleDAG, createMerkleDAG } from '../merkle-dag.js';

describe('MerkleDAG', () => {
  let store: ContentStore;
  let dag: MerkleDAG;
  const encoder = new TextEncoder();

  beforeEach(() => {
    store = createContentStore({
      pinning: { autoPinNew: false },
      storage: { enableAutoGc: false },
    });
    dag = createMerkleDAG(store);
  });

  afterEach(() => {
    store.destroy();
  });

  describe('createMerkleDAG factory', () => {
    it('creates a MerkleDAG instance', () => {
      expect(dag).toBeInstanceOf(MerkleDAG);
    });
  });

  describe('addNode', () => {
    it('creates a genesis node with no parents', async () => {
      const hash = await dag.addNode(encoder.encode('genesis'), [], 'doc1', 'did:pocket:alice');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('creates a node with parents', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const child = await dag.addNode(encoder.encode('v2'), [genesis], 'doc1', 'did:pocket:alice');
      expect(child).toMatch(/^[0-9a-f]{64}$/);
      expect(child).not.toBe(genesis);
    });

    it('throws for nonexistent parent', async () => {
      await expect(
        dag.addNode(encoder.encode('data'), ['nonexistent'], 'doc1', 'did:pocket:alice'),
      ).rejects.toThrow('Parent node not found');
    });
  });

  describe('getNode', () => {
    it('retrieves a stored node', async () => {
      const hash = await dag.addNode(encoder.encode('data'), [], 'doc1', 'did:pocket:alice');
      const node = dag.getNode(hash);
      expect(node).not.toBeNull();
      expect(node!.cid.hash).toBe(hash);
      expect(node!.author).toBe('did:pocket:alice');
    });

    it('returns null for missing node', () => {
      expect(dag.getNode('nonexistent')).toBeNull();
    });
  });

  describe('hasNode', () => {
    it('returns true for existing node', async () => {
      const hash = await dag.addNode(encoder.encode('data'), [], 'doc1', 'did:pocket:alice');
      expect(dag.hasNode(hash)).toBe(true);
    });

    it('returns false for nonexistent node', () => {
      expect(dag.hasNode('nonexistent')).toBe(false);
    });
  });

  describe('getHeads', () => {
    it('returns current head nodes', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const v2 = await dag.addNode(encoder.encode('v2'), [genesis], 'doc1', 'did:pocket:alice');
      const heads = dag.getHeads('doc1');
      expect(heads).toEqual([v2]);
    });

    it('returns empty array for unknown document', () => {
      expect(dag.getHeads('unknown')).toEqual([]);
    });
  });

  describe('detectConflicts', () => {
    it('returns null when no conflict', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2'), [genesis], 'doc1', 'did:pocket:alice');
      expect(dag.detectConflicts('doc1')).toBeNull();
    });

    it('finds forked heads', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2a'), [genesis], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2b'), [genesis], 'doc1', 'did:pocket:bob');

      const conflict = dag.detectConflicts('doc1');
      expect(conflict).not.toBeNull();
      expect(conflict!.heads).toHaveLength(2);
      expect(conflict!.commonAncestor).toBe(genesis);
      expect(conflict!.resolvable).toBe(true);
    });
  });

  describe('resolveConflict', () => {
    it('merges conflicting heads', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2a'), [genesis], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2b'), [genesis], 'doc1', 'did:pocket:bob');

      const mergeHash = await dag.resolveConflict('doc1', encoder.encode('merged'), 'did:pocket:alice');
      expect(mergeHash).not.toBeNull();

      const heads = dag.getHeads('doc1');
      expect(heads).toHaveLength(1);
      expect(heads[0]).toBe(mergeHash);
    });

    it('returns null when no conflict', async () => {
      await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const result = await dag.resolveConflict('doc1', encoder.encode('merged'), 'did:pocket:alice');
      expect(result).toBeNull();
    });
  });

  describe('findCommonAncestor', () => {
    it('finds shared ancestor', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const a = await dag.addNode(encoder.encode('v2a'), [genesis], 'doc1', 'did:pocket:alice');
      const b = await dag.addNode(encoder.encode('v2b'), [genesis], 'doc1', 'did:pocket:bob');

      const ancestor = dag.findCommonAncestor(a, b);
      expect(ancestor).toBe(genesis);
    });

    it('returns null when no common ancestor exists', async () => {
      const a = await dag.addNode(encoder.encode('a'), [], 'doc1', 'did:pocket:alice');
      const b = await dag.addNode(encoder.encode('b'), [], 'doc2', 'did:pocket:bob');
      expect(dag.findCommonAncestor(a, b)).toBeNull();
    });
  });

  describe('getAncestors', () => {
    it('traverses up from node', async () => {
      const v1 = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const v2 = await dag.addNode(encoder.encode('v2'), [v1], 'doc1', 'did:pocket:alice');
      const v3 = await dag.addNode(encoder.encode('v3'), [v2], 'doc1', 'did:pocket:alice');

      const ancestors = dag.getAncestors(v3);
      expect(ancestors).toContain(v2);
      expect(ancestors).toContain(v1);
      expect(ancestors).not.toContain(v3);
    });

    it('returns empty array for genesis', async () => {
      const genesis = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      expect(dag.getAncestors(genesis)).toEqual([]);
    });
  });

  describe('getDescendants', () => {
    it('traverses down from node', async () => {
      const v1 = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const v2 = await dag.addNode(encoder.encode('v2'), [v1], 'doc1', 'did:pocket:alice');
      const v3 = await dag.addNode(encoder.encode('v3'), [v2], 'doc1', 'did:pocket:alice');

      const descendants = dag.getDescendants(v1);
      expect(descendants).toContain(v2);
      expect(descendants).toContain(v3);
      expect(descendants).not.toContain(v1);
    });

    it('returns empty array for leaf', async () => {
      const leaf = await dag.addNode(encoder.encode('leaf'), [], 'doc1', 'did:pocket:alice');
      expect(dag.getDescendants(leaf)).toEqual([]);
    });
  });

  describe('verifyIntegrity', () => {
    it('validates node hash', async () => {
      const hash = await dag.addNode(encoder.encode('data'), [], 'doc1', 'did:pocket:alice');
      const valid = await dag.verifyIntegrity(hash);
      expect(valid).toBe(true);
    });

    it('returns false for nonexistent node', async () => {
      const valid = await dag.verifyIntegrity('nonexistent');
      expect(valid).toBe(false);
    });
  });

  describe('verifyChain', () => {
    it('validates entire chain', async () => {
      const v1 = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const v2 = await dag.addNode(encoder.encode('v2'), [v1], 'doc1', 'did:pocket:alice');
      const v3 = await dag.addNode(encoder.encode('v3'), [v2], 'doc1', 'did:pocket:alice');

      const valid = await dag.verifyChain(v3);
      expect(valid).toBe(true);
    });
  });

  describe('generateInclusionProof', () => {
    it('creates proof for included node', async () => {
      const v1 = await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      const v2 = await dag.addNode(encoder.encode('v2'), [v1], 'doc1', 'did:pocket:alice');

      const proof = dag.generateInclusionProof(v1, v2);
      expect(proof).not.toBeNull();
      expect(proof!.targetCid).toBe(v1);
      expect(proof!.rootCid).toBe(v2);
      expect(proof!.path.length).toBeGreaterThanOrEqual(2);
    });

    it('returns null for unrelated nodes', async () => {
      const a = await dag.addNode(encoder.encode('a'), [], 'doc1', 'did:pocket:alice');
      const b = await dag.addNode(encoder.encode('b'), [], 'doc2', 'did:pocket:bob');
      expect(dag.generateInclusionProof(a, b)).toBeNull();
    });
  });

  describe('getNodeCount / getDocumentIds', () => {
    it('tracks node count', async () => {
      expect(dag.getNodeCount()).toBe(0);
      await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      expect(dag.getNodeCount()).toBe(1);
    });

    it('tracks document IDs', async () => {
      await dag.addNode(encoder.encode('v1'), [], 'doc1', 'did:pocket:alice');
      await dag.addNode(encoder.encode('v2'), [], 'doc2', 'did:pocket:bob');
      expect(dag.getDocumentIds()).toContain('doc1');
      expect(dag.getDocumentIds()).toContain('doc2');
    });
  });
});

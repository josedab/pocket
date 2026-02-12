import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry, createNodeRegistry } from '../node-registry.js';
import type { NodeInfo } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: overrides.id ?? 'node-1',
    status: overrides.status ?? 'active',
    lastSeen: overrides.lastSeen ?? Date.now(),
    capabilities: overrides.capabilities ?? [],
    dataRanges: overrides.dataRanges,
    address: overrides.address,
  };
}

/* ================================================================== */
/*  NodeRegistry                                                       */
/* ================================================================== */

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = createNodeRegistry();
  });

  it('should register and retrieve a node', () => {
    const node = makeNode({ id: 'n1' });
    registry.register(node);

    const retrieved = registry.getNode('n1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('n1');
  });

  it('should deregister a node', () => {
    registry.register(makeNode({ id: 'n1' }));
    expect(registry.deregister('n1')).toBe(true);
    expect(registry.getNode('n1')).toBeUndefined();
  });

  it('should return false when deregistering unknown node', () => {
    expect(registry.deregister('unknown')).toBe(false);
  });

  it('should get only active nodes', () => {
    registry.register(makeNode({ id: 'n1', status: 'active' }));
    registry.register(makeNode({ id: 'n2', status: 'inactive' }));
    registry.register(makeNode({ id: 'n3', status: 'active' }));

    const active = registry.getActiveNodes();
    expect(active).toHaveLength(2);
    expect(active.map((n) => n.id)).toEqual(expect.arrayContaining(['n1', 'n3']));
  });

  it('should update lastSeen on heartbeat', () => {
    const before = Date.now() - 10_000;
    registry.register(makeNode({ id: 'n1', lastSeen: before }));

    registry.heartbeat('n1');

    const node = registry.getNode('n1');
    expect(node!.lastSeen).toBeGreaterThan(before);
    expect(node!.status).toBe('active');
  });

  it('should return false for heartbeat on unknown node', () => {
    expect(registry.heartbeat('unknown')).toBe(false);
  });

  it('should prune inactive nodes beyond TTL', () => {
    const old = Date.now() - 60_000;
    const recent = Date.now();

    registry.register(makeNode({ id: 'old-node', lastSeen: old }));
    registry.register(makeNode({ id: 'fresh-node', lastSeen: recent }));

    const pruned = registry.pruneInactive(30_000);
    expect(pruned).toEqual(['old-node']);
    expect(registry.getNodeCount()).toBe(1);
    expect(registry.getNode('fresh-node')).toBeDefined();
  });

  it('should get nodes for a specific collection', () => {
    registry.register(
      makeNode({
        id: 'n1',
        dataRanges: [{ collection: 'orders' }],
      })
    );
    registry.register(
      makeNode({
        id: 'n2',
        dataRanges: [{ collection: 'users' }],
      })
    );
    registry.register(makeNode({ id: 'n3' })); // no data ranges — matches all

    const nodes = registry.getNodesForCollection('orders');
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['n1', 'n3']));
  });

  it('should update node status', () => {
    registry.register(makeNode({ id: 'n1', status: 'active' }));
    expect(registry.updateStatus('n1', 'unreachable')).toBe(true);
    expect(registry.getNode('n1')!.status).toBe('unreachable');
  });

  it('should return correct node count', () => {
    expect(registry.getNodeCount()).toBe(0);
    registry.register(makeNode({ id: 'n1' }));
    registry.register(makeNode({ id: 'n2' }));
    expect(registry.getNodeCount()).toBe(2);
  });
});

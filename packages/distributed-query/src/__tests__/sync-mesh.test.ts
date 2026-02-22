import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncMesh, createSyncMesh } from '../sync-mesh.js';

describe('SyncMesh', () => {
  let mesh: SyncMesh;

  beforeEach(() => {
    mesh = createSyncMesh({
      peerId: 'node-1',
      collections: ['todos', 'notes'],
      fanout: 2,
      maxPeers: 10,
    });
  });

  afterEach(async () => {
    await mesh.stop();
  });

  it('should create with stopped status', () => {
    expect(mesh.getStatus()).toBe('stopped');
  });

  it('should start and transition to running', async () => {
    await mesh.start();
    expect(mesh.getStatus()).toBe('running');
  });

  it('should not start twice', async () => {
    await mesh.start();
    await mesh.start();
    expect(mesh.getStatus()).toBe('running');
  });

  it('should stop and transition to stopped', async () => {
    await mesh.start();
    await mesh.stop();
    expect(mesh.getStatus()).toBe('stopped');
  });

  it('should not stop when already stopped', async () => {
    await mesh.stop();
    expect(mesh.getStatus()).toBe('stopped');
  });

  it('should add and connect a peer', async () => {
    await mesh.start();
    const connected = await mesh.addPeer('node-2', 'ws://localhost:8080');
    expect(connected).toBe(true);
    expect(mesh.getConnectedPeers()).toContain('node-2');
  });

  it('should fail to add peer when not started', async () => {
    const connected = await mesh.addPeer('node-2');
    expect(connected).toBe(false);
  });

  it('should remove a peer', async () => {
    await mesh.start();
    await mesh.addPeer('node-2');
    mesh.removePeer('node-2');
    expect(mesh.getConnectedPeers()).not.toContain('node-2');
  });

  it('should propagate changes to connected peers', async () => {
    await mesh.start();
    await mesh.addPeer('node-2');

    mesh.propagateChange('todos', 'todo-1', { title: 'Test' }, 'create');

    const stats = mesh.getStats();
    expect(stats.changesPropagated).toBe(1);
  });

  it('should ignore propagation for unlisted collections', async () => {
    await mesh.start();
    await mesh.addPeer('node-2');

    mesh.propagateChange('unknown-collection', 'doc-1', {}, 'create');

    const stats = mesh.getStats();
    expect(stats.changesPropagated).toBe(0);
  });

  it('should track topology changes', async () => {
    await mesh.start();
    const topo = mesh.getTopology();
    expect(topo.localPeerId).toBe('node-1');
    expect(topo.peerCount).toBe(0);

    await mesh.addPeer('node-2');
    const updated = mesh.getTopology();
    expect(updated.peerCount).toBeGreaterThanOrEqual(1);
  });

  it('should emit topology via observable', async () => {
    const topologies: Array<{ peerCount: number }> = [];
    mesh.topology$.subscribe((t) => topologies.push({ peerCount: t.peerCount }));

    await mesh.start();
    await mesh.addPeer('node-2');

    expect(topologies.length).toBeGreaterThan(0);
  });

  it('should return initial stats', async () => {
    await mesh.start();
    const stats = mesh.getStats();
    expect(stats.changesPropagated).toBe(0);
    expect(stats.changesReceived).toBe(0);
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit status changes', async () => {
    const statuses: string[] = [];
    mesh.status$.subscribe((s) => statuses.push(s));

    await mesh.start();
    await mesh.stop();

    expect(statuses).toContain('stopped');
    expect(statuses).toContain('starting');
    expect(statuses).toContain('running');
    expect(statuses).toContain('stopping');
  });
});

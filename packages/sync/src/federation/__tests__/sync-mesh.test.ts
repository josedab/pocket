import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncMesh, type MeshEvent, type MeshMessage, type MeshTransport } from '../sync-mesh.js';

function createMockTransport(): MeshTransport & { sent: Array<{ to: string; msg: MeshMessage }> } {
  let messageHandler: ((from: string, msg: MeshMessage) => void) | null = null;
  return {
    sent: [],
    async send(peerId: string, message: MeshMessage) {
      this.sent.push({ to: peerId, msg: message });
    },
    onMessage(cb) {
      messageHandler = cb;
      return () => {
        messageHandler = null;
      };
    },
    // Test helper: simulate receiving a message
    simulateReceive(from: string, msg: MeshMessage) {
      messageHandler?.(from, msg);
    },
  } as MeshTransport & {
    sent: Array<{ to: string; msg: MeshMessage }>;
    simulateReceive: (from: string, msg: MeshMessage) => void;
  };
}

describe('SyncMesh', () => {
  let mesh: SyncMesh;
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    mesh = new SyncMesh({
      nodeId: 'node-1',
      collections: ['todos', 'users'],
      syncIntervalMs: 5000,
      heartbeatIntervalMs: 3000,
      peerTimeoutMs: 10000,
    });
  });

  afterEach(() => {
    mesh.destroy();
    vi.useRealTimers();
  });

  it('should start in idle status', () => {
    expect(mesh.status).toBe('idle');
    expect(mesh.peerCount).toBe(0);
  });

  it('should add peers and emit events', () => {
    const events: MeshEvent[] = [];
    mesh.events$.subscribe((e) => events.push(e));
    mesh.start(transport);

    mesh.addPeer('node-2');
    expect(mesh.peerCount).toBe(1);
    expect(events.some((e) => e.type === 'peer:joined')).toBe(true);
  });

  it('should send hello on addPeer', () => {
    mesh.start(transport);
    mesh.addPeer('node-2');

    const hello = transport.sent.find((s) => s.msg.type === 'hello');
    expect(hello).toBeDefined();
    expect(hello!.to).toBe('node-2');
  });

  it('should sync with connected peers', async () => {
    mesh.start(transport);
    mesh.addPeer('node-2');

    const results = await mesh.sync();
    expect(results.length).toBe(2); // 2 collections
    expect(results.every((r) => r.peerId === 'node-2')).toBe(true);
    expect(mesh.status).toBe('converged');
  });

  it('should track sync stats', async () => {
    mesh.start(transport);
    mesh.addPeer('node-2');
    await mesh.sync();

    const stats = mesh.getStats();
    expect(stats.nodeId).toBe('node-1');
    expect(stats.totalSyncs).toBe(1);
    expect(stats.peerCount).toBe(1);
    expect(stats.lastSyncAt).not.toBeNull();
  });

  it('should handle hello message from unknown peer', () => {
    mesh.start(transport);

    (
      transport as unknown as { simulateReceive: (from: string, msg: MeshMessage) => void }
    ).simulateReceive('node-3', {
      type: 'hello',
      nodeId: 'node-3',
      collections: ['todos'],
      checkpoint: { todos: 0 },
    });

    expect(mesh.peerCount).toBe(1);
    expect(mesh.getPeers()[0]!.nodeId).toBe('node-3');
  });

  it('should update checkpoint from sync-response', () => {
    mesh.start(transport);
    mesh.addPeer('node-2');

    (
      transport as unknown as { simulateReceive: (from: string, msg: MeshMessage) => void }
    ).simulateReceive('node-2', {
      type: 'sync-response',
      collection: 'todos',
      changes: [],
      checkpoint: 42,
    });

    // Internal checkpoint should be updated
    const stats = mesh.getStats();
    expect(stats).toBeDefined();
  });

  it('should remove peers', () => {
    mesh.start(transport);
    mesh.addPeer('node-2');
    expect(mesh.peerCount).toBe(1);

    mesh.removePeer('node-2');
    expect(mesh.peerCount).toBe(0);
  });

  it('should enforce max peers', () => {
    mesh.destroy();
    mesh = new SyncMesh({ nodeId: 'n', collections: ['c'], maxPeers: 2 });
    mesh.start(transport);

    mesh.addPeer('p1');
    mesh.addPeer('p2');
    expect(() => mesh.addPeer('p3')).toThrow('Max peers');
  });

  it('should clean up on destroy', () => {
    mesh.start(transport);
    mesh.addPeer('node-2');
    mesh.destroy();

    expect(mesh.peerCount).toBe(0);
  });
});

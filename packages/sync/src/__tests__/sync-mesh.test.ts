import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebRTCTransport, createWebRTCTransport } from '../transport/webrtc.js';
import { LANDiscovery, createLANDiscovery } from '../transport/lan-discovery.js';
import { MeshCoordinator, createMeshCoordinator } from '../transport/mesh-coordinator.js';
import type { SyncProtocolMessage, PushResponseMessage } from '../transport/types.js';

// ── WebRTC Transport ────────────────────────────────────────────────

describe('WebRTCTransport', () => {
  let transport: WebRTCTransport;

  beforeEach(() => {
    transport = createWebRTCTransport({
      channelLabel: 'test-channel',
      connectionTimeout: 500,
    });
  });

  afterEach(async () => {
    if (transport.isConnected()) {
      await transport.disconnect();
    }
  });

  it('should create with a unique peer ID', () => {
    expect(transport.peerId).toMatch(/^peer-/);
    const other = createWebRTCTransport();
    expect(transport.peerId).not.toBe(other.peerId);
  });

  it('should connect and disconnect', async () => {
    expect(transport.isConnected()).toBe(false);
    expect(transport.state).toBe('new');

    await transport.connect();
    expect(transport.isConnected()).toBe(true);
    expect(transport.state).toBe('connected');

    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
    expect(transport.state).toBe('closed');
  });

  it('should throw when sending while disconnected', async () => {
    const msg: SyncProtocolMessage = {
      type: 'push',
      id: 'test-1',
      timestamp: Date.now(),
      collection: 'todos',
      changes: [],
      checkpoint: { id: 'cp1', serverSequence: 0, clientSequence: 0, timestamp: Date.now(), collections: {} },
    } as never;

    await expect(transport.send(msg)).rejects.toThrow('not connected');
  });

  it('should send and receive response', async () => {
    await transport.connect();

    const sendPromise = transport.send<PushResponseMessage>({
      type: 'push',
      id: 'msg-1',
      timestamp: Date.now(),
      collection: 'todos',
      changes: [],
      checkpoint: { id: 'cp1', serverSequence: 0, clientSequence: 0, timestamp: Date.now(), collections: {} },
    } as never);

    // Simulate remote peer responding
    transport.receiveMessage({
      type: 'push-response',
      id: 'msg-1',
      timestamp: Date.now(),
      success: true,
      checkpoint: { id: 'cp1', serverSequence: 1, clientSequence: 0, timestamp: Date.now(), collections: {} },
    } as never);

    const response = await sendPromise;
    expect(response.type).toBe('push-response');
  });

  it('should handle incoming messages', async () => {
    await transport.connect();

    const messages: SyncProtocolMessage[] = [];
    transport.onMessage((msg) => messages.push(msg));

    transport.receiveMessage({
      type: 'pull',
      id: 'incoming-1',
      timestamp: Date.now(),
      collections: ['todos'],
      checkpoint: { id: 'cp1', serverSequence: 0, clientSequence: 0, timestamp: Date.now(), collections: {} },
    } as never);

    expect(messages.length).toBe(1);
    expect(messages[0]!.type).toBe('pull');
  });

  it('should handle signaling messages', async () => {
    const signals: unknown[] = [];
    transport.onLocalSignal((signal) => signals.push(signal));

    transport.handleRemoteSignal({
      type: 'offer',
      sdp: 'mock-offer',
      peerId: 'remote-peer',
    });

    expect(signals.length).toBe(1);
    expect((signals[0] as { type: string }).type).toBe('answer');
  });

  it('should call disconnect handler', async () => {
    await transport.connect();
    let disconnected = false;
    transport.onDisconnect(() => { disconnected = true; });
    await transport.disconnect();
    expect(disconnected).toBe(true);
  });

  it('should call error handler', async () => {
    let capturedError: Error | null = null;
    transport.onError((err) => { capturedError = err; });
    transport.triggerError(new Error('test error'));
    expect(capturedError!.message).toBe('test error');
  });
});

// ── LAN Discovery ───────────────────────────────────────────────────

describe('LANDiscovery', () => {
  let discovery: LANDiscovery;

  beforeEach(() => {
    discovery = createLANDiscovery({
      displayName: 'Test Device',
      port: 9999,
      peerTimeout: 100,
    });
  });

  afterEach(() => {
    discovery.stop();
  });

  it('should start and stop', () => {
    expect(discovery.running).toBe(false);
    discovery.start();
    expect(discovery.running).toBe(true);
    discovery.stop();
    expect(discovery.running).toBe(false);
  });

  it('should discover peers', () => {
    const found: string[] = [];
    discovery.onPeerFound((peer) => found.push(peer.peerId));

    discovery.announcePeer('peer-1', {
      displayName: 'Laptop',
      address: '192.168.1.10',
      port: 8765,
    });

    expect(found).toContain('peer-1');
    expect(discovery.getPeers().length).toBe(1);
  });

  it('should update existing peers', () => {
    const updated: string[] = [];
    discovery.onPeerUpdated((peer) => updated.push(peer.peerId));

    discovery.announcePeer('peer-1', {
      displayName: 'Laptop',
      address: '192.168.1.10',
      port: 8765,
    });

    discovery.announcePeer('peer-1', {
      displayName: 'Laptop (Updated)',
      address: '192.168.1.10',
      port: 8765,
    });

    expect(updated).toContain('peer-1');
    expect(discovery.getPeer('peer-1')!.displayName).toBe('Laptop (Updated)');
  });

  it('should remove peers', () => {
    const lost: string[] = [];
    discovery.onPeerLost((peer) => lost.push(peer.peerId));

    discovery.announcePeer('peer-1', {
      displayName: 'Laptop',
      address: '192.168.1.10',
      port: 8765,
    });

    expect(discovery.removePeer('peer-1')).toBe(true);
    expect(discovery.getPeers().length).toBe(0);
    expect(lost).toContain('peer-1');
  });

  it('should return false when removing unknown peer', () => {
    expect(discovery.removePeer('nonexistent')).toBe(false);
  });

  it('should store peer metadata', () => {
    discovery.announcePeer('peer-1', {
      displayName: 'Phone',
      address: '192.168.1.20',
      port: 8765,
      metadata: { device: 'iPhone', version: '1.0.0' },
    });

    const peer = discovery.getPeer('peer-1');
    expect(peer!.metadata!.device).toBe('iPhone');
  });

  it('should expose configuration', () => {
    const config = discovery.getConfig();
    expect(config.displayName).toBe('Test Device');
    expect(config.port).toBe(9999);
    expect(config.serviceType).toBe('_pocket-sync._tcp');
  });
});

// ── Mesh Coordinator ────────────────────────────────────────────────

describe('MeshCoordinator', () => {
  let mesh: MeshCoordinator;

  beforeEach(() => {
    mesh = createMeshCoordinator({
      topology: 'full-mesh',
      maxPeers: 4,
      collections: ['todos', 'notes'],
      syncInterval: 60000,
    });
  });

  afterEach(() => {
    mesh.stop();
  });

  it('should add and remove peers', () => {
    expect(mesh.addPeer({ peerId: 'p1' })).toBe(true);
    expect(mesh.addPeer({ peerId: 'p2' })).toBe(true);
    expect(mesh.getConnectedPeers().length).toBe(2);

    expect(mesh.removePeer('p1')).toBe(true);
    expect(mesh.getConnectedPeers().length).toBe(1);
  });

  it('should reject duplicate peers', () => {
    mesh.addPeer({ peerId: 'p1' });
    expect(mesh.addPeer({ peerId: 'p1' })).toBe(false);
  });

  it('should enforce max peer limit', () => {
    mesh.addPeer({ peerId: 'p1' });
    mesh.addPeer({ peerId: 'p2' });
    mesh.addPeer({ peerId: 'p3' });
    mesh.addPeer({ peerId: 'p4' });
    expect(mesh.addPeer({ peerId: 'p5' })).toBe(false);
  });

  it('should track sync state', () => {
    mesh.addPeer({ peerId: 'p1' });
    expect(mesh.getPeerState('p1')!.lastSync).toBeNull();

    mesh.markSynced('p1', ['todos']);
    expect(mesh.getPeerState('p1')!.lastSync).toBeGreaterThan(0);
    expect(mesh.getPeerState('p1')!.syncedCollections).toContain('todos');
  });

  it('should track latency', () => {
    mesh.addPeer({ peerId: 'p1' });
    mesh.updateLatency('p1', 50);
    expect(mesh.getPeerState('p1')!.latencyMs).toBe(50);
  });

  it('should record messages for diagnostics', () => {
    mesh.recordMessage('p1', 'p2', 'push');
    mesh.recordMessage('p2', 'p1', 'push-response');
    expect(mesh.getMessageLog().length).toBe(2);
  });

  it('should find stale peers', () => {
    mesh.addPeer({ peerId: 'p1' });
    mesh.addPeer({ peerId: 'p2' });
    mesh.markSynced('p1', ['todos']);

    const stale = mesh.getStalepeers(0);
    expect(stale.length).toBe(1);
    expect(stale[0]!.peerId).toBe('p2');
  });

  it('should produce sync order based on topology', () => {
    mesh.addPeer({ peerId: 'p1' });
    mesh.addPeer({ peerId: 'p2' });

    const order = mesh.getSyncOrder();
    expect(order.length).toBe(2);
  });

  it('should produce star topology sync order by latency', () => {
    const starMesh = createMeshCoordinator({ topology: 'star', maxPeers: 10 });
    starMesh.addPeer({ peerId: 'slow' });
    starMesh.addPeer({ peerId: 'fast' });
    starMesh.updateLatency('slow', 200);
    starMesh.updateLatency('fast', 10);

    const order = starMesh.getSyncOrder();
    expect(order[0]).toBe('fast');
    starMesh.stop();
  });

  it('should emit peer connect/disconnect events', () => {
    const connected: string[] = [];
    const disconnected: string[] = [];
    mesh.onPeerConnected((id) => connected.push(id));
    mesh.onPeerDisconnected((id) => disconnected.push(id));

    mesh.addPeer({ peerId: 'p1' });
    mesh.removePeer('p1');

    expect(connected).toContain('p1');
    expect(disconnected).toContain('p1');
  });

  it('should provide mesh stats', () => {
    mesh.addPeer({ peerId: 'p1' });
    mesh.addPeer({ peerId: 'p2' });
    mesh.recordMessage('p1', 'p2', 'push');

    const stats = mesh.getStats();
    expect(stats.totalPeers).toBe(2);
    expect(stats.connectedPeers).toBe(2);
    expect(stats.topology).toBe('full-mesh');
    expect(stats.totalMessages).toBe(1);
    expect(stats.collections).toEqual(['todos', 'notes']);
  });

  it('should start and stop', () => {
    expect(mesh.running).toBe(false);
    mesh.start();
    expect(mesh.running).toBe(true);
    mesh.stop();
    expect(mesh.running).toBe(false);
  });
});

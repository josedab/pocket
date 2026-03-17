import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncDashboard } from '../sync-dashboard.js';
import { createSyncDashboard } from '../sync-dashboard.js';
import type { SyncHistoryEntry, SyncPeerInfo } from '../types.js';

function makeSyncEntry(overrides: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry {
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    direction: overrides.direction ?? 'push',
    documentCount: overrides.documentCount ?? 10,
    conflictCount: overrides.conflictCount ?? 0,
    durationMs: overrides.durationMs ?? 100,
  };
}

function makePeer(overrides: Partial<SyncPeerInfo> = {}): SyncPeerInfo {
  return {
    peerId: overrides.peerId ?? `peer-${Math.random().toString(36).slice(2, 8)}`,
    status: overrides.status ?? 'connected',
    lastSyncAt: overrides.lastSyncAt ?? null,
    docsSynced: overrides.docsSynced ?? 0,
    latencyMs: overrides.latencyMs ?? 10,
  };
}

describe('SyncDashboard', () => {
  let dashboard: SyncDashboard;

  beforeEach(() => {
    dashboard = createSyncDashboard({ maxHistoryEntries: 50 });
  });

  // ── Sync History ──────────────────────────────────────────────────

  describe('recordSync / getHistory', () => {
    it('should start with empty history', () => {
      expect(dashboard.getHistory()).toEqual([]);
    });

    it('should record a sync entry', () => {
      dashboard.recordSync(makeSyncEntry({ id: 's1', documentCount: 20 }));
      const history = dashboard.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]!.id).toBe('s1');
      expect(history[0]!.documentCount).toBe(20);
    });

    it('should prepend new entries (most recent first)', () => {
      dashboard.recordSync(makeSyncEntry({ id: 'first' }));
      dashboard.recordSync(makeSyncEntry({ id: 'second' }));
      const history = dashboard.getHistory();
      expect(history[0]!.id).toBe('second');
      expect(history[1]!.id).toBe('first');
    });

    it('should respect maxHistoryEntries limit', () => {
      const small = createSyncDashboard({ maxHistoryEntries: 3 });
      for (let i = 0; i < 5; i++) {
        small.recordSync(makeSyncEntry({ id: `s${i}` }));
      }
      expect(small.getHistory().length).toBe(3);
    });

    it('should drop oldest entries when exceeding limit', () => {
      const small = createSyncDashboard({ maxHistoryEntries: 2 });
      small.recordSync(makeSyncEntry({ id: 'oldest' }));
      small.recordSync(makeSyncEntry({ id: 'mid' }));
      small.recordSync(makeSyncEntry({ id: 'newest' }));
      const ids = small.getHistory().map((e) => e.id);
      expect(ids).toContain('newest');
      expect(ids).toContain('mid');
      expect(ids).not.toContain('oldest');
    });

    it('should support all sync directions', () => {
      for (const dir of ['push', 'pull', 'bidirectional'] as const) {
        dashboard.recordSync(makeSyncEntry({ direction: dir }));
      }
      const dirs = dashboard.getHistory().map((e) => e.direction);
      expect(dirs).toContain('push');
      expect(dirs).toContain('pull');
      expect(dirs).toContain('bidirectional');
    });

    it('should return history with optional limit', () => {
      dashboard.recordSync(makeSyncEntry({ id: 'a' }));
      dashboard.recordSync(makeSyncEntry({ id: 'b' }));
      dashboard.recordSync(makeSyncEntry({ id: 'c' }));
      expect(dashboard.getHistory(2).length).toBe(2);
      expect(dashboard.getHistory().length).toBe(3);
    });

    it('should return all entries when limit exceeds count', () => {
      dashboard.recordSync(makeSyncEntry());
      expect(dashboard.getHistory(100).length).toBe(1);
    });

    it('should return a copy of history', () => {
      dashboard.recordSync(makeSyncEntry());
      const h1 = dashboard.getHistory();
      const h2 = dashboard.getHistory();
      expect(h1).not.toBe(h2);
      expect(h1).toEqual(h2);
    });
  });

  // ── Peer Tracking ─────────────────────────────────────────────────

  describe('recordPeerUpdate / getPeers', () => {
    it('should start with no peers', () => {
      expect(dashboard.getPeers()).toEqual([]);
    });

    it('should add a new peer', () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1', status: 'connected' }));
      const peers = dashboard.getPeers();
      expect(peers.length).toBe(1);
      expect(peers[0]!.peerId).toBe('p1');
    });

    it('should track multiple peers', () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1' }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p2' }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p3' }));
      expect(dashboard.getPeers().length).toBe(3);
    });

    it('should update existing peer (same peerId)', () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1', status: 'connected', latencyMs: 10 }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1', status: 'syncing', latencyMs: 5 }));
      const peers = dashboard.getPeers();
      expect(peers.length).toBe(1);
      expect(peers[0]!.status).toBe('syncing');
      expect(peers[0]!.latencyMs).toBe(5);
    });

    it('should support all peer statuses', () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1', status: 'connected' }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p2', status: 'disconnected' }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p3', status: 'syncing' }));
      const statuses = dashboard.getPeers().map((p) => p.status);
      expect(statuses).toContain('connected');
      expect(statuses).toContain('disconnected');
      expect(statuses).toContain('syncing');
    });

    it('should return a copy of peers', () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1' }));
      const p1 = dashboard.getPeers();
      const p2 = dashboard.getPeers();
      expect(p1).not.toBe(p2);
      expect(p1).toEqual(p2);
    });
  });

  // ── Throughput ────────────────────────────────────────────────────

  describe('getThroughput', () => {
    it('should return zero throughput with no history', () => {
      const throughput = dashboard.getThroughput();
      expect(throughput.docsPerSecond).toBe(0);
      expect(throughput.bytesPerSecond).toBe(0);
    });

    it('should compute positive throughput for recent entries', () => {
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: new Date().toISOString(),
          documentCount: 100,
          durationMs: 1000,
        })
      );
      const throughput = dashboard.getThroughput();
      expect(throughput.docsPerSecond).toBeGreaterThan(0);
    });

    it('should estimate bytesPerSecond as ~200 * docsPerSecond', () => {
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: new Date().toISOString(),
          documentCount: 100,
          durationMs: 1000,
        })
      );
      const throughput = dashboard.getThroughput();
      expect(throughput.bytesPerSecond).toBe(Math.round(throughput.docsPerSecond * 200));
    });

    it('should return zero throughput for entries older than 60 seconds', () => {
      const oldTime = new Date(Date.now() - 120_000).toISOString();
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: oldTime,
          documentCount: 100,
          durationMs: 1000,
        })
      );
      const throughput = dashboard.getThroughput();
      expect(throughput.docsPerSecond).toBe(0);
      expect(throughput.bytesPerSecond).toBe(0);
    });

    it('should aggregate throughput from multiple recent entries', () => {
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: new Date().toISOString(),
          documentCount: 50,
          durationMs: 500,
        })
      );
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: new Date().toISOString(),
          documentCount: 50,
          durationMs: 500,
        })
      );
      const throughput = dashboard.getThroughput();
      // 100 docs total, 1s total duration → 100 docs/sec
      expect(throughput.docsPerSecond).toBe(100);
    });
  });

  // ── Reactive State ────────────────────────────────────────────────

  describe('reactive state', () => {
    it('should provide initial disconnected state', async () => {
      const state = await firstValueFrom(dashboard.getState$());
      expect(state.connected).toBe(false);
      expect(state.peers).toEqual([]);
      expect(state.syncHistory).toEqual([]);
      expect(state.throughput.docsPerSecond).toBe(0);
      expect(state.conflicts).toEqual([]);
    });

    it('should become connected when a peer is added', async () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1' }));
      const state = await firstValueFrom(dashboard.getState$());
      expect(state.connected).toBe(true);
    });

    it('should include peers in state', async () => {
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p1' }));
      dashboard.recordPeerUpdate(makePeer({ peerId: 'p2' }));
      const state = await firstValueFrom(dashboard.getState$());
      expect(state.peers.length).toBe(2);
    });

    it('should include sync history in state', async () => {
      dashboard.recordSync(makeSyncEntry());
      dashboard.recordSync(makeSyncEntry());
      const state = await firstValueFrom(dashboard.getState$());
      expect(state.syncHistory.length).toBe(2);
    });

    it('should update throughput in state after recording sync', async () => {
      dashboard.recordSync(
        makeSyncEntry({
          timestamp: new Date().toISOString(),
          documentCount: 200,
          durationMs: 1000,
        })
      );
      const state = await firstValueFrom(dashboard.getState$());
      expect(state.throughput.docsPerSecond).toBeGreaterThan(0);
    });
  });

  // ── Default Config ────────────────────────────────────────────────

  describe('default config', () => {
    it('should work without config argument', () => {
      const d = createSyncDashboard();
      d.recordSync(makeSyncEntry());
      expect(d.getHistory().length).toBe(1);
    });

    it('should default maxHistoryEntries to 100', () => {
      const d = createSyncDashboard();
      for (let i = 0; i < 110; i++) {
        d.recordSync(makeSyncEntry({ id: `s${i}` }));
      }
      expect(d.getHistory().length).toBe(100);
    });
  });
});

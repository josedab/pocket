/**
 * Sync dashboard for monitoring sync status, peers, and history.
 *
 * @module @pocket/studio-pro
 *
 * @example
 * ```typescript
 * import { createSyncDashboard } from '@pocket/studio-pro';
 *
 * const dashboard = createSyncDashboard({ maxHistoryEntries: 200 });
 * dashboard.recordSync({
 *   id: 's1',
 *   timestamp: new Date().toISOString(),
 *   direction: 'push',
 *   documentCount: 10,
 *   conflictCount: 0,
 *   durationMs: 150,
 * });
 * console.log(dashboard.getThroughput());
 * ```
 */

import { BehaviorSubject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  SyncDashboardState,
  SyncPeerInfo,
  SyncHistoryEntry,
  StudioConfig,
} from './types.js';

/**
 * Sync dashboard API.
 */
export interface SyncDashboard {
  /** Get reactive sync dashboard state. */
  getState$(): Observable<SyncDashboardState>;
  /** Get all known peers. */
  getPeers(): SyncPeerInfo[];
  /** Get recent sync history, optionally limited. */
  getHistory(limit?: number): SyncHistoryEntry[];
  /** Get current throughput metrics. */
  getThroughput(): { docsPerSecond: number; bytesPerSecond: number };
  /** Record a sync operation. */
  recordSync(entry: SyncHistoryEntry): void;
  /** Record a peer status update. */
  recordPeerUpdate(info: SyncPeerInfo): void;
}

/**
 * Create a sync dashboard instance.
 *
 * @example
 * ```typescript
 * const dashboard = createSyncDashboard({ maxHistoryEntries: 100 });
 * dashboard.recordPeerUpdate({
 *   peerId: 'peer-1',
 *   status: 'connected',
 *   lastSyncAt: null,
 *   docsSynced: 0,
 *   latencyMs: 12,
 * });
 * ```
 */
export function createSyncDashboard(
  config: Partial<StudioConfig> = {},
): SyncDashboard {
  const maxHistory = config.maxHistoryEntries ?? 100;
  const peers = new Map<string, SyncPeerInfo>();
  const syncHistory: SyncHistoryEntry[] = [];

  const state$ = new BehaviorSubject<SyncDashboardState>({
    connected: false,
    peers: [],
    syncHistory: [],
    throughput: { docsPerSecond: 0, bytesPerSecond: 0 },
    conflicts: [],
  });

  function emitState(): void {
    state$.next({
      connected: peers.size > 0,
      peers: [...peers.values()],
      syncHistory: [...syncHistory],
      throughput: computeThroughput(),
      conflicts: [],
    });
  }

  function computeThroughput(): { docsPerSecond: number; bytesPerSecond: number } {
    if (syncHistory.length === 0) {
      return { docsPerSecond: 0, bytesPerSecond: 0 };
    }

    // Use entries from the last 60 seconds
    const now = Date.now();
    const windowMs = 60_000;
    const recent = syncHistory.filter((e) => {
      const entryTime = new Date(e.timestamp).getTime();
      return now - entryTime < windowMs;
    });

    if (recent.length === 0) {
      return { docsPerSecond: 0, bytesPerSecond: 0 };
    }

    const totalDocs = recent.reduce((sum, e) => sum + e.documentCount, 0);
    const totalDurationSec = recent.reduce((sum, e) => sum + e.durationMs, 0) / 1000;
    const docsPerSecond = totalDurationSec > 0 ? Math.round((totalDocs / totalDurationSec) * 100) / 100 : 0;

    // Estimate ~200 bytes per document for bytesPerSecond
    const bytesPerSecond = Math.round(docsPerSecond * 200);

    return { docsPerSecond, bytesPerSecond };
  }

  function getState$(): Observable<SyncDashboardState> {
    return state$.asObservable();
  }

  function getPeers(): SyncPeerInfo[] {
    return [...peers.values()];
  }

  function getHistory(limit?: number): SyncHistoryEntry[] {
    const entries = [...syncHistory];
    return limit !== undefined ? entries.slice(0, limit) : entries;
  }

  function getThroughput(): { docsPerSecond: number; bytesPerSecond: number } {
    return computeThroughput();
  }

  function recordSync(entry: SyncHistoryEntry): void {
    syncHistory.unshift(entry);
    if (syncHistory.length > maxHistory) {
      syncHistory.pop();
    }
    emitState();
  }

  function recordPeerUpdate(info: SyncPeerInfo): void {
    peers.set(info.peerId, info);
    emitState();
  }

  return { getState$, getPeers, getHistory, getThroughput, recordSync, recordPeerUpdate };
}

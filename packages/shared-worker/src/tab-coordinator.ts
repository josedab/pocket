/**
 * @module @pocket/shared-worker
 * Tab coordinator combining leader election, broadcast, and query deduplication.
 */

import { BehaviorSubject } from 'rxjs';
import type { Observable } from 'rxjs';
import { createBroadcastAdapter } from './broadcast-adapter.js';
import { createWorkerLeaderElection } from './leader-election.js';
import type { LeaderElection } from './leader-election.js';
import { createWorkerQueryDedup } from './query-dedup.js';
import type { QueryDeduplicator } from './query-dedup.js';
import type {
  BroadcastAdapter,
  BroadcastMessage,
  CoordinatorConfig,
  CoordinatorState,
  QueryDeduplicationEntry,
  TabInfo,
} from './types.js';

export interface TabCoordinator {
  register(): TabInfo;
  unregister(): void;
  getTabs(): TabInfo[];
  broadcast(message: BroadcastMessage): void;
  onMessage(callback: (message: BroadcastMessage) => void): () => void;
  state$: Observable<CoordinatorState>;
  destroy(): void;
  leaderElection: LeaderElection;
  queryDeduplicator: QueryDeduplicator;
}

export function createTabCoordinator(config: CoordinatorConfig): TabCoordinator {
  const channelName = `pocket-coordinator-${config.databaseName}`;
  const heartbeatMs = config.heartbeatMs ?? 1000;
  const leaderTimeoutMs = config.leaderTimeoutMs ?? 3000;

  const adapter: BroadcastAdapter = createBroadcastAdapter(channelName);

  const leaderElection = createWorkerLeaderElection(
    {
      heartbeatIntervalMs: heartbeatMs,
      leaderTimeoutMs,
      channelName,
    },
    adapter,
  );

  const queryDeduplicator = createWorkerQueryDedup({ ttlMs: 5000 });

  const messageListeners = new Set<(message: BroadcastMessage) => void>();
  let adapterUnsub: (() => void) | null = null;

  const state$ = new BehaviorSubject<CoordinatorState>({
    tabs: [],
    leader: null,
    queryCache: new Map<string, QueryDeduplicationEntry>(),
    isConnected: false,
  });

  let registered = false;

  function updateState(): void {
    const leaderState = leaderElection.getState();
    state$.next({
      tabs: leaderState.tabs,
      leader: leaderState.leaderId,
      queryCache: new Map<string, QueryDeduplicationEntry>(),
      isConnected: registered,
    });
  }

  function register(): TabInfo {
    if (!registered) {
      leaderElection.start();
      adapterUnsub = adapter.onMessage((msg) => {
        for (const listener of messageListeners) {
          listener(msg);
        }
      });
      registered = true;

      leaderElection.onLeaderChange(() => {
        updateState();
      });
    }

    const leaderState = leaderElection.getState();
    const selfTab = leaderState.tabs.find((t) => t.isLeader) ?? leaderState.tabs[0] ?? {
      tabId: 'unknown',
      isLeader: false,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
    updateState();
    return selfTab;
  }

  function unregister(): void {
    if (registered) {
      leaderElection.stop();
      if (adapterUnsub) {
        adapterUnsub();
        adapterUnsub = null;
      }
      registered = false;
      updateState();
    }
  }

  function getTabs(): TabInfo[] {
    return leaderElection.getState().tabs;
  }

  function broadcast(message: BroadcastMessage): void {
    adapter.postMessage(message);
  }

  function onMessage(callback: (message: BroadcastMessage) => void): () => void {
    messageListeners.add(callback);
    return () => {
      messageListeners.delete(callback);
    };
  }

  function destroy(): void {
    unregister();
    messageListeners.clear();
    adapter.close();
    state$.complete();
  }

  return {
    register,
    unregister,
    getTabs,
    broadcast,
    onMessage,
    state$: state$.asObservable(),
    destroy,
    leaderElection,
    queryDeduplicator,
  };
}

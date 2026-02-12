/**
 * @module @pocket/shared-worker
 * Leader election using a BroadcastChannel-like interface.
 */

import { BehaviorSubject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  BroadcastAdapter,
  BroadcastMessage,
  LeaderElectionConfig,
  LeaderElectionState,
  TabInfo,
} from './types.js';

export interface LeaderElection {
  start(): void;
  stop(): void;
  getState(): LeaderElectionState;
  state$: Observable<LeaderElectionState>;
  isLeader(): boolean;
  onLeaderChange(callback: (state: LeaderElectionState) => void): () => void;
}

export function createLeaderElection(
  config: LeaderElectionConfig,
  adapter: BroadcastAdapter,
): LeaderElection {
  const tabId = generateTabId();
  const tabs = new Map<string, TabInfo>();

  const selfTab: TabInfo = {
    tabId,
    isLeader: false,
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
  };
  tabs.set(tabId, selfTab);

  const state$ = new BehaviorSubject<LeaderElectionState>({
    leaderId: null,
    isLeader: false,
    tabs: [selfTab],
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeAdapter: (() => void) | null = null;

  function buildState(): LeaderElectionState {
    return {
      leaderId: findLeaderId(),
      isLeader: selfTab.isLeader,
      tabs: Array.from(tabs.values()),
    };
  }

  function findLeaderId(): string | null {
    for (const tab of tabs.values()) {
      if (tab.isLeader) return tab.tabId;
    }
    return null;
  }

  function emitState(): void {
    state$.next(buildState());
  }

  function claimLeadership(): void {
    selfTab.isLeader = true;
    tabs.set(tabId, selfTab);
    adapter.postMessage({
      type: 'leader_claim',
      senderId: tabId,
      payload: { tabId },
    });
    emitState();
  }

  function sendHeartbeat(): void {
    selfTab.lastHeartbeat = Date.now();
    tabs.set(tabId, { ...selfTab });
    adapter.postMessage({
      type: 'heartbeat',
      senderId: tabId,
      payload: { tabId, isLeader: selfTab.isLeader },
    });
  }

  function checkLeaderTimeout(): void {
    const now = Date.now();
    let leaderAlive = false;

    for (const [id, tab] of tabs) {
      if (id === tabId) continue;
      if (now - tab.lastHeartbeat > config.leaderTimeoutMs) {
        tabs.delete(id);
      } else if (tab.isLeader) {
        leaderAlive = true;
      }
    }

    if (!leaderAlive && !selfTab.isLeader) {
      claimLeadership();
    }

    emitState();
  }

  function handleMessage(message: BroadcastMessage): void {
    if (message.senderId === tabId) return;

    const payload = message.payload as { tabId: string; isLeader?: boolean };

    switch (message.type) {
      case 'heartbeat': {
        const existing = tabs.get(payload.tabId);
        tabs.set(payload.tabId, {
          tabId: payload.tabId,
          isLeader: payload.isLeader ?? false,
          connectedAt: existing?.connectedAt ?? Date.now(),
          lastHeartbeat: Date.now(),
        });
        emitState();
        break;
      }
      case 'leader_claim': {
        if (selfTab.isLeader && payload.tabId < tabId) {
          selfTab.isLeader = false;
          tabs.set(tabId, { ...selfTab });
        }
        tabs.set(payload.tabId, {
          tabId: payload.tabId,
          isLeader: true,
          connectedAt: tabs.get(payload.tabId)?.connectedAt ?? Date.now(),
          lastHeartbeat: Date.now(),
        });
        adapter.postMessage({
          type: 'leader_ack',
          senderId: tabId,
          payload: { tabId, acknowledgedLeader: payload.tabId },
        });
        emitState();
        break;
      }
      case 'tab_close': {
        const wasLeader = tabs.get(payload.tabId)?.isLeader ?? false;
        tabs.delete(payload.tabId);
        if (wasLeader) {
          claimLeadership();
        }
        emitState();
        break;
      }
      default:
        break;
    }
  }

  function start(): void {
    unsubscribeAdapter = adapter.onMessage(handleMessage);

    heartbeatTimer = setInterval(sendHeartbeat, config.heartbeatIntervalMs);
    timeoutTimer = setInterval(checkLeaderTimeout, config.leaderTimeoutMs / 2);

    // First tab claims leadership immediately
    claimLeadership();
    sendHeartbeat();
  }

  function stop(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (timeoutTimer) {
      clearInterval(timeoutTimer);
      timeoutTimer = null;
    }

    adapter.postMessage({
      type: 'tab_close',
      senderId: tabId,
      payload: { tabId },
    });

    if (unsubscribeAdapter) {
      unsubscribeAdapter();
      unsubscribeAdapter = null;
    }

    selfTab.isLeader = false;
    emitState();
  }

  return {
    start,
    stop,
    getState: () => buildState(),
    state$: state$.asObservable(),
    isLeader: () => selfTab.isLeader,
    onLeaderChange(callback: (state: LeaderElectionState) => void): () => void {
      const subscription = state$.subscribe(callback);
      return () => subscription.unsubscribe();
    },
  };
}

let tabCounter = 0;

function generateTabId(): string {
  return `tab-${Date.now()}-${++tabCounter}`;
}

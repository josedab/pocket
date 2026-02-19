/**
 * @module @pocket/shared-worker
 * High-level MultiTabSDK that wires together TabCoordinator, LeaderElection,
 * and BroadcastAdapter into a single ergonomic API.
 */

import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import type { Observable } from 'rxjs';
import { createBroadcastAdapter } from './broadcast-adapter.js';
import { createWorkerLeaderElection } from './leader-election.js';
import type { LeaderElection } from './leader-election.js';
import type { BroadcastAdapter, BroadcastMessage, TabInfo } from './types.js';

export type MultiTabStatus = 'stopped' | 'running';

export interface MultiTabSDKConfig {
  tabId?: string;
  enableLeaderElection?: boolean;
  heartbeatIntervalMs?: number;
  inactivityTimeoutMs?: number;
}

export interface MultiTabSDK {
  start(): void;
  stop(): void;
  isLeader$: Observable<boolean>;
  tabs$: Observable<TabInfo[]>;
  broadcastMessage(message: BroadcastMessage): void;
  onMessage(callback: (message: BroadcastMessage) => void): () => void;
  getStatus(): MultiTabStatus;
}

let sdkCounter = 0;

function generateSdkTabId(): string {
  return `sdk-tab-${Date.now()}-${++sdkCounter}`;
}

export function createMultiTabSDK(config: MultiTabSDKConfig = {}): MultiTabSDK {
  const tabId = config.tabId ?? generateSdkTabId();
  const enableLeaderElection = config.enableLeaderElection ?? true;
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 1000;
  const inactivityTimeoutMs = config.inactivityTimeoutMs ?? 3000;

  const channelName = `pocket-sdk-${tabId}`;
  const adapter: BroadcastAdapter = createBroadcastAdapter(channelName);

  let leaderElection: LeaderElection | null = null;
  if (enableLeaderElection) {
    leaderElection = createWorkerLeaderElection(
      {
        heartbeatIntervalMs,
        leaderTimeoutMs: inactivityTimeoutMs,
        channelName,
      },
      adapter,
    );
  }

  const status$ = new BehaviorSubject<MultiTabStatus>('stopped');
  const messageListeners = new Set<(message: BroadcastMessage) => void>();
  let adapterUnsub: (() => void) | null = null;

  const isLeader$: Observable<boolean> = leaderElection
    ? leaderElection.state$.pipe(
        map((s) => s.isLeader),
        distinctUntilChanged(),
      )
    : new BehaviorSubject<boolean>(false).asObservable();

  const tabs$: Observable<TabInfo[]> = leaderElection
    ? leaderElection.state$.pipe(
        map((s) => s.tabs),
      )
    : new BehaviorSubject<TabInfo[]>([]).asObservable();

  function start(): void {
    if (status$.getValue() === 'running') return;

    if (leaderElection) {
      leaderElection.start();
    }

    adapterUnsub = adapter.onMessage((msg) => {
      for (const listener of messageListeners) {
        listener(msg);
      }
    });

    status$.next('running');
  }

  function stop(): void {
    if (status$.getValue() === 'stopped') return;

    if (leaderElection) {
      leaderElection.stop();
    }

    if (adapterUnsub) {
      adapterUnsub();
      adapterUnsub = null;
    }

    adapter.close();
    messageListeners.clear();
    status$.next('stopped');
  }

  function broadcastMessage(message: BroadcastMessage): void {
    adapter.postMessage(message);
  }

  function onMessage(callback: (message: BroadcastMessage) => void): () => void {
    messageListeners.add(callback);
    return () => {
      messageListeners.delete(callback);
    };
  }

  function getStatus(): MultiTabStatus {
    return status$.getValue();
  }

  return {
    start,
    stop,
    isLeader$,
    tabs$,
    broadcastMessage,
    onMessage,
    getStatus,
  };
}

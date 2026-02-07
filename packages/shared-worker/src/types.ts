/**
 * @module @pocket/shared-worker
 * Types for multi-tab/multi-worker coordination.
 */

export interface TabInfo {
  tabId: string;
  isLeader: boolean;
  connectedAt: number;
  lastHeartbeat: number;
}

export interface LeaderElectionConfig {
  heartbeatIntervalMs: number;
  leaderTimeoutMs: number;
  channelName: string;
}

export interface LeaderElectionState {
  leaderId: string | null;
  isLeader: boolean;
  tabs: TabInfo[];
}

export interface CoordinatorConfig {
  databaseName: string;
  heartbeatMs?: number;
  leaderTimeoutMs?: number;
}

export interface CoordinatorState {
  tabs: TabInfo[];
  leader: string | null;
  queryCache: Map<string, QueryDeduplicationEntry>;
  isConnected: boolean;
}

export interface QueryDeduplicationEntry {
  queryHash: string;
  result: unknown;
  timestamp: number;
  refCount: number;
}

export interface BroadcastMessage {
  type: 'change' | 'heartbeat' | 'leader_claim' | 'leader_ack' | 'query_result' | 'tab_close';
  senderId: string;
  payload: unknown;
}

export interface SharedWorkerConfig {
  workerUrl?: string;
  fallbackToLocal?: boolean;
  heartbeatMs?: number;
}

export interface BroadcastAdapter {
  postMessage(message: BroadcastMessage): void;
  onMessage(handler: (message: BroadcastMessage) => void): () => void;
  close(): void;
}

export interface QueryDeduplicationConfig {
  ttlMs: number;
}

export interface QueryDeduplicationStats {
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
}

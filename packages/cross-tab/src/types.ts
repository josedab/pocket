/**
 * Types for Cross-Tab Synchronization
 */

/**
 * Message types for cross-tab communication
 */
export type CrossTabMessageType =
  | 'sync'
  | 'sync-request'
  | 'sync-response'
  | 'change'
  | 'delete'
  | 'clear'
  | 'lock-request'
  | 'lock-acquired'
  | 'lock-released'
  | 'leader-election'
  | 'leader-heartbeat'
  | 'ping'
  | 'pong';

/**
 * Base cross-tab message
 */
export interface CrossTabMessage<T = unknown> {
  /** Message type */
  type: CrossTabMessageType;
  /** Channel/collection name */
  channel: string;
  /** Sender tab ID */
  senderId: string;
  /** Message payload */
  payload: T;
  /** Timestamp */
  timestamp: number;
  /** Message ID for deduplication */
  messageId: string;
}

/**
 * Document change payload
 */
export interface ChangePayload {
  /** Document ID */
  id: string;
  /** Document data */
  data: Record<string, unknown>;
  /** Change timestamp */
  timestamp: number;
  /** Version number */
  version?: number;
}

/**
 * Sync request payload
 */
export interface SyncRequestPayload {
  /** Collection to sync */
  collection: string;
  /** Last known timestamp */
  since?: number;
  /** Request specific document IDs */
  documentIds?: string[];
}

/**
 * Sync response payload
 */
export interface SyncResponsePayload {
  /** Collection name */
  collection: string;
  /** Documents */
  documents: {
    id: string;
    data: Record<string, unknown>;
    timestamp: number;
  }[];
  /** Total count */
  total: number;
}

/**
 * Lock request payload
 */
export interface LockPayload {
  /** Resource being locked */
  resource: string;
  /** Lock holder tab ID */
  holderId?: string;
  /** Lock expiry timestamp */
  expiresAt?: number;
}

/**
 * Tab information
 */
export interface TabInfo {
  /** Tab ID */
  id: string;
  /** Tab creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActiveAt: number;
  /** Whether this tab is the leader */
  isLeader: boolean;
  /** Tab metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Leader election state
 */
export interface LeaderState {
  /** Current leader tab ID */
  leaderId: string | null;
  /** Leader election timestamp */
  electedAt: number | null;
  /** Last heartbeat from leader */
  lastHeartbeat: number | null;
  /** Whether this tab is the leader */
  isLeader: boolean;
}

/**
 * Cross-tab sync configuration
 */
export interface CrossTabConfig {
  /** Channel name prefix */
  channelPrefix?: string;
  /** Tab heartbeat interval (ms) */
  heartbeatInterval?: number;
  /** Leader election timeout (ms) */
  leaderTimeout?: number;
  /** Lock expiry time (ms) */
  lockExpiry?: number;
  /** Message deduplication window (ms) */
  deduplicationWindow?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Cross-tab event types
 */
export type CrossTabEventType =
  | 'connected'
  | 'disconnected'
  | 'tab-joined'
  | 'tab-left'
  | 'leader-changed'
  | 'message-received'
  | 'sync-complete'
  | 'lock-acquired'
  | 'lock-released'
  | 'error';

/**
 * Cross-tab event
 */
export interface CrossTabEvent {
  /** Event type */
  type: CrossTabEventType;
  /** Related tab ID */
  tabId?: string;
  /** Event data */
  data?: unknown;
  /** Timestamp */
  timestamp: number;
}

/**
 * Distributed lock
 */
export interface DistributedLock {
  /** Lock resource ID */
  resource: string;
  /** Lock holder tab ID */
  holderId: string;
  /** Lock acquired timestamp */
  acquiredAt: number;
  /** Lock expiry timestamp */
  expiresAt: number;
}

/**
 * Collection sync state
 */
export interface CollectionSyncState {
  /** Collection name */
  collection: string;
  /** Last sync timestamp */
  lastSyncAt: number;
  /** Number of pending changes */
  pendingChanges: number;
  /** Whether sync is in progress */
  syncing: boolean;
}

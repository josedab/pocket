/**
 * Types for the collaboration engine.
 */

export type CollabSessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface CollabUser {
  id: string;
  name: string;
  color?: string;
  avatar?: string;
}

export interface CollabCursor {
  userId: string;
  documentId: string;
  fieldPath?: string;
  offset?: number;
  line?: number;
  column?: number;
  timestamp: number;
}

export interface CollabSelection {
  userId: string;
  documentId: string;
  startOffset: number;
  endOffset: number;
  fieldPath?: string;
  timestamp: number;
}

export interface CollabEvent {
  type:
    | 'user-joined'
    | 'user-left'
    | 'cursor-moved'
    | 'selection-changed'
    | 'document-changed'
    | 'conflict-resolved'
    | 'session-error';
  userId: string;
  sessionId: string;
  timestamp: number;
  data?: unknown;
}

export interface CollabTransport {
  send(message: CollabMessage): void;
  onMessage(handler: (message: CollabMessage) => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
}

export interface CollabMessage {
  type: 'join' | 'leave' | 'cursor' | 'selection' | 'operation' | 'sync' | 'ack' | 'heartbeat';
  sessionId: string;
  userId: string;
  payload: unknown;
  timestamp: number;
}

export interface CollabSessionConfig {
  sessionId: string;
  user: CollabUser;
  transport: CollabTransport;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Cursor throttle in ms (default: 50) */
  cursorThrottleMs?: number;
  /** Inactivity timeout in ms before marking user offline (default: 30000) */
  inactivityTimeoutMs?: number;
}

export interface DocumentChange {
  documentId: string;
  collection: string;
  operations: DocumentOperation[];
  userId: string;
  timestamp: number;
}

export interface DocumentOperation {
  type: 'set' | 'delete' | 'insert-text' | 'delete-text';
  path: string;
  value?: unknown;
  position?: number;
  length?: number;
}

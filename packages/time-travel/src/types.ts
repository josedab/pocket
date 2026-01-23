/**
 * Types for time-travel debugging
 */

import type { Document } from '@pocket/core';

/**
 * Operation types for document changes
 */
export type OperationType = 'create' | 'update' | 'delete';

/**
 * A single change operation on a document
 */
export interface ChangeOperation<T extends Document = Document> {
  /** Operation type */
  type: OperationType;
  /** Collection name */
  collection: string;
  /** Document ID */
  documentId: string;
  /** Document state before the change (null for create) */
  before: T | null;
  /** Document state after the change (null for delete) */
  after: T | null;
  /** Timestamp of the change */
  timestamp: number;
  /** Optional metadata about the change */
  metadata?: Record<string, unknown>;
}

/**
 * A snapshot of database state at a point in time
 */
export interface Snapshot {
  /** Unique snapshot ID */
  id: string;
  /** Snapshot label/description */
  label?: string;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Map of collection names to document maps */
  collections: Record<string, Record<string, Document>>;
  /** Index in the history */
  index: number;
}

/**
 * History entry containing a batch of changes
 */
export interface HistoryEntry {
  /** Unique entry ID */
  id: string;
  /** Operations in this entry (can be batched) */
  operations: ChangeOperation[];
  /** Entry timestamp */
  timestamp: number;
  /** Entry label/description */
  label?: string;
  /** Whether this is a checkpoint/snapshot */
  isCheckpoint: boolean;
  /** Optional transaction ID */
  transactionId?: string;
}

/**
 * Time travel state
 */
export interface TimeTravelState {
  /** Current position in history (0 = present) */
  currentIndex: number;
  /** Total number of history entries */
  totalEntries: number;
  /** Whether currently in time travel mode */
  isTimeTraveling: boolean;
  /** Current snapshot if time traveling */
  currentSnapshot: Snapshot | null;
  /** Available checkpoints */
  checkpoints: Snapshot[];
}

/**
 * Configuration for time travel debugger
 */
export interface TimeTravelConfig {
  /** Maximum number of history entries to keep */
  maxHistorySize?: number;
  /** Whether to automatically create checkpoints */
  autoCheckpoint?: boolean;
  /** Interval for auto checkpoints (in operations) */
  checkpointInterval?: number;
  /** Whether to persist history to storage */
  persistHistory?: boolean;
  /** Storage key for persisted history */
  storageKey?: string;
  /** Whether to enable change tracking */
  enabled?: boolean;
}

/**
 * Default time travel configuration
 */
export const DEFAULT_TIME_TRAVEL_CONFIG: Required<TimeTravelConfig> = {
  maxHistorySize: 1000,
  autoCheckpoint: true,
  checkpointInterval: 100,
  persistHistory: false,
  storageKey: '__pocket_time_travel__',
  enabled: true,
};

/**
 * Filter options for history queries
 */
export interface HistoryFilterOptions {
  /** Filter by collection */
  collection?: string;
  /** Filter by document ID */
  documentId?: string;
  /** Filter by operation type */
  operationType?: OperationType;
  /** Filter by start time */
  startTime?: number;
  /** Filter by end time */
  endTime?: number;
  /** Filter by label (partial match) */
  label?: string;
  /** Limit results */
  limit?: number;
  /** Skip results */
  offset?: number;
}

/**
 * Diff between two document states
 */
export interface DocumentDiff<T extends Document = Document> {
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
  /** Fields that were added */
  added: Partial<T>;
  /** Fields that were removed */
  removed: Partial<T>;
  /** Fields that were changed (old value -> new value) */
  changed: {
    [K in keyof T]?: {
      before: T[K];
      after: T[K];
    };
  };
}

/**
 * Replay options
 */
export interface ReplayOptions {
  /** Speed multiplier (1 = real-time) */
  speed?: number;
  /** Whether to pause between operations */
  pauseBetweenOps?: boolean;
  /** Callback for each operation */
  onOperation?: (op: ChangeOperation) => void;
  /** Callback when replay completes */
  onComplete?: () => void;
  /** Filter operations to replay */
  filter?: (op: ChangeOperation) => boolean;
}

/**
 * Export format for history
 */
export interface HistoryExport {
  /** Export version */
  version: string;
  /** Export timestamp */
  exportedAt: number;
  /** History entries */
  entries: HistoryEntry[];
  /** Snapshots */
  snapshots: Snapshot[];
  /** Configuration used */
  config: TimeTravelConfig;
}

/**
 * Time travel event types
 */
export type TimeTravelEventType =
  | 'operation_recorded'
  | 'checkpoint_created'
  | 'time_travel_start'
  | 'time_travel_end'
  | 'time_travel_to'
  | 'history_cleared'
  | 'replay_start'
  | 'replay_end';

/**
 * Time travel event
 */
export interface TimeTravelEvent {
  /** Event type */
  type: TimeTravelEventType;
  /** Event timestamp */
  timestamp: number;
  /** Event data */
  data?: unknown;
}

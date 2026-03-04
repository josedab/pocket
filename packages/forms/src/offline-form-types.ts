/**
 * Types for conflict-free offline forms
 */

/** Unique identifier for a node/replica */
export type NodeId = string;

/** Vector clock for tracking causality */
export type VectorClock = Record<NodeId, number>;

/** Result from merging two CRDT states */
export interface MergeResult<T = unknown> {
  value: T;
  hadConflict: boolean;
  conflictingValues?: T[];
}

export type CRDTFieldType = 'lww' | 'text' | 'counter';

export interface CRDTFieldConfig {
  type: CRDTFieldType;
  /** For counter fields, set initial value */
  initialValue?: unknown;
}

export interface OfflineFormConfig {
  /** Unique form ID for sync identification */
  formId: string;
  /** Node ID for this client */
  nodeId: NodeId;
  /** CRDT type mapping per field (defaults to 'lww') */
  fieldTypes?: Record<string, CRDTFieldConfig>;
}

export interface FieldConflict<T = unknown> {
  fieldName: string;
  localValue: T;
  remoteValues: T[];
  resolvedValue?: T;
  timestamp: number;
}

export interface MergeUIState {
  conflicts: FieldConflict[];
  isResolving: boolean;
  resolvedCount: number;
  totalConflicts: number;
}

export interface OfflineFormState {
  /** Current form values (optimistic) */
  values: Record<string, unknown>;
  /** Whether there are unresolved conflicts */
  hasConflicts: boolean;
  /** Individual field conflicts */
  conflicts: FieldConflict[];
  /** Whether currently syncing */
  isSyncing: boolean;
  /** Number of pending local changes */
  pendingChanges: number;
  /** Vector clock for this form's state */
  vectorClock: VectorClock;
  /** Last sync timestamp */
  lastSyncedAt: number | null;
}

export interface OfflineFormSnapshot {
  formId: string;
  nodeId: NodeId;
  values: Record<string, unknown>;
  fieldStates: Record<string, unknown>;
  vectorClock: VectorClock;
  timestamp: number;
}

export type ConflictResolutionStrategy = 'local' | 'remote' | 'manual' | 'merge';

export interface UseOfflineFormReturn<T extends Record<string, unknown>> {
  /** Current values (optimistic, local-first) */
  values: T;
  /** Set a field value (local operation, CRDT-backed) */
  setValue: (name: keyof T & string, value: unknown) => void;
  /** Set multiple values */
  setValues: (values: Partial<T>) => void;
  /** Increment a counter field */
  increment: (name: keyof T & string, amount?: number) => void;
  /** Decrement a counter field */
  decrement: (name: keyof T & string, amount?: number) => void;
  /** Apply remote changes from another node */
  applyRemote: (snapshot: OfflineFormSnapshot) => MergeResult<Record<string, unknown>>;
  /** Get snapshot for syncing to other nodes */
  getSnapshot: () => OfflineFormSnapshot;
  /** Resolve a specific field conflict */
  resolveConflict: (fieldName: string, value: unknown) => void;
  /** Resolve all conflicts with a strategy */
  resolveAllConflicts: (strategy: ConflictResolutionStrategy) => void;
  /** Offline form state */
  state: OfflineFormState;
  /** Merge UI state for conflict resolution components */
  mergeState: MergeUIState;
  /** Reset to initial state */
  reset: () => void;
  /** Destroy and clean up */
  destroy: () => void;
}

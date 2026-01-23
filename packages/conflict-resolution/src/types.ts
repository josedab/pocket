/**
 * Types for conflict resolution
 */

import type { Document } from '@pocket/core';

/**
 * Conflict type
 */
export type ConflictType =
  | 'update_update' // Both sides updated the same document
  | 'update_delete' // One side updated, other deleted
  | 'delete_update' // One side deleted, other updated
  | 'create_create'; // Both sides created with same ID

/**
 * Conflict source (which side made the change)
 */
export type ConflictSource = 'local' | 'remote';

/**
 * Resolution strategy
 */
export type ResolutionStrategy =
  | 'keep_local' // Keep local version
  | 'keep_remote' // Keep remote version
  | 'keep_both' // Keep both (create copy)
  | 'merge' // Merge changes (field-level)
  | 'custom' // Custom resolution
  | 'timestamp' // Latest timestamp wins
  | 'version' // Highest version wins
  | 'manual'; // Require manual resolution

/**
 * A single conflict
 */
export interface Conflict<T extends Document = Document> {
  /** Unique conflict ID */
  id: string;
  /** Conflict type */
  type: ConflictType;
  /** Collection name */
  collection: string;
  /** Document ID */
  documentId: string;
  /** Local version of the document */
  local: T | null;
  /** Remote version of the document */
  remote: T | null;
  /** Common ancestor (base version) */
  base: T | null;
  /** When the conflict was detected */
  detectedAt: number;
  /** Sync session ID that detected this conflict */
  syncSessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Field-level change
 */
export interface FieldChange<T = unknown> {
  /** Field path (dot notation for nested) */
  path: string;
  /** Local value */
  localValue: T;
  /** Remote value */
  remoteValue: T;
  /** Base value (if available) */
  baseValue?: T;
  /** Whether this field has a conflict */
  hasConflict: boolean;
}

/**
 * Detailed conflict analysis
 */
export interface ConflictAnalysis<T extends Document = Document> {
  /** The conflict */
  conflict: Conflict<T>;
  /** Field-level changes */
  fieldChanges: FieldChange[];
  /** Fields only changed locally */
  localOnlyChanges: string[];
  /** Fields only changed remotely */
  remoteOnlyChanges: string[];
  /** Fields changed by both */
  conflictingFields: string[];
  /** Whether auto-merge is possible */
  canAutoMerge: boolean;
  /** Suggested resolution strategy */
  suggestedStrategy: ResolutionStrategy;
  /** Suggested merged result (if auto-merge is possible) */
  suggestedMerge?: T;
}

/**
 * Resolution for a conflict
 */
export interface ConflictResolution<T extends Document = Document> {
  /** Conflict ID being resolved */
  conflictId: string;
  /** Strategy used */
  strategy: ResolutionStrategy;
  /** Resolved document */
  resolvedDocument: T | null;
  /** Whether to delete the document */
  deleteDocument: boolean;
  /** User who resolved (if manual) */
  resolvedBy?: string;
  /** When resolution was made */
  resolvedAt: number;
  /** Additional notes */
  notes?: string;
}

/**
 * Conflict resolution state
 */
export interface ConflictState {
  /** Pending conflicts */
  conflicts: Conflict[];
  /** Currently selected conflict */
  selectedConflictId: string | null;
  /** Resolution history */
  resolutionHistory: ConflictResolution[];
  /** Auto-resolution rules */
  autoResolutionRules: AutoResolutionRule[];
}

/**
 * Auto-resolution rule
 */
export interface AutoResolutionRule {
  /** Rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Collections to apply to (empty = all) */
  collections: string[];
  /** Conflict types to apply to */
  conflictTypes: ConflictType[];
  /** Strategy to use */
  strategy: ResolutionStrategy;
  /** Priority (higher = evaluated first) */
  priority: number;
  /** Custom condition function */
  condition?: (conflict: Conflict) => boolean;
  /** Whether rule is enabled */
  enabled: boolean;
}

/**
 * Configuration for conflict resolution
 */
export interface ConflictResolutionConfig {
  /** Default resolution strategy */
  defaultStrategy?: ResolutionStrategy;
  /** Auto-resolve conflicts matching rules */
  autoResolve?: boolean;
  /** Auto-resolution rules */
  autoResolutionRules?: AutoResolutionRule[];
  /** Max conflicts to keep in memory */
  maxConflicts?: number;
  /** Keep resolution history */
  keepHistory?: boolean;
  /** Max history entries */
  maxHistorySize?: number;
  /** Notification callback for new conflicts */
  onConflict?: (conflict: Conflict) => void;
  /** Notification callback for resolution */
  onResolution?: (resolution: ConflictResolution) => void;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFLICT_CONFIG: Required<
  Omit<ConflictResolutionConfig, 'onConflict' | 'onResolution' | 'autoResolutionRules'>
> = {
  defaultStrategy: 'manual',
  autoResolve: false,
  maxConflicts: 100,
  keepHistory: true,
  maxHistorySize: 500,
};

/**
 * Conflict event types
 */
export type ConflictEventType =
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'conflict_auto_resolved'
  | 'conflicts_cleared'
  | 'rule_added'
  | 'rule_removed';

/**
 * Conflict event
 */
export interface ConflictEvent {
  /** Event type */
  type: ConflictEventType;
  /** Event timestamp */
  timestamp: number;
  /** Event data */
  data?: unknown;
}

/**
 * Merge operation result
 */
export interface MergeResult<T extends Document = Document> {
  /** Whether merge was successful */
  success: boolean;
  /** Merged document (if successful) */
  merged?: T;
  /** Unresolved conflicts (if any) */
  unresolvedConflicts?: string[];
  /** Error message (if failed) */
  error?: string;
}

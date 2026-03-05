import type { Document } from '../types/document.js';

/** Branch metadata */
export interface BranchMetadata {
  name: string;
  parentBranch: string | null;
  createdAt: number;
  updatedAt: number;
  description?: string;
  snapshot: string | null;
}

/** Branch merge strategy */
export type MergeStrategy = 'fast-forward' | 'three-way-merge' | 'rebase';

/** Merge conflict for a single document */
export interface MergeConflict<T extends Document = Document> {
  documentId: string;
  collection: string;
  base: T | null;
  ours: T | null;
  theirs: T | null;
  autoResolved: boolean;
  resolution?: T;
}

/** Merge result */
export interface MergeResult {
  strategy: MergeStrategy;
  success: boolean;
  conflicts: MergeConflict[];
  mergedDocuments: number;
  duration: number;
}

/** Branch snapshot */
export interface BranchSnapshot {
  id: string;
  branchName: string;
  timestamp: number;
  label?: string;
  collections: Record<string, SnapshotCollectionState>;
  parentSnapshotId: string | null;
  deltaOnly: boolean;
}

/** Snapshot state for a single collection */
export interface SnapshotCollectionState {
  documentCount: number;
  documents: Record<string, Document>;
  checksum: string;
}

/** Branch diff summary */
export interface BranchDiff {
  sourceBranch: string;
  targetBranch: string;
  added: Array<{ collection: string; documentId: string }>;
  modified: Array<{ collection: string; documentId: string }>;
  deleted: Array<{ collection: string; documentId: string }>;
  totalChanges: number;
}

/** Branch manager configuration */
export interface BranchManagerConfig {
  maxBranches?: number;
  maxSnapshots?: number;
  defaultMergeStrategy?: MergeStrategy;
  enableCopyOnWrite?: boolean;
  snapshotRetentionDays?: number;
}

/** Branch event types */
export type BranchEventType =
  | 'branch_created'
  | 'branch_deleted'
  | 'branch_switched'
  | 'branch_merged'
  | 'snapshot_created'
  | 'snapshot_restored'
  | 'conflict_detected'
  | 'conflict_resolved';

/** Branch event */
export interface BranchEvent {
  type: BranchEventType;
  timestamp: number;
  branch: string;
  data?: Record<string, unknown>;
}

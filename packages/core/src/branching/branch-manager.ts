/**
 * Branch Manager - Git-like branching for Pocket databases
 *
 * Provides branch(), checkout(), merge(), snapshot(), restore() operations
 * with copy-on-write storage namespace isolation.
 *
 * @module branching
 *
 * @example
 * ```typescript
 * import { createBranchManager } from '@pocket/core';
 *
 * const manager = createBranchManager({ maxBranches: 10 });
 *
 * // Create a branch from main
 * manager.branch('feature-x', { description: 'New feature' });
 * manager.checkout('feature-x');
 *
 * // Take a snapshot
 * const snap = manager.snapshot('before-refactor');
 *
 * // Merge back into main
 * manager.checkout('main');
 * const result = manager.merge('feature-x');
 *
 * manager.destroy();
 * ```
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import type { Document } from '../types/document.js';
import type {
  BranchMetadata,
  BranchManagerConfig,
  BranchEvent,
  BranchEventType,
  BranchSnapshot,
  BranchDiff,
  MergeResult,
  MergeStrategy,
  MergeConflict,
  SnapshotCollectionState,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Observable state exposed by the branch manager */
export interface BranchManagerState {
  currentBranch: string;
  branches: string[];
  snapshotCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Deep-clone a plain object */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Compute a simple string hash for checksum */
function computeChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Clone branch data with copy-on-write (shallow-clone maps, share doc refs) */
function cloneBranchData(
  source: Map<string, Map<string, Document>>
): Map<string, Map<string, Document>> {
  const result = new Map<string, Map<string, Document>>();
  for (const [collection, docs] of source) {
    result.set(collection, new Map(docs));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Branch Manager
// ---------------------------------------------------------------------------

/**
 * Git-like branch manager for in-memory document data. Supports branching,
 * checkout, merge (fast-forward and three-way), snapshot, and restore.
 *
 * @example
 * ```typescript
 * const manager = new BranchManager();
 * manager.branch('experiment');
 * manager.checkout('experiment');
 * manager.checkout('main');
 * const result = manager.merge('experiment');
 * manager.destroy();
 * ```
 */
export class BranchManager {
  private readonly config: Required<BranchManagerConfig>;
  private readonly branches = new Map<string, BranchMetadata>();
  private readonly snapshots = new Map<string, BranchSnapshot>();
  private readonly branchData = new Map<string, Map<string, Map<string, Document>>>();
  private currentBranchName = 'main';

  private readonly state$ = new BehaviorSubject<BranchManagerState>({
    currentBranch: 'main',
    branches: ['main'],
    snapshotCount: 0,
  });

  private readonly events$ = new Subject<BranchEvent>();

  constructor(config: BranchManagerConfig = {}) {
    this.config = {
      maxBranches: config.maxBranches ?? 50,
      maxSnapshots: config.maxSnapshots ?? 200,
      defaultMergeStrategy: config.defaultMergeStrategy ?? 'three-way-merge',
      enableCopyOnWrite: config.enableCopyOnWrite ?? true,
      snapshotRetentionDays: config.snapshotRetentionDays ?? 30,
    };

    // Initialise the main branch
    const now = Date.now();
    this.branches.set('main', {
      name: 'main',
      parentBranch: null,
      createdAt: now,
      updatedAt: now,
      snapshot: null,
    });
    this.branchData.set('main', new Map());
  }

  // ---- Branch operations ------------------------------------------------

  /**
   * Create a new branch, optionally from another branch.
   */
  branch(
    name: string,
    options: { from?: string; description?: string } = {}
  ): BranchMetadata {
    if (this.branches.has(name)) {
      throw new Error(`Branch "${name}" already exists`);
    }

    if (this.branches.size >= this.config.maxBranches) {
      throw new Error(`Maximum number of branches (${this.config.maxBranches}) reached`);
    }

    const fromBranch = options.from ?? this.currentBranchName;
    if (!this.branches.has(fromBranch)) {
      throw new Error(`Source branch "${fromBranch}" not found`);
    }

    const sourceData = this.branchData.get(fromBranch)!;
    const now = Date.now();

    // Take a snapshot at the branch point
    const snapshotId = this.captureSnapshotInternal(fromBranch, `branch-point:${name}`);

    const metadata: BranchMetadata = {
      name,
      parentBranch: fromBranch,
      createdAt: now,
      updatedAt: now,
      description: options.description,
      snapshot: snapshotId,
    };

    this.branches.set(name, metadata);

    // Copy-on-write: shallow-clone collection maps, share document references
    if (this.config.enableCopyOnWrite) {
      this.branchData.set(name, cloneBranchData(sourceData));
    } else {
      this.branchData.set(name, deepClone(sourceData) as unknown as Map<string, Map<string, Document>>);
    }

    this.updateState();
    this.emitEvent('branch_created', name, { from: fromBranch });

    return metadata;
  }

  /**
   * Switch the active branch.
   */
  checkout(branchName: string): void {
    if (!this.branches.has(branchName)) {
      throw new Error(`Branch "${branchName}" not found`);
    }

    const previous = this.currentBranchName;
    this.currentBranchName = branchName;
    this.branches.get(branchName)!.updatedAt = Date.now();

    this.updateState();
    this.emitEvent('branch_switched', branchName, { from: previous });
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch(): string {
    return this.currentBranchName;
  }

  /**
   * Get all branch metadata.
   */
  getBranches(): BranchMetadata[] {
    return [...this.branches.values()];
  }

  /**
   * Get metadata for a specific branch.
   */
  getBranch(name: string): BranchMetadata | null {
    return this.branches.get(name) ?? null;
  }

  /**
   * Delete a branch. Cannot delete the current branch or 'main'.
   */
  deleteBranch(name: string): void {
    if (name === 'main') {
      throw new Error('Cannot delete the "main" branch');
    }
    if (name === this.currentBranchName) {
      throw new Error('Cannot delete the current branch');
    }
    if (!this.branches.has(name)) {
      throw new Error(`Branch "${name}" not found`);
    }

    this.branches.delete(name);
    this.branchData.delete(name);

    this.updateState();
    this.emitEvent('branch_deleted', name);
  }

  // ---- Data access (internal) -------------------------------------------

  /**
   * Get the data map for the current branch. Exposed for integration with
   * the database layer.
   */
  getData(): Map<string, Map<string, Document>> {
    return this.branchData.get(this.currentBranchName)!;
  }

  /**
   * Set a document in the current branch.
   */
  setDocument(collection: string, doc: Document): void {
    const data = this.branchData.get(this.currentBranchName)!;
    if (!data.has(collection)) {
      data.set(collection, new Map());
    }
    data.get(collection)!.set(doc._id, doc);
    this.branches.get(this.currentBranchName)!.updatedAt = Date.now();
  }

  /**
   * Remove a document from the current branch.
   */
  removeDocument(collection: string, documentId: string): void {
    const data = this.branchData.get(this.currentBranchName)!;
    const col = data.get(collection);
    if (col) {
      col.delete(documentId);
      if (col.size === 0) {
        data.delete(collection);
      }
    }
    this.branches.get(this.currentBranchName)!.updatedAt = Date.now();
  }

  // ---- Merge ------------------------------------------------------------

  /**
   * Merge a source branch into the current branch.
   */
  merge(
    sourceBranch: string,
    options: {
      strategy?: MergeStrategy;
      resolveConflicts?: (conflicts: MergeConflict[]) => MergeConflict[];
    } = {}
  ): MergeResult {
    const startTime = Date.now();
    const strategy = options.strategy ?? this.config.defaultMergeStrategy;

    if (sourceBranch === this.currentBranchName) {
      throw new Error('Cannot merge a branch into itself');
    }
    if (!this.branches.has(sourceBranch)) {
      throw new Error(`Branch "${sourceBranch}" not found`);
    }

    const sourceData = this.branchData.get(sourceBranch)!;
    const targetData = this.branchData.get(this.currentBranchName)!;

    // Find the common ancestor snapshot
    const sourceMeta = this.branches.get(sourceBranch)!;
    const baseData = this.getBaseData(sourceMeta);

    let conflicts: MergeConflict[] = [];
    let mergedDocuments = 0;

    if (strategy === 'fast-forward') {
      // Fast-forward: replace target data with source data if no divergence
      const diff = this.computeDiff(this.currentBranchName, sourceBranch);
      if (diff.totalChanges === 0) {
        return {
          strategy,
          success: true,
          conflicts: [],
          mergedDocuments: 0,
          duration: Date.now() - startTime,
        };
      }

      // Apply all source changes directly
      for (const [col, docs] of sourceData) {
        if (!targetData.has(col)) {
          targetData.set(col, new Map());
        }
        for (const [id, doc] of docs) {
          targetData.get(col)!.set(id, doc);
          mergedDocuments++;
        }
      }
    } else if (strategy === 'three-way-merge' || strategy === 'rebase') {
      // Three-way merge: compare base vs ours (target) vs theirs (source)
      const allCollections = new Set([
        ...baseData.keys(),
        ...sourceData.keys(),
        ...targetData.keys(),
      ]);

      for (const col of allCollections) {
        const baseDocs = baseData.get(col) ?? new Map<string, Document>();
        const ourDocs = targetData.get(col) ?? new Map<string, Document>();
        const theirDocs = sourceData.get(col) ?? new Map<string, Document>();

        const allIds = new Set([
          ...baseDocs.keys(),
          ...ourDocs.keys(),
          ...theirDocs.keys(),
        ]);

        if (!targetData.has(col)) {
          targetData.set(col, new Map());
        }

        for (const id of allIds) {
          const baseDoc = baseDocs.get(id) ?? null;
          const ourDoc = ourDocs.get(id) ?? null;
          const theirDoc = theirDocs.get(id) ?? null;

          const baseJson = baseDoc ? JSON.stringify(baseDoc) : null;
          const ourJson = ourDoc ? JSON.stringify(ourDoc) : null;
          const theirJson = theirDoc ? JSON.stringify(theirDoc) : null;

          // No change from either side
          if (ourJson === theirJson) {
            continue;
          }

          // Only theirs changed → take theirs
          if (ourJson === baseJson && theirJson !== baseJson) {
            if (theirDoc) {
              targetData.get(col)!.set(id, theirDoc);
            } else {
              targetData.get(col)!.delete(id);
            }
            mergedDocuments++;
            continue;
          }

          // Only ours changed → keep ours
          if (theirJson === baseJson && ourJson !== baseJson) {
            continue;
          }

          // Both sides changed differently → field-level merge
          const conflict = this.resolveFieldConflict(col, id, baseDoc, ourDoc, theirDoc);
          if (conflict.autoResolved && conflict.resolution) {
            targetData.get(col)!.set(id, conflict.resolution);
            mergedDocuments++;
          } else {
            conflicts.push(conflict);
          }
        }

        // Clean up empty collections
        if (targetData.get(col)!.size === 0) {
          targetData.delete(col);
        }
      }
    }

    // Let the caller resolve conflicts if a resolver is provided
    if (conflicts.length > 0 && options.resolveConflicts) {
      conflicts = options.resolveConflicts(conflicts);
      this.emitEvent('conflict_detected', this.currentBranchName, {
        count: conflicts.length,
        source: sourceBranch,
      });

      for (const conflict of conflicts) {
        if (conflict.resolution) {
          if (!targetData.has(conflict.collection)) {
            targetData.set(conflict.collection, new Map());
          }
          targetData.get(conflict.collection)!.set(conflict.documentId, conflict.resolution);
          conflict.autoResolved = true;
          mergedDocuments++;
        }
      }

      this.emitEvent('conflict_resolved', this.currentBranchName, {
        resolved: conflicts.filter((c) => c.autoResolved).length,
        source: sourceBranch,
      });
    }

    const unresolvedConflicts = conflicts.filter((c) => !c.autoResolved);
    const success = unresolvedConflicts.length === 0;

    this.branches.get(this.currentBranchName)!.updatedAt = Date.now();
    this.updateState();
    this.emitEvent('branch_merged', this.currentBranchName, {
      source: sourceBranch,
      strategy,
      mergedDocuments,
      conflicts: unresolvedConflicts.length,
    });

    return {
      strategy,
      success,
      conflicts: unresolvedConflicts,
      mergedDocuments,
      duration: Date.now() - startTime,
    };
  }

  // ---- Diff -------------------------------------------------------------

  /**
   * Compute a diff between the current branch and a target branch.
   */
  diff(targetBranch: string): BranchDiff {
    if (!this.branches.has(targetBranch)) {
      throw new Error(`Branch "${targetBranch}" not found`);
    }
    return this.computeDiff(this.currentBranchName, targetBranch);
  }

  // ---- Snapshots --------------------------------------------------------

  /**
   * Take a snapshot of the current branch.
   */
  snapshot(label?: string): BranchSnapshot {
    const id = this.captureSnapshotInternal(this.currentBranchName, label);
    const snap = this.snapshots.get(id)!;

    this.emitEvent('snapshot_created', this.currentBranchName, { snapshotId: id });
    return snap;
  }

  /**
   * Restore the current branch to a previous snapshot state.
   */
  restore(snapshotId: string): void {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) {
      throw new Error(`Snapshot "${snapshotId}" not found`);
    }

    // Rebuild branch data from snapshot collections
    const data = new Map<string, Map<string, Document>>();
    for (const [col, state] of Object.entries(snap.collections)) {
      const docs = new Map<string, Document>();
      for (const [id, doc] of Object.entries(state.documents)) {
        docs.set(id, deepClone(doc));
      }
      data.set(col, docs);
    }

    this.branchData.set(this.currentBranchName, data);
    this.branches.get(this.currentBranchName)!.updatedAt = Date.now();

    this.updateState();
    this.emitEvent('snapshot_restored', this.currentBranchName, { snapshotId });
  }

  /**
   * Get all snapshots, optionally filtered by branch.
   */
  getSnapshots(branchName?: string): BranchSnapshot[] {
    const target = branchName ?? this.currentBranchName;
    return [...this.snapshots.values()]
      .filter((s) => s.branchName === target)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get a snapshot by ID.
   */
  getSnapshot(id: string): BranchSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  // ---- Observables ------------------------------------------------------

  /**
   * Get events observable.
   */
  get events(): Observable<BranchEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get state observable.
   */
  get state(): Observable<BranchManagerState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state value.
   */
  getCurrentState(): BranchManagerState {
    return this.state$.value;
  }

  // ---- Lifecycle --------------------------------------------------------

  /**
   * Clean up subscriptions.
   */
  destroy(): void {
    this.state$.complete();
    this.events$.complete();
  }

  // ---- Private helpers --------------------------------------------------

  /** Capture a snapshot of the given branch and store it */
  private captureSnapshotInternal(branchName: string, label?: string): string {
    const data = this.branchData.get(branchName)!;
    const id = generateId();

    // Enforce max snapshot limit
    if (this.snapshots.size >= this.config.maxSnapshots) {
      this.pruneOldestSnapshots(1);
    }

    // Find parent snapshot for the branch
    const branchSnapshots = [...this.snapshots.values()]
      .filter((s) => s.branchName === branchName)
      .sort((a, b) => b.timestamp - a.timestamp);
    const parentSnapshotId = branchSnapshots.length > 0 ? branchSnapshots[0]!.id : null;

    const collections: Record<string, SnapshotCollectionState> = {};
    for (const [col, docs] of data) {
      const documents: Record<string, Document> = {};
      for (const [docId, doc] of docs) {
        documents[docId] = doc;
      }
      collections[col] = {
        documentCount: docs.size,
        documents,
        checksum: computeChecksum(JSON.stringify(documents)),
      };
    }

    const snap: BranchSnapshot = {
      id,
      branchName,
      timestamp: Date.now(),
      label,
      collections,
      parentSnapshotId,
      deltaOnly: false,
    };

    this.snapshots.set(id, snap);
    this.updateState();

    return id;
  }

  /** Remove the oldest N snapshots */
  private pruneOldestSnapshots(count: number): void {
    const sorted = [...this.snapshots.values()].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < count && i < sorted.length; i++) {
      this.snapshots.delete(sorted[i]!.id);
    }
  }

  /** Get the base data from the branch's creation snapshot */
  private getBaseData(branchMeta: BranchMetadata): Map<string, Map<string, Document>> {
    if (branchMeta.snapshot) {
      const snap = this.snapshots.get(branchMeta.snapshot);
      if (snap) {
        const data = new Map<string, Map<string, Document>>();
        for (const [col, state] of Object.entries(snap.collections)) {
          const docs = new Map<string, Document>();
          for (const [id, doc] of Object.entries(state.documents)) {
            docs.set(id, doc);
          }
          data.set(col, docs);
        }
        return data;
      }
    }
    return new Map();
  }

  /** Compute diff between two branches */
  private computeDiff(sourceBranch: string, targetBranch: string): BranchDiff {
    const sourceData = this.branchData.get(sourceBranch)!;
    const targetData = this.branchData.get(targetBranch)!;

    const added: Array<{ collection: string; documentId: string }> = [];
    const modified: Array<{ collection: string; documentId: string }> = [];
    const deleted: Array<{ collection: string; documentId: string }> = [];

    const allCollections = new Set([...sourceData.keys(), ...targetData.keys()]);

    for (const col of allCollections) {
      const sourceDocs = sourceData.get(col) ?? new Map<string, Document>();
      const targetDocs = targetData.get(col) ?? new Map<string, Document>();
      const allIds = new Set([...sourceDocs.keys(), ...targetDocs.keys()]);

      for (const id of allIds) {
        const sourceDoc = sourceDocs.get(id);
        const targetDoc = targetDocs.get(id);

        if (!sourceDoc && targetDoc) {
          added.push({ collection: col, documentId: id });
        } else if (sourceDoc && !targetDoc) {
          deleted.push({ collection: col, documentId: id });
        } else if (
          sourceDoc &&
          targetDoc &&
          JSON.stringify(sourceDoc) !== JSON.stringify(targetDoc)
        ) {
          modified.push({ collection: col, documentId: id });
        }
      }
    }

    return {
      sourceBranch,
      targetBranch,
      added,
      modified,
      deleted,
      totalChanges: added.length + modified.length + deleted.length,
    };
  }

  /** Attempt field-level conflict resolution */
  private resolveFieldConflict(
    collection: string,
    documentId: string,
    base: Document | null,
    ours: Document | null,
    theirs: Document | null
  ): MergeConflict {
    // If one side deleted and the other modified → conflict
    if (!ours || !theirs) {
      return {
        documentId,
        collection,
        base,
        ours,
        theirs,
        autoResolved: false,
      };
    }

    // Both modified → try field-level merge
    const allFields = new Set([
      ...Object.keys(ours),
      ...Object.keys(theirs),
      ...(base ? Object.keys(base) : []),
    ]);

    const merged: Record<string, unknown> = {};
    let hasConflict = false;

    const baseRec = base as unknown as Record<string, unknown> | null;
    const oursRec = ours as unknown as Record<string, unknown>;
    const theirsRec = theirs as unknown as Record<string, unknown>;

    for (const field of allFields) {
      const baseVal = baseRec ? JSON.stringify(baseRec[field]) : undefined;
      const ourVal = JSON.stringify(oursRec[field]);
      const theirVal = JSON.stringify(theirsRec[field]);

      if (ourVal === theirVal) {
        merged[field] = oursRec[field];
      } else if (ourVal === baseVal) {
        merged[field] = theirsRec[field];
      } else if (theirVal === baseVal) {
        merged[field] = oursRec[field];
      } else {
        // Both sides changed differently → real conflict
        hasConflict = true;
        break;
      }
    }

    if (hasConflict) {
      return {
        documentId,
        collection,
        base,
        ours,
        theirs,
        autoResolved: false,
      };
    }

    return {
      documentId,
      collection,
      base,
      ours,
      theirs,
      autoResolved: true,
      resolution: merged as unknown as Document,
    };
  }

  private updateState(): void {
    this.state$.next({
      currentBranch: this.currentBranchName,
      branches: [...this.branches.keys()],
      snapshotCount: this.snapshots.size,
    });
  }

  private emitEvent(
    type: BranchEventType,
    branch: string,
    data?: Record<string, unknown>
  ): void {
    this.events$.next({ type, timestamp: Date.now(), branch, data });
  }
}

/**
 * Create a branch manager instance.
 *
 * @example
 * ```typescript
 * const manager = createBranchManager({ maxBranches: 10 });
 * ```
 */
export function createBranchManager(config?: BranchManagerConfig): BranchManager {
  return new BranchManager(config);
}

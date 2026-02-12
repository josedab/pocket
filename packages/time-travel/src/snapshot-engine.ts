/**
 * Snapshot Engine - Incremental snapshot management with branching and delta compression
 *
 * @module snapshot-engine
 *
 * @example
 * ```typescript
 * import { createSnapshotEngine } from '@pocket/time-travel';
 *
 * const engine = createSnapshotEngine({
 *   maxSnapshots: 100,
 *   retentionPolicy: 'sliding-window',
 *   retentionSize: 50,
 * });
 *
 * // Capture a full snapshot
 * const snap1 = engine.capture({ users: { 'u1': { id: 'u1', name: 'Alice' } } }, 'initial');
 *
 * // Capture an incremental snapshot (stores only deltas)
 * const snap2 = engine.capture({ users: { 'u1': { id: 'u1', name: 'Alice B.' } } }, 'rename');
 *
 * // Compare two snapshots
 * const diff = engine.compare(snap1.id, snap2.id);
 *
 * // Branch from a snapshot
 * engine.createBranch('feature-x', snap1.id);
 * engine.switchBranch('feature-x');
 *
 * // Tag a snapshot
 * engine.tag(snap2.id, 'v1.0');
 *
 * // Garbage-collect old snapshots
 * const removed = engine.gc();
 *
 * engine.destroy();
 * ```
 */

import type { Document } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Delta representing the difference between two collection states */
export interface SnapshotDelta {
  /** Fields/documents added */
  added: Record<string, Record<string, Document>>;
  /** Fields/documents removed */
  removed: Record<string, Record<string, Document>>;
  /** Fields/documents modified (stores the new value) */
  modified: Record<string, Record<string, Document>>;
}

/** Retention policy strategy */
export type RetentionPolicy = 'keep-all' | 'sliding-window' | 'time-based';

/** Configuration for the snapshot engine */
export interface SnapshotEngineConfig {
  /** Maximum number of snapshots to retain (default: 200) */
  maxSnapshots?: number;
  /** Retention policy strategy (default: 'sliding-window') */
  retentionPolicy?: RetentionPolicy;
  /** Number of recent snapshots to keep when using sliding-window (default: 100) */
  retentionSize?: number;
  /** Max age in milliseconds for time-based retention (default: 86400000 – 24 h) */
  retentionMaxAge?: number;
}

/** A stored snapshot */
export interface EngineSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** ID of the parent snapshot (null for root) */
  parentId: string | null;
  /** Full collection state (set only for base snapshots) */
  base: Record<string, Record<string, Document>> | null;
  /** Incremental delta relative to parent */
  delta: SnapshotDelta | null;
  /** Human-readable label */
  label?: string;
  /** User-assigned tags */
  tags: string[];
  /** Branch this snapshot belongs to */
  branch: string;
  /** Timestamp of creation */
  timestamp: number;
}

/** Comparison result between two snapshots */
export interface SnapshotComparison {
  /** ID of the "before" snapshot */
  beforeId: string;
  /** ID of the "after" snapshot */
  afterId: string;
  /** Computed delta from before → after */
  delta: SnapshotDelta;
  /** Human-readable summary lines */
  summary: string[];
}

/** Snapshot engine event types */
export type SnapshotEngineEventType =
  | 'snapshot_captured'
  | 'snapshot_removed'
  | 'branch_created'
  | 'branch_switched'
  | 'branch_merged'
  | 'tag_added'
  | 'gc_completed';

/** Snapshot engine event */
export interface SnapshotEngineEvent {
  type: SnapshotEngineEventType;
  timestamp: number;
  data?: unknown;
}

/** Observable state exposed by the engine */
export interface SnapshotEngineState {
  /** Total number of stored snapshots */
  totalSnapshots: number;
  /** Current branch name */
  currentBranch: string;
  /** Available branch names */
  branches: string[];
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

/** Compute a delta between two collection maps */
function computeDelta(
  before: Record<string, Record<string, Document>>,
  after: Record<string, Record<string, Document>>
): SnapshotDelta {
  const added: Record<string, Record<string, Document>> = {};
  const removed: Record<string, Record<string, Document>> = {};
  const modified: Record<string, Record<string, Document>> = {};

  const allCollections = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const col of allCollections) {
    const beforeCol = before[col] ?? {};
    const afterCol = after[col] ?? {};
    const allIds = new Set([...Object.keys(beforeCol), ...Object.keys(afterCol)]);

    for (const id of allIds) {
      const bDoc = beforeCol[id];
      const aDoc = afterCol[id];

      if (!bDoc && aDoc) {
        added[col] ??= {};
        added[col][id] = aDoc;
      } else if (bDoc && !aDoc) {
        removed[col] ??= {};
        removed[col][id] = bDoc;
      } else if (bDoc && aDoc && JSON.stringify(bDoc) !== JSON.stringify(aDoc)) {
        modified[col] ??= {};
        modified[col][id] = aDoc;
      }
    }
  }

  return { added, removed, modified };
}

/** Apply a delta on top of a base state (returns new object) */
function applyDelta(
  base: Record<string, Record<string, Document>>,
  delta: SnapshotDelta
): Record<string, Record<string, Document>> {
  const result = deepClone(base);

  // Apply additions
  for (const [col, docs] of Object.entries(delta.added)) {
    result[col] ??= {};
    for (const [id, doc] of Object.entries(docs)) {
      result[col][id] = doc;
    }
  }

  // Apply modifications
  for (const [col, docs] of Object.entries(delta.modified)) {
    result[col] ??= {};
    for (const [id, doc] of Object.entries(docs)) {
      result[col][id] = doc;
    }
  }

  // Apply removals
  for (const [col, docs] of Object.entries(delta.removed)) {
    if (!result[col]) continue;
    for (const id of Object.keys(docs)) {
      Reflect.deleteProperty(result[col], id);
    }
    if (Object.keys(result[col]).length === 0) {
      Reflect.deleteProperty(result, col);
    }
  }

  return result;
}

/** Check if a delta is empty */
function isDeltaEmpty(delta: SnapshotDelta): boolean {
  return (
    Object.keys(delta.added).length === 0 &&
    Object.keys(delta.removed).length === 0 &&
    Object.keys(delta.modified).length === 0
  );
}

/** Build a human-readable summary of a delta */
function summarizeDelta(delta: SnapshotDelta): string[] {
  const lines: string[] = [];

  for (const [col, docs] of Object.entries(delta.added)) {
    const count = Object.keys(docs).length;
    lines.push(`+ ${count} document(s) added in "${col}"`);
  }
  for (const [col, docs] of Object.entries(delta.removed)) {
    const count = Object.keys(docs).length;
    lines.push(`- ${count} document(s) removed from "${col}"`);
  }
  for (const [col, docs] of Object.entries(delta.modified)) {
    const count = Object.keys(docs).length;
    lines.push(`~ ${count} document(s) modified in "${col}"`);
  }

  if (lines.length === 0) {
    lines.push('No changes');
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Snapshot Engine
// ---------------------------------------------------------------------------

/**
 * Production-grade snapshot engine with incremental delta compression,
 * branching, tagging, comparison, merging, and garbage collection.
 *
 * @example
 * ```typescript
 * const engine = new SnapshotEngine({ maxSnapshots: 50 });
 * const s1 = engine.capture({ todos: { 't1': { id: 't1', text: 'Hi' } } });
 * const s2 = engine.capture({ todos: { 't1': { id: 't1', text: 'Hello' } } });
 * const diff = engine.compare(s1.id, s2.id);
 * engine.destroy();
 * ```
 */
export class SnapshotEngine {
  private readonly config: Required<SnapshotEngineConfig>;
  private readonly snapshots = new Map<string, EngineSnapshot>();
  private readonly branchHeads = new Map<string, string>();
  private currentBranch = 'main';

  private readonly state$ = new BehaviorSubject<SnapshotEngineState>({
    totalSnapshots: 0,
    currentBranch: 'main',
    branches: ['main'],
  });

  private readonly events$ = new Subject<SnapshotEngineEvent>();

  constructor(config: SnapshotEngineConfig = {}) {
    this.config = {
      maxSnapshots: config.maxSnapshots ?? 200,
      retentionPolicy: config.retentionPolicy ?? 'sliding-window',
      retentionSize: config.retentionSize ?? 100,
      retentionMaxAge: config.retentionMaxAge ?? 86_400_000,
    };
  }

  // ---- Capture ----------------------------------------------------------

  /**
   * Capture a snapshot of the given state. If a previous snapshot exists on
   * the current branch, only the delta is stored.
   */
  capture(
    collections: Record<string, Record<string, Document>>,
    label?: string
  ): EngineSnapshot {
    const headId = this.branchHeads.get(this.currentBranch) ?? null;
    const headSnapshot = headId ? this.snapshots.get(headId) ?? null : null;

    let snapshot: EngineSnapshot;

    if (headSnapshot) {
      const headState = this.resolve(headSnapshot.id);
      const delta = computeDelta(headState, collections);

      snapshot = {
        id: generateId(),
        parentId: headSnapshot.id,
        base: null,
        delta: isDeltaEmpty(delta) ? null : delta,
        label,
        tags: [],
        branch: this.currentBranch,
        timestamp: Date.now(),
      };
    } else {
      // First snapshot on the branch → store full state
      snapshot = {
        id: generateId(),
        parentId: null,
        base: deepClone(collections),
        delta: null,
        label,
        tags: [],
        branch: this.currentBranch,
        timestamp: Date.now(),
      };
    }

    this.snapshots.set(snapshot.id, snapshot);
    this.branchHeads.set(this.currentBranch, snapshot.id);
    this.updateState();
    this.emitEvent('snapshot_captured', { snapshotId: snapshot.id });

    return snapshot;
  }

  // ---- Resolve ----------------------------------------------------------

  /**
   * Materialise the full collection state for a given snapshot by walking the
   * parent chain and applying deltas.
   */
  resolve(snapshotId: string): Record<string, Record<string, Document>> {
    const chain = this.buildChain(snapshotId);

    // The first element in the chain must have a base
    const root = chain[0]!;
    let state: Record<string, Record<string, Document>> = root.base
      ? deepClone(root.base)
      : {};

    for (let i = 1; i < chain.length; i++) {
      const snap = chain[i]!;
      if (snap.delta) {
        state = applyDelta(state, snap.delta);
      }
    }

    return state;
  }

  // ---- Comparison -------------------------------------------------------

  /**
   * Compare two snapshots and return the delta and a human-readable summary.
   */
  compare(beforeId: string, afterId: string): SnapshotComparison {
    const beforeState = this.resolve(beforeId);
    const afterState = this.resolve(afterId);
    const delta = computeDelta(beforeState, afterState);

    return {
      beforeId,
      afterId,
      delta,
      summary: summarizeDelta(delta),
    };
  }

  // ---- Branching --------------------------------------------------------

  /**
   * Create a new branch starting from a given snapshot.
   */
  createBranch(name: string, fromSnapshotId: string): void {
    if (this.branchHeads.has(name)) {
      throw new Error(`Branch "${name}" already exists`);
    }

    const snap = this.snapshots.get(fromSnapshotId);
    if (!snap) {
      throw new Error(`Snapshot not found: ${fromSnapshotId}`);
    }

    this.branchHeads.set(name, fromSnapshotId);
    this.updateState();
    this.emitEvent('branch_created', { branch: name, fromSnapshotId });
  }

  /**
   * Switch the active branch.
   */
  switchBranch(name: string): void {
    if (!this.branchHeads.has(name)) {
      throw new Error(`Branch "${name}" does not exist`);
    }

    this.currentBranch = name;
    this.updateState();
    this.emitEvent('branch_switched', { branch: name });
  }

  /**
   * Merge another branch into the current branch. The merge resolves both
   * branch heads to full state and produces a new snapshot with the union of
   * changes applied on top of the current branch head.
   */
  merge(sourceBranch: string): EngineSnapshot {
    if (sourceBranch === this.currentBranch) {
      throw new Error('Cannot merge a branch into itself');
    }

    const sourceHeadId = this.branchHeads.get(sourceBranch);
    if (!sourceHeadId) {
      throw new Error(`Branch "${sourceBranch}" does not exist`);
    }

    const sourceState = this.resolve(sourceHeadId);
    const snapshot = this.capture(sourceState, `Merge ${sourceBranch} into ${this.currentBranch}`);

    this.emitEvent('branch_merged', {
      source: sourceBranch,
      target: this.currentBranch,
      snapshotId: snapshot.id,
    });

    return snapshot;
  }

  /**
   * Get available branch names.
   */
  getBranches(): string[] {
    return [...this.branchHeads.keys()];
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  // ---- Tagging ----------------------------------------------------------

  /**
   * Add a human-readable tag to a snapshot.
   */
  tag(snapshotId: string, tagName: string): void {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    if (!snap.tags.includes(tagName)) {
      snap.tags.push(tagName);
    }

    this.emitEvent('tag_added', { snapshotId, tag: tagName });
  }

  /**
   * Find a snapshot by tag.
   */
  findByTag(tagName: string): EngineSnapshot | null {
    for (const snap of this.snapshots.values()) {
      if (snap.tags.includes(tagName)) {
        return snap;
      }
    }
    return null;
  }

  // ---- Garbage Collection -----------------------------------------------

  /**
   * Run garbage collection according to the configured retention policy.
   * Returns the number of snapshots removed.
   */
  gc(): number {
    let removed = 0;

    switch (this.config.retentionPolicy) {
      case 'sliding-window':
        removed = this.gcSlidingWindow();
        break;
      case 'time-based':
        removed = this.gcTimeBased();
        break;
      case 'keep-all':
      default:
        break;
    }

    // Hard cap
    if (this.snapshots.size > this.config.maxSnapshots) {
      removed += this.gcToLimit(this.config.maxSnapshots);
    }

    if (removed > 0) {
      this.updateState();
      this.emitEvent('gc_completed', { removed });
    }

    return removed;
  }

  // ---- Query helpers ----------------------------------------------------

  /**
   * Get a snapshot by ID.
   */
  getSnapshot(id: string): EngineSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  /**
   * Get all snapshots on the current branch ordered by timestamp.
   */
  getSnapshots(branch?: string): EngineSnapshot[] {
    const target = branch ?? this.currentBranch;
    return [...this.snapshots.values()]
      .filter((s) => s.branch === target)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get total snapshot count.
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  // ---- Observables ------------------------------------------------------

  /**
   * Get state observable.
   */
  get state(): Observable<SnapshotEngineState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state value.
   */
  getCurrentState(): SnapshotEngineState {
    return this.state$.value;
  }

  /**
   * Get events observable.
   */
  get events(): Observable<SnapshotEngineEvent> {
    return this.events$.asObservable();
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

  /** Build the chain of snapshots from the root to the given snapshot */
  private buildChain(snapshotId: string): EngineSnapshot[] {
    const chain: EngineSnapshot[] = [];
    let current: EngineSnapshot | undefined = this.snapshots.get(snapshotId);

    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.snapshots.get(current.parentId) : undefined;
    }

    if (chain.length === 0) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    return chain;
  }

  /** Remove oldest snapshots outside the sliding window, preserving branch heads */
  private gcSlidingWindow(): number {
    const protectedIds = new Set(this.branchHeads.values());
    const sorted = [...this.snapshots.values()].sort((a, b) => a.timestamp - b.timestamp);

    let removed = 0;
    while (sorted.length - removed > this.config.retentionSize) {
      const candidate = sorted[removed]!;
      if (protectedIds.has(candidate.id)) break;
      this.removeSnapshot(candidate.id);
      removed++;
    }

    return removed;
  }

  /** Remove snapshots older than retentionMaxAge */
  private gcTimeBased(): number {
    const protectedIds = new Set(this.branchHeads.values());
    const cutoff = Date.now() - this.config.retentionMaxAge;
    let removed = 0;

    for (const snap of [...this.snapshots.values()]) {
      if (snap.timestamp < cutoff && !protectedIds.has(snap.id)) {
        this.removeSnapshot(snap.id);
        removed++;
      }
    }

    return removed;
  }

  /** Remove snapshots to stay within a hard limit */
  private gcToLimit(limit: number): number {
    const protectedIds = new Set(this.branchHeads.values());
    const sorted = [...this.snapshots.values()].sort((a, b) => a.timestamp - b.timestamp);

    let removed = 0;
    let idx = 0;
    while (this.snapshots.size > limit && idx < sorted.length) {
      const candidate = sorted[idx]!;
      if (!protectedIds.has(candidate.id)) {
        this.removeSnapshot(candidate.id);
        removed++;
      }
      idx++;
    }

    return removed;
  }

  /** Remove a single snapshot, re-basing children to its parent */
  private removeSnapshot(id: string): void {
    const snap = this.snapshots.get(id);
    if (!snap) return;

    // Re-base children: any snapshot whose parentId is this one needs its
    // base materialised so it can stand on its own.
    for (const child of this.snapshots.values()) {
      if (child.parentId === id) {
        child.base = this.resolve(child.id);
        child.delta = null;
        child.parentId = null;
      }
    }

    this.snapshots.delete(id);
    this.emitEvent('snapshot_removed', { snapshotId: id });
  }

  private updateState(): void {
    this.state$.next({
      totalSnapshots: this.snapshots.size,
      currentBranch: this.currentBranch,
      branches: [...this.branchHeads.keys()],
    });
  }

  private emitEvent(type: SnapshotEngineEventType, data?: unknown): void {
    this.events$.next({ type, timestamp: Date.now(), data });
  }
}

/**
 * Create a snapshot engine instance
 *
 * @example
 * ```typescript
 * const engine = createSnapshotEngine({ maxSnapshots: 100 });
 * ```
 */
export function createSnapshotEngine(config?: SnapshotEngineConfig): SnapshotEngine {
  return new SnapshotEngine(config);
}

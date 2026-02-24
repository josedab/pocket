/**
 * ConflictPlayground — Visual conflict logger, diff viewer, and resolution UI engine.
 *
 * Captures sync conflicts with full context, provides side-by-side diffs,
 * and enables manual field-by-field resolution with replay capability.
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface ConflictRecord {
  id: string;
  collection: string;
  documentId: string;
  localVersion: Record<string, unknown>;
  remoteVersion: Record<string, unknown>;
  baseVersion: Record<string, unknown> | null;
  strategy: string;
  resolvedVersion: Record<string, unknown> | null;
  resolvedAt: number | null;
  resolvedBy: 'auto' | 'manual' | null;
  createdAt: number;
  fieldDiffs: FieldDiff[];
}

export interface FieldDiff {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  baseValue: unknown;
  conflicting: boolean;
}

export interface ManualResolution {
  conflictId: string;
  fieldChoices: Record<string, 'local' | 'remote' | 'custom'>;
  customValues: Record<string, unknown>;
}

export interface ConflictPlaygroundStats {
  totalConflicts: number;
  resolvedConflicts: number;
  pendingConflicts: number;
  autoResolved: number;
  manuallyResolved: number;
}

export type ConflictPlaygroundEvent =
  | { type: 'conflict:recorded'; conflict: ConflictRecord }
  | { type: 'conflict:resolved'; conflictId: string; method: 'auto' | 'manual' }
  | { type: 'conflict:replayed'; conflictId: string };

// ── Implementation ────────────────────────────────────────

export class ConflictPlayground {
  private readonly conflicts = new Map<string, ConflictRecord>();
  private readonly eventsSubject = new Subject<ConflictPlaygroundEvent>();
  private readonly conflictsSubject: BehaviorSubject<ConflictRecord[]>;
  private conflictCounter = 0;

  readonly events$: Observable<ConflictPlaygroundEvent> = this.eventsSubject.asObservable();
  readonly conflicts$: Observable<ConflictRecord[]>;

  constructor() {
    this.conflictsSubject = new BehaviorSubject<ConflictRecord[]>([]);
    this.conflicts$ = this.conflictsSubject.asObservable();
  }

  /**
   * Record a new sync conflict.
   */
  recordConflict(
    collection: string,
    documentId: string,
    localVersion: Record<string, unknown>,
    remoteVersion: Record<string, unknown>,
    baseVersion: Record<string, unknown> | null = null,
    strategy = 'last-write-wins'
  ): ConflictRecord {
    const id = `conflict_${++this.conflictCounter}_${Date.now()}`;
    const fieldDiffs = this.computeFieldDiffs(localVersion, remoteVersion, baseVersion);

    const record: ConflictRecord = {
      id,
      collection,
      documentId,
      localVersion,
      remoteVersion,
      baseVersion,
      strategy,
      resolvedVersion: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: Date.now(),
      fieldDiffs,
    };

    this.conflicts.set(id, record);
    this.emitUpdate();
    this.eventsSubject.next({ type: 'conflict:recorded', conflict: record });
    return record;
  }

  /**
   * Get a conflict by ID.
   */
  getConflict(id: string): ConflictRecord | undefined {
    return this.conflicts.get(id);
  }

  /**
   * List all conflicts, optionally filtered by collection.
   */
  listConflicts(collection?: string): ConflictRecord[] {
    const all = [...this.conflicts.values()];
    if (collection) return all.filter((c) => c.collection === collection);
    return all;
  }

  /**
   * List only unresolved conflicts.
   */
  listPending(): ConflictRecord[] {
    return [...this.conflicts.values()].filter((c) => c.resolvedVersion === null);
  }

  /**
   * Auto-resolve a conflict using the specified strategy.
   */
  autoResolve(
    conflictId: string,
    strategy: 'local-wins' | 'remote-wins' | 'merge'
  ): Record<string, unknown> | null {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return null;

    let resolved: Record<string, unknown>;
    switch (strategy) {
      case 'local-wins':
        resolved = { ...conflict.localVersion };
        break;
      case 'remote-wins':
        resolved = { ...conflict.remoteVersion };
        break;
      case 'merge':
        resolved = this.deepMerge(conflict.localVersion, conflict.remoteVersion);
        break;
    }

    conflict.resolvedVersion = resolved;
    conflict.resolvedAt = Date.now();
    conflict.resolvedBy = 'auto';
    this.emitUpdate();
    this.eventsSubject.next({ type: 'conflict:resolved', conflictId, method: 'auto' });
    return resolved;
  }

  /**
   * Manually resolve a conflict with field-by-field choices.
   */
  manualResolve(resolution: ManualResolution): Record<string, unknown> | null {
    const conflict = this.conflicts.get(resolution.conflictId);
    if (!conflict) return null;

    const resolved: Record<string, unknown> = {};
    const allFields = new Set([
      ...Object.keys(conflict.localVersion),
      ...Object.keys(conflict.remoteVersion),
    ]);

    for (const field of allFields) {
      if (field.startsWith('_')) {
        resolved[field] = conflict.localVersion[field] ?? conflict.remoteVersion[field];
        continue;
      }

      const choice = resolution.fieldChoices[field] ?? 'local';
      switch (choice) {
        case 'local':
          resolved[field] = conflict.localVersion[field];
          break;
        case 'remote':
          resolved[field] = conflict.remoteVersion[field];
          break;
        case 'custom':
          resolved[field] = resolution.customValues[field];
          break;
      }
    }

    conflict.resolvedVersion = resolved;
    conflict.resolvedAt = Date.now();
    conflict.resolvedBy = 'manual';
    this.emitUpdate();
    this.eventsSubject.next({
      type: 'conflict:resolved',
      conflictId: resolution.conflictId,
      method: 'manual',
    });
    return resolved;
  }

  /**
   * Replay a resolved conflict (reset to unresolved).
   */
  replay(conflictId: string): boolean {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return false;

    conflict.resolvedVersion = null;
    conflict.resolvedAt = null;
    conflict.resolvedBy = null;
    this.emitUpdate();
    this.eventsSubject.next({ type: 'conflict:replayed', conflictId });
    return true;
  }

  /**
   * Get conflict statistics.
   */
  getStats(): ConflictPlaygroundStats {
    const all = [...this.conflicts.values()];
    return {
      totalConflicts: all.length,
      resolvedConflicts: all.filter((c) => c.resolvedVersion !== null).length,
      pendingConflicts: all.filter((c) => c.resolvedVersion === null).length,
      autoResolved: all.filter((c) => c.resolvedBy === 'auto').length,
      manuallyResolved: all.filter((c) => c.resolvedBy === 'manual').length,
    };
  }

  /**
   * Export all conflicts as JSON for debugging.
   */
  exportConflicts(): string {
    return JSON.stringify([...this.conflicts.values()], null, 2);
  }

  /**
   * Clear all conflict records.
   */
  clear(): void {
    this.conflicts.clear();
    this.emitUpdate();
  }

  destroy(): void {
    this.eventsSubject.complete();
    this.conflictsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private computeFieldDiffs(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
    base: Record<string, unknown> | null
  ): FieldDiff[] {
    const diffs: FieldDiff[] = [];
    const allFields = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const field of allFields) {
      if (field.startsWith('_')) continue;
      const lv = local[field];
      const rv = remote[field];
      const bv = base?.[field];

      diffs.push({
        field,
        localValue: lv,
        remoteValue: rv,
        baseValue: bv,
        conflicting: JSON.stringify(lv) !== JSON.stringify(rv),
      });
    }

    return diffs;
  }

  private deepMerge(
    local: Record<string, unknown>,
    remote: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...local };
    for (const [key, value] of Object.entries(remote)) {
      if (!(key in result) || result[key] === undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private emitUpdate(): void {
    this.conflictsSubject.next([...this.conflicts.values()]);
  }
}

export function createConflictPlayground(): ConflictPlayground {
  return new ConflictPlayground();
}

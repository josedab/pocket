/**
 * Conflict resolution for concurrent document edits.
 *
 * Supports multiple strategies including last-write-wins, first-write-wins,
 * field-level merge, and custom resolver functions.
 */

import type { DocumentChange } from './types.js';

export type ConflictStrategy = 'last-write-wins' | 'first-write-wins' | 'merge' | 'custom';

export interface ConflictInfo {
  documentId: string;
  localChange: DocumentChange;
  remoteChange: DocumentChange;
  timestamp: number;
}

export interface ConflictResolution {
  resolvedDocument: Record<string, unknown>;
  strategy: ConflictStrategy;
  conflictsResolved: number;
}

export type CustomResolverFn = (conflict: ConflictInfo) => ConflictResolution;

/**
 * CollabConflictResolver — resolves concurrent edits using pluggable strategies.
 *
 * The default `merge` strategy performs field-level merging: fields modified
 * only by one side are accepted, while conflicting fields fall back to
 * last-write-wins.
 */
export class CollabConflictResolver {
  private readonly strategy: ConflictStrategy;
  private readonly customResolver?: CustomResolverFn;

  constructor(strategy: ConflictStrategy = 'merge', customResolver?: CustomResolverFn) {
    if (strategy === 'custom' && !customResolver) {
      throw new Error('A customResolver function is required when using the "custom" strategy');
    }
    this.strategy = strategy;
    this.customResolver = customResolver;
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Resolve a single conflict between a local and remote change.
   */
  resolve(conflict: ConflictInfo): ConflictResolution {
    switch (this.strategy) {
      case 'last-write-wins':
        return this.resolveLastWriteWins(conflict);
      case 'first-write-wins':
        return this.resolveFirstWriteWins(conflict);
      case 'merge':
        return this.resolveMerge(conflict);
      case 'custom':
        return this.customResolver!(conflict);
    }
  }

  /**
   * Detect conflicts between two arrays of changes on the same document.
   * Two changes conflict when their operations touch overlapping field paths.
   */
  detectConflicts(
    localChanges: DocumentChange[],
    remoteChanges: DocumentChange[],
  ): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];

    for (const local of localChanges) {
      for (const remote of remoteChanges) {
        if (local.documentId !== remote.documentId) continue;

        const localPaths = new Set(local.operations.map((op) => op.path));
        const hasOverlap = remote.operations.some((op) => localPaths.has(op.path));

        if (hasOverlap) {
          conflicts.push({
            documentId: local.documentId,
            localChange: local,
            remoteChange: remote,
            timestamp: Date.now(),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Three-way merge of two document states against an optional common base.
   *
   * Fields present only in `local` or only in `remote` are accepted as-is.
   * Fields modified in both sides fall back to last-write-wins by comparing
   * values (remote wins when values differ and no base is provided).
   */
  mergeDocuments(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
    base?: Record<string, unknown>,
  ): Record<string, unknown> {
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const merged: Record<string, unknown> = {};
    const baseDoc = base ?? {};

    for (const key of allKeys) {
      const inLocal = key in local;
      const inRemote = key in remote;
      const inBase = key in baseDoc;

      if (inLocal && !inRemote) {
        // Only local has this field
        merged[key] = local[key];
      } else if (!inLocal && inRemote) {
        // Only remote has this field
        merged[key] = remote[key];
      } else if (inLocal && inRemote) {
        const localVal = local[key];
        const remoteVal = remote[key];

        if (deepEqual(localVal, remoteVal)) {
          // No conflict — values are identical
          merged[key] = localVal;
        } else if (inBase && deepEqual(baseDoc[key], localVal)) {
          // Local unchanged from base — take remote
          merged[key] = remoteVal;
        } else if (inBase && deepEqual(baseDoc[key], remoteVal)) {
          // Remote unchanged from base — take local
          merged[key] = localVal;
        } else {
          // True conflict — remote wins (LWW fallback)
          merged[key] = remoteVal;
        }
      }
    }

    return merged;
  }

  // ── Private strategies ──────────────────────────────────

  private resolveLastWriteWins(conflict: ConflictInfo): ConflictResolution {
    const winner =
      conflict.localChange.timestamp >= conflict.remoteChange.timestamp
        ? conflict.localChange
        : conflict.remoteChange;

    return {
      resolvedDocument: operationsToDocument(winner.operations),
      strategy: 'last-write-wins',
      conflictsResolved: 1,
    };
  }

  private resolveFirstWriteWins(conflict: ConflictInfo): ConflictResolution {
    const winner =
      conflict.localChange.timestamp <= conflict.remoteChange.timestamp
        ? conflict.localChange
        : conflict.remoteChange;

    return {
      resolvedDocument: operationsToDocument(winner.operations),
      strategy: 'first-write-wins',
      conflictsResolved: 1,
    };
  }

  private resolveMerge(conflict: ConflictInfo): ConflictResolution {
    const localDoc = operationsToDocument(conflict.localChange.operations);
    const remoteDoc = operationsToDocument(conflict.remoteChange.operations);
    const resolvedDocument = this.mergeDocuments(localDoc, remoteDoc);

    return {
      resolvedDocument,
      strategy: 'merge',
      conflictsResolved: 1,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a flat document from a list of `set` operations.
 */
function operationsToDocument(
  operations: DocumentChange['operations'],
): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const op of operations) {
    if (op.type === 'set') {
      doc[op.path] = op.value;
    }
  }
  return doc;
}

/**
 * Simple deep equality check for JSON-compatible values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, (b as unknown[])[i]));
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/**
 * Create a new CollabConflictResolver.
 */
export function createConflictResolver(
  strategy: ConflictStrategy = 'merge',
  customResolver?: CustomResolverFn,
): CollabConflictResolver {
  return new CollabConflictResolver(strategy, customResolver);
}

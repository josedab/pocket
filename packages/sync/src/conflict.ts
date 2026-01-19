import type { Document, DocumentConflict } from '@pocket/core';
import { VectorClockUtil } from '@pocket/core';

/**
 * Conflict resolution strategies
 */
export type ConflictStrategy = 'server-wins' | 'client-wins' | 'last-write-wins' | 'merge';

/**
 * Conflict resolution result
 */
export interface ConflictResolution<T extends Document> {
  /** Resolved document */
  document: T;
  /** Winner of the conflict */
  winner: 'local' | 'remote' | 'merged';
  /** Whether manual resolution is needed */
  needsManualResolution: boolean;
}

/**
 * Custom merge function type
 */
export type MergeFunction<T extends Document> = (local: T, remote: T, base?: T) => T;

/**
 * Conflict resolver class
 */
export class ConflictResolver<T extends Document> {
  private readonly strategy: ConflictStrategy;
  private readonly customMerge?: MergeFunction<T>;

  constructor(strategy: ConflictStrategy, customMerge?: MergeFunction<T>) {
    this.strategy = strategy;
    this.customMerge = customMerge;
  }

  /**
   * Resolve a conflict between local and remote documents
   */
  resolve(conflict: DocumentConflict<T>): ConflictResolution<T> {
    const { localDocument, remoteDocument, baseDocument } = conflict;

    switch (this.strategy) {
      case 'server-wins':
        return {
          document: remoteDocument,
          winner: 'remote',
          needsManualResolution: false,
        };

      case 'client-wins':
        return {
          document: localDocument,
          winner: 'local',
          needsManualResolution: false,
        };

      case 'last-write-wins':
        return this.resolveLastWriteWins(localDocument, remoteDocument);

      case 'merge':
        return this.resolveMerge(localDocument, remoteDocument, baseDocument);

      default:
        return {
          document: remoteDocument,
          winner: 'remote',
          needsManualResolution: false,
        };
    }
  }

  /**
   * Resolve using last-write-wins strategy
   */
  private resolveLastWriteWins(local: T, remote: T): ConflictResolution<T> {
    const localTime = local._updatedAt ?? 0;
    const remoteTime = remote._updatedAt ?? 0;

    if (localTime > remoteTime) {
      return {
        document: local,
        winner: 'local',
        needsManualResolution: false,
      };
    } else if (remoteTime > localTime) {
      return {
        document: remote,
        winner: 'remote',
        needsManualResolution: false,
      };
    }

    // Same timestamp - use vector clock or fall back to server-wins
    if (local._vclock && remote._vclock) {
      const comparison = VectorClockUtil.compare(local._vclock, remote._vclock);
      if (comparison === 1) {
        return {
          document: local,
          winner: 'local',
          needsManualResolution: false,
        };
      }
    }

    return {
      document: remote,
      winner: 'remote',
      needsManualResolution: false,
    };
  }

  /**
   * Resolve using merge strategy
   */
  private resolveMerge(local: T, remote: T, base?: T): ConflictResolution<T> {
    // Use custom merge if provided
    if (this.customMerge) {
      const merged = this.customMerge(local, remote, base);
      return {
        document: merged,
        winner: 'merged',
        needsManualResolution: false,
      };
    }

    // Default field-by-field merge
    const merged = this.defaultMerge(local, remote, base);

    return {
      document: merged,
      winner: 'merged',
      needsManualResolution: false,
    };
  }

  /**
   * Default field-by-field merge
   */
  private defaultMerge(local: T, remote: T, base?: T): T {
    const result: Record<string, unknown> = { ...(remote as unknown as Record<string, unknown>) };

    // Get all keys from both documents
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const key of allKeys) {
      // Skip internal fields
      if (key.startsWith('_')) continue;

      const localValue = (local as Record<string, unknown>)[key];
      const remoteValue = (remote as Record<string, unknown>)[key];
      const baseValue = base ? (base as Record<string, unknown>)[key] : undefined;

      // If only one side changed from base, use that change
      if (base) {
        const localChanged = !deepEqual(localValue, baseValue);
        const remoteChanged = !deepEqual(remoteValue, baseValue);

        if (localChanged && !remoteChanged) {
          result[key] = localValue;
          continue;
        }

        if (remoteChanged && !localChanged) {
          result[key] = remoteValue;
          continue;
        }
      }

      // Both changed - use last-write-wins for this field
      const localTime = local._updatedAt ?? 0;
      const remoteTime = remote._updatedAt ?? 0;

      if (localTime > remoteTime) {
        result[key] = localValue;
      } else {
        result[key] = remoteValue;
      }
    }

    // Merge vector clocks
    if (local._vclock && remote._vclock) {
      result._vclock = VectorClockUtil.merge(local._vclock, remote._vclock);
    }

    // Update timestamp
    result._updatedAt = Date.now();

    return result as T;
  }
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }

  return false;
}

/**
 * Revision format: sequence-hash (e.g., "1-abc123", "42-def456")
 */
const REVISION_PATTERN = /^(\d+)-([a-zA-Z0-9]+)$/;

/**
 * Parse a revision string safely, returning null for invalid formats
 * @param rev - The revision string to parse
 * @returns Parsed revision with sequence and hash, or null if invalid
 */
function parseRevision(rev: string | undefined): { sequence: number; hash: string } | null {
  if (!rev) return null;

  const match = REVISION_PATTERN.exec(rev);
  if (!match) return null;

  const sequence = parseInt(match[1]!, 10);
  // Validate that sequence is a reasonable number (not NaN, not too large)
  if (isNaN(sequence) || sequence < 0 || sequence > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return { sequence, hash: match[2]! };
}

/**
 * Detect if two documents have a conflict
 */
export function detectConflict<T extends Document>(local: T, remote: T): boolean {
  // Same revision - no conflict
  if (local._rev === remote._rev) return false;

  // Check vector clocks
  if (local._vclock && remote._vclock) {
    const comparison = VectorClockUtil.compare(local._vclock, remote._vclock);
    // Concurrent (neither happened before the other)
    return comparison === 0;
  }

  // One has revision and the other doesn't = conflict
  if ((local._rev && !remote._rev) || (!local._rev && remote._rev)) {
    return true;
  }

  // No vector clocks - check if different revisions with same base
  const localRev = parseRevision(local._rev);
  const remoteRev = parseRevision(remote._rev);

  // If either revision is invalid format, assume no conflict (let application handle)
  if (!localRev || !remoteRev) {
    return false;
  }

  // Same sequence number but different revision = conflict
  return localRev.sequence === remoteRev.sequence && local._rev !== remote._rev;
}

import type { Document, DocumentConflict } from '@pocket/core';
import { VectorClockUtil } from '@pocket/core';

/**
 * Available strategies for resolving sync conflicts.
 *
 * When the same document is modified both locally and remotely,
 * a conflict occurs. The strategy determines how to resolve it:
 *
 * - `'server-wins'`: Always use the server's version
 * - `'client-wins'`: Always use the client's version
 * - `'last-write-wins'`: Use whichever version was modified most recently
 * - `'merge'`: Attempt to merge changes field-by-field
 *
 * @see {@link ConflictResolver}
 * @see {@link SyncConfig.conflictStrategy}
 */
export type ConflictStrategy = 'server-wins' | 'client-wins' | 'last-write-wins' | 'merge';

/**
 * Result of resolving a conflict between document versions.
 *
 * @typeParam T - The document type
 */
export interface ConflictResolution<T extends Document> {
  /** The resolved document to be saved */
  document: T;

  /** Which version was chosen as the winner */
  winner: 'local' | 'remote' | 'merged';

  /** Whether the conflict requires user intervention to resolve */
  needsManualResolution: boolean;
}

/**
 * Custom function type for merging conflicting documents.
 *
 * @typeParam T - The document type
 * @param local - The local version of the document
 * @param remote - The remote version of the document
 * @param base - The common ancestor (if known)
 * @returns The merged document
 *
 * @example
 * ```typescript
 * const customMerge: MergeFunction<Todo> = (local, remote, base) => {
 *   // Custom logic: prefer local title, remote completion status
 *   return {
 *     ...remote,
 *     title: local.title,
 *     completed: remote.completed,
 *     _updatedAt: Date.now()
 *   };
 * };
 * ```
 */
export type MergeFunction<T extends Document> = (local: T, remote: T, base?: T) => T;

/**
 * Resolves conflicts between local and remote document versions.
 *
 * The ConflictResolver applies the configured strategy to determine
 * which version of a document should be kept when both have been modified.
 *
 * @typeParam T - The document type
 *
 * @example Using built-in strategies
 * ```typescript
 * const resolver = new ConflictResolver<Todo>('last-write-wins');
 *
 * const result = resolver.resolve({
 *   documentId: 'todo-123',
 *   localDocument: localTodo,
 *   remoteDocument: remoteTodo,
 *   timestamp: Date.now()
 * });
 *
 * if (result.winner === 'local') {
 *   console.log('Local changes preserved');
 * }
 * ```
 *
 * @example Using custom merge function
 * ```typescript
 * const customMerge: MergeFunction<User> = (local, remote) => ({
 *   ...remote,
 *   preferences: local.preferences, // Prefer local preferences
 *   profile: remote.profile          // Prefer remote profile
 * });
 *
 * const resolver = new ConflictResolver<User>('merge', customMerge);
 * ```
 *
 * @see {@link ConflictStrategy}
 * @see {@link ConflictResolution}
 */
export class ConflictResolver<T extends Document> {
  private readonly strategy: ConflictStrategy;
  private readonly customMerge?: MergeFunction<T>;

  constructor(strategy: ConflictStrategy, customMerge?: MergeFunction<T>) {
    this.strategy = strategy;
    this.customMerge = customMerge;
  }

  /**
   * Resolve a conflict between local and remote document versions.
   *
   * @param conflict - The conflict details including both versions
   * @returns Resolution result with the winning document
   *
   * @example
   * ```typescript
   * const result = resolver.resolve({
   *   documentId: 'doc-123',
   *   localDocument: localDoc,
   *   remoteDocument: remoteDoc,
   *   baseDocument: ancestorDoc, // Optional
   *   timestamp: Date.now()
   * });
   *
   * console.log(`Winner: ${result.winner}`);
   * await collection.applyRemoteChange({
   *   operation: 'update',
   *   document: result.document,
   *   ...
   * });
   * ```
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
 * Detect if two document versions are in conflict.
 *
 * Conflicts occur when both versions have been modified independently
 * (concurrent edits). This function uses:
 * 1. Revision strings to detect same-base divergence
 * 2. Vector clocks (if present) for precise causality tracking
 *
 * @typeParam T - The document type
 * @param local - The local version of the document
 * @param remote - The remote version of the document
 * @returns `true` if the documents are in conflict, `false` otherwise
 *
 * @example
 * ```typescript
 * const localDoc = await collection.get('doc-123');
 * const remoteDoc = changeFromServer.document;
 *
 * if (detectConflict(localDoc, remoteDoc)) {
 *   const resolution = conflictResolver.resolve({
 *     documentId: 'doc-123',
 *     localDocument: localDoc,
 *     remoteDocument: remoteDoc,
 *     timestamp: Date.now()
 *   });
 *   // Apply resolution...
 * }
 * ```
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

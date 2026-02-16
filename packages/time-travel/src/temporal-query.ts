/**
 * Temporal Query Language for Pocket Time Travel
 *
 * Provides SQL-like temporal operators for querying historical data states.
 * Enables `asOf`, `between`, `versions`, and `changes` queries.
 *
 * @module temporal-query
 *
 * @example
 * ```typescript
 * import { createTemporalQueryEngine } from '@pocket/time-travel';
 *
 * const engine = createTemporalQueryEngine(
 *   () => tracker.getHistory(),
 *   () => tracker.getCheckpoints(),
 *   { maxResults: 100, enableCache: true },
 * );
 *
 * // Query collection state at a specific timestamp
 * const result = engine.asOf('todos', Date.now() - 60_000);
 * console.log(result.documents);
 *
 * // Get all versions of a document
 * const versions = engine.versions('todos', 'todo-1');
 *
 * // Compare a document between two points in time
 * const diff = engine.diff('todos', 'todo-1', timestampA, timestampB);
 *
 * // Reactive query that re-evaluates when timestamp changes
 * const result$ = engine.asOf$('todos', timestamp$);
 *
 * engine.dispose();
 * ```
 */

import type { Document } from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import type { ChangeOperation, HistoryEntry, Snapshot } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the temporal query engine */
export interface TemporalQueryConfig {
  /** Maximum results per query */
  maxResults?: number;
  /** Enable caching of temporal query results */
  enableCache?: boolean;
  /** Cache TTL in ms */
  cacheTtlMs?: number;
}

/** Result of a temporal query */
export interface TemporalQueryResult<T extends Document = Document> {
  /** Documents matching the query */
  documents: T[];
  /** Timestamp the query was evaluated at */
  timestamp: number;
  /** Type of temporal query that produced this result */
  queryType: 'asOf' | 'between' | 'versions' | 'changes' | 'diff';
  /** Wall-clock execution time in milliseconds */
  executionTimeMs: number;
  /** Metadata about the query result */
  metadata: { totalVersions: number; matchedDocuments: number };
}

/** Version information for a single document */
export interface VersionInfo<T extends Document = Document> {
  /** Monotonically increasing version number */
  version: number;
  /** Document state at this version */
  document: T;
  /** Timestamp of this version */
  timestamp: number;
  /** Operation that produced this version */
  operation: 'create' | 'update' | 'delete';
  /** Optional identifier of the actor that made the change */
  changeBy?: string;
}

/** Diff between a document at two points in time */
export interface TemporalDiff<T extends Document = Document> {
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
  /** State at the earlier timestamp */
  from: { timestamp: number; document: T | null };
  /** State at the later timestamp */
  to: { timestamp: number; document: T | null };
  /** Top-level field names that changed */
  fieldsChanged: string[];
  /** Total number of field-level changes */
  changeCount: number;
}

/** A time range defined by start and end boundaries */
export interface TemporalRange {
  /** Inclusive start of the range */
  start: number | Date;
  /** Inclusive end of the range */
  end: number | Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TemporalQueryEngine
// ---------------------------------------------------------------------------

/**
 * Enables SQL-like temporal queries over the time-travel history.
 *
 * Rather than owning the data, the engine receives two provider functions
 * that return the current history entries and snapshots, keeping it fully
 * decoupled from the storage layer.
 *
 * @example
 * ```typescript
 * const engine = new TemporalQueryEngine(
 *   () => tracker.getHistory(),
 *   () => tracker.getCheckpoints(),
 * );
 *
 * const result = engine.asOf('users', Date.now() - 30_000);
 * console.log(result.documents);
 *
 * engine.dispose();
 * ```
 */
export class TemporalQueryEngine {
  private readonly config: Required<TemporalQueryConfig>;
  private readonly cache = new Map<string, { result: unknown; expiresAt: number }>();
  private readonly disposed$ = new Subject<void>();

  constructor(
    private readonly entriesProvider: () => HistoryEntry[],
    readonly snapshotsProvider: () => Snapshot[],
    config: TemporalQueryConfig = {}
  ) {
    this.config = {
      maxResults: config.maxResults ?? 1000,
      enableCache: config.enableCache ?? false,
      cacheTtlMs: config.cacheTtlMs ?? 5000,
    };
  }

  // ---- asOf --------------------------------------------------------------

  /**
   * Reconstruct the state of an entire collection at a specific point in time.
   *
   * @example
   * ```typescript
   * const result = engine.asOf('todos', new Date('2024-01-01'));
   * for (const doc of result.documents) {
   *   console.log(doc.id);
   * }
   * ```
   */
  asOf<T extends Document = Document>(
    collection: string,
    timestamp: number | Date
  ): TemporalQueryResult<T> {
    const start = performance.now();
    const ts = this.normalizeTimestamp(timestamp);

    const cacheKey = this.getCacheKey('asOf', collection, ts);
    const cached = this.getFromCache<TemporalQueryResult<T>>(cacheKey);
    if (cached) return cached;

    const state = this.reconstructState<T>(collection, ts);
    const documents = [...state.values()].slice(0, this.config.maxResults);

    const result: TemporalQueryResult<T> = {
      documents,
      timestamp: ts,
      queryType: 'asOf',
      executionTimeMs: performance.now() - start,
      metadata: {
        totalVersions: this.countVersions(collection),
        matchedDocuments: documents.length,
      },
    };

    this.setCache(cacheKey, result);
    return result;
  }

  // ---- asOfDocument ------------------------------------------------------

  /**
   * Get a single document's state at a specific point in time.
   *
   * @returns The document state, or `null` if it did not exist at that time.
   *
   * @example
   * ```typescript
   * const todo = engine.asOfDocument('todos', 'todo-1', Date.now() - 60_000);
   * ```
   */
  asOfDocument<T extends Document = Document>(
    collection: string,
    documentId: string,
    timestamp: number | Date
  ): T | null {
    const ts = this.normalizeTimestamp(timestamp);
    const state = this.reconstructState<T>(collection, ts);
    return state.get(documentId) ?? null;
  }

  // ---- between -----------------------------------------------------------

  /**
   * Get all document states that existed during a time range.
   *
   * Returns the union of documents that were present at any point within the
   * range, resolved to their latest state before `range.end`.
   *
   * @example
   * ```typescript
   * const result = engine.between('todos', {
   *   start: Date.now() - 120_000,
   *   end: Date.now(),
   * });
   * ```
   */
  between<T extends Document = Document>(
    collection: string,
    range: TemporalRange
  ): TemporalQueryResult<T> {
    const start = performance.now();
    const rangeStart = this.normalizeTimestamp(range.start);
    const rangeEnd = this.normalizeTimestamp(range.end);

    const cacheKey = this.getCacheKey('between', collection, rangeStart, rangeEnd);
    const cached = this.getFromCache<TemporalQueryResult<T>>(cacheKey);
    if (cached) return cached;

    const seen = new Map<string, T>();
    const entries = this.entriesProvider();

    for (const entry of entries) {
      if (entry.timestamp < rangeStart || entry.timestamp > rangeEnd) continue;

      for (const op of entry.operations) {
        if (op.collection !== collection) continue;

        if (op.type === 'delete') {
          seen.delete(op.documentId);
        } else if (op.after) {
          seen.set(op.documentId, op.after as T);
        }
      }
    }

    // Also include documents that existed before the range but were not touched
    const stateAtStart = this.reconstructState<T>(collection, rangeStart);
    for (const [id, doc] of stateAtStart) {
      if (!seen.has(id)) {
        seen.set(id, doc);
      }
    }

    const documents = [...seen.values()].slice(0, this.config.maxResults);

    const result: TemporalQueryResult<T> = {
      documents,
      timestamp: rangeEnd,
      queryType: 'between',
      executionTimeMs: performance.now() - start,
      metadata: {
        totalVersions: this.countVersions(collection),
        matchedDocuments: documents.length,
      },
    };

    this.setCache(cacheKey, result);
    return result;
  }

  // ---- versions ----------------------------------------------------------

  /**
   * Get all versions of a specific document, ordered from oldest to newest.
   *
   * @example
   * ```typescript
   * const versions = engine.versions('todos', 'todo-1', { limit: 10 });
   * for (const v of versions) {
   *   console.log(`v${v.version} at ${v.timestamp}: ${v.operation}`);
   * }
   * ```
   */
  versions<T extends Document = Document>(
    collection: string,
    documentId: string,
    options: { limit?: number; since?: number } = {}
  ): VersionInfo<T>[] {
    const entries = this.entriesProvider();
    const result: VersionInfo<T>[] = [];
    let version = 0;

    for (const entry of entries) {
      if (options.since !== undefined && entry.timestamp < options.since) continue;

      for (const op of entry.operations) {
        if (op.collection !== collection || op.documentId !== documentId) continue;

        version++;
        result.push({
          version,
          document: (op.type === 'delete' ? op.before : op.after) as T,
          timestamp: op.timestamp,
          operation: op.type,
          changeBy: op.metadata?.changedBy as string | undefined,
        });
      }
    }

    const limit = options.limit ?? this.config.maxResults;
    return result.slice(0, limit);
  }

  // ---- changes -----------------------------------------------------------

  /**
   * Get all change operations within a time range, optionally filtered by
   * document ID.
   *
   * @example
   * ```typescript
   * const ops = engine.changes('todos', {
   *   start: Date.now() - 300_000,
   *   end: Date.now(),
   * });
   * ```
   */
  changes(
    collection: string,
    range: TemporalRange,
    options: { documentId?: string } = {}
  ): ChangeOperation[] {
    const rangeStart = this.normalizeTimestamp(range.start);
    const rangeEnd = this.normalizeTimestamp(range.end);
    const entries = this.entriesProvider();
    const result: ChangeOperation[] = [];

    for (const entry of entries) {
      if (entry.timestamp < rangeStart || entry.timestamp > rangeEnd) continue;

      for (const op of entry.operations) {
        if (op.collection !== collection) continue;
        if (options.documentId && op.documentId !== options.documentId) continue;

        result.push(op);
      }
    }

    return result.slice(0, this.config.maxResults);
  }

  // ---- diff --------------------------------------------------------------

  /**
   * Compare a document between two points in time.
   *
   * @example
   * ```typescript
   * const diff = engine.diff('todos', 'todo-1', timestampA, timestampB);
   * console.log(diff.fieldsChanged);
   * ```
   */
  diff<T extends Document = Document>(
    collection: string,
    documentId: string,
    timestampA: number,
    timestampB: number
  ): TemporalDiff<T> {
    const docA = this.asOfDocument<T>(collection, documentId, timestampA);
    const docB = this.asOfDocument<T>(collection, documentId, timestampB);

    const fieldsChanged: string[] = [];

    if (docA && docB) {
      const allKeys = new Set([...Object.keys(docA), ...Object.keys(docB)]);
      for (const key of allKeys) {
        const valA = (docA as Record<string, unknown>)[key];
        const valB = (docB as Record<string, unknown>)[key];
        if (JSON.stringify(valA) !== JSON.stringify(valB)) {
          fieldsChanged.push(key);
        }
      }
    } else if (docA) {
      fieldsChanged.push(...Object.keys(docA));
    } else if (docB) {
      fieldsChanged.push(...Object.keys(docB));
    }

    return {
      documentId,
      collection,
      from: { timestamp: timestampA, document: docA },
      to: { timestamp: timestampB, document: docB },
      fieldsChanged,
      changeCount: fieldsChanged.length,
    };
  }

  // ---- Counting helpers --------------------------------------------------

  /**
   * Count the total number of versions for a collection, or a single document.
   *
   * @example
   * ```typescript
   * const total = engine.countVersions('todos');
   * const docVersions = engine.countVersions('todos', 'todo-1');
   * ```
   */
  countVersions(collection: string, documentId?: string): number {
    const entries = this.entriesProvider();
    let count = 0;

    for (const entry of entries) {
      for (const op of entry.operations) {
        if (op.collection !== collection) continue;
        if (documentId && op.documentId !== documentId) continue;
        count++;
      }
    }

    return count;
  }

  /**
   * Get the most recent change operation in a collection.
   *
   * @example
   * ```typescript
   * const latest = engine.getLatestChange('todos');
   * if (latest) console.log(latest.type, latest.documentId);
   * ```
   */
  getLatestChange(collection: string): ChangeOperation | null {
    const entries = this.entriesProvider();
    let latest: ChangeOperation | null = null;

    for (const entry of entries) {
      for (const op of entry.operations) {
        if (op.collection !== collection) continue;
        if (!latest || op.timestamp > latest.timestamp) {
          latest = op;
        }
      }
    }

    return latest;
  }

  // ---- Reactive ----------------------------------------------------------

  /**
   * Create a live reactive temporal query that re-evaluates every time the
   * provided timestamp observable emits.
   *
   * @example
   * ```typescript
   * const timestamp$ = new BehaviorSubject(Date.now() - 60_000);
   * const result$ = engine.asOf$('todos', timestamp$);
   *
   * result$.subscribe((result) => {
   *   console.log('Documents at timestamp:', result.documents.length);
   * });
   *
   * // Slide the temporal window forward
   * timestamp$.next(Date.now());
   * ```
   */
  asOf$(collection: string, timestamp$: Observable<number>): Observable<TemporalQueryResult> {
    const result$ = new Subject<TemporalQueryResult>();

    const subscription = timestamp$.subscribe({
      next: (ts) => {
        const queryResult = this.asOf(collection, ts);
        result$.next(queryResult);
      },
      error: (err) => result$.error(err),
      complete: () => result$.complete(),
    });

    this.disposed$.subscribe(() => {
      subscription.unsubscribe();
      result$.complete();
    });

    return result$.asObservable();
  }

  // ---- Lifecycle ---------------------------------------------------------

  /**
   * Clean up resources and invalidate the cache.
   */
  dispose(): void {
    this.cache.clear();
    this.disposed$.next();
    this.disposed$.complete();
  }

  // ---- Private helpers ---------------------------------------------------

  /** Convert a Date or number to a numeric timestamp */
  private normalizeTimestamp(ts: number | Date): number {
    return ts instanceof Date ? ts.getTime() : ts;
  }

  /**
   * Replay all operations up to `upToTimestamp` and return the reconstructed
   * state as a map of documentId → document.
   */
  private reconstructState<T extends Document>(
    collection: string,
    upToTimestamp: number
  ): Map<string, T> {
    const state = new Map<string, T>();
    const entries = this.entriesProvider();

    for (const entry of entries) {
      if (entry.timestamp > upToTimestamp) break;

      for (const op of entry.operations) {
        if (op.collection !== collection) continue;
        if (op.timestamp > upToTimestamp) continue;

        if (op.type === 'delete') {
          state.delete(op.documentId);
        } else if (op.after) {
          state.set(op.documentId, op.after as T);
        }
      }
    }

    return state;
  }

  /** Build a deterministic cache key from query parameters */
  private getCacheKey(queryType: string, ...args: unknown[]): string {
    return `${queryType}:${args.map((a) => String(a)).join(':')}`;
  }

  /** Retrieve a value from cache if caching is enabled and the entry is fresh */
  private getFromCache<T>(key: string): T | undefined {
    if (!this.config.enableCache) return undefined;

    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result as T;
  }

  /** Store a value in the cache if caching is enabled */
  private setCache(key: string, value: unknown): void {
    if (!this.config.enableCache) return;
    this.cache.set(key, { result: value, expiresAt: Date.now() + this.config.cacheTtlMs });
  }
}

/**
 * Create a temporal query engine instance
 *
 * @example
 * ```typescript
 * const engine = createTemporalQueryEngine(
 *   () => tracker.getHistory(),
 *   () => tracker.getCheckpoints(),
 *   { maxResults: 500 },
 * );
 *
 * const result = engine.asOf('users', Date.now() - 60_000);
 * engine.dispose();
 * ```
 */
export function createTemporalQueryEngine(
  entriesProvider: () => HistoryEntry[],
  snapshotsProvider: () => Snapshot[],
  config?: TemporalQueryConfig
): TemporalQueryEngine {
  return new TemporalQueryEngine(entriesProvider, snapshotsProvider, config);
}

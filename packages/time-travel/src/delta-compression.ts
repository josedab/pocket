/**
 * Delta Compression for Pocket Time Travel
 *
 * Reduces storage overhead by storing only differences between document versions
 * instead of full copies. Uses JSON-patch style delta encoding.
 *
 * @module delta-compression
 *
 * @example
 * ```typescript
 * import { createDeltaCompressor } from '@pocket/time-travel';
 *
 * const compressor = createDeltaCompressor({
 *   fullSnapshotInterval: 10,
 *   maxDeltaRatio: 0.8,
 * });
 *
 * // Compress a new version
 * const v1 = compressor.compress('todos', 'todo-1', { id: 'todo-1', title: 'Buy milk' }, null);
 * const v2 = compressor.compress('todos', 'todo-1',
 *   { id: 'todo-1', title: 'Buy milk', done: true },
 *   { id: 'todo-1', title: 'Buy milk' },
 * );
 *
 * // Reconstruct from compressed chain
 * const doc = compressor.decompress([v1, v2]);
 *
 * // Get compression stats
 * const stats = compressor.getStats([v1, v2]);
 * console.log(`Ratio: ${stats.compressionRatio}`);
 *
 * compressor.dispose();
 * ```
 */

import type { Document } from '@pocket/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported delta operation types (JSON-patch compatible) */
export type DeltaOperationType = 'add' | 'remove' | 'replace' | 'move' | 'copy';

/** A single delta operation describing one atomic change */
export interface DeltaOperation {
  /** Operation type */
  op: DeltaOperationType;
  /** JSON-pointer style path to the target field */
  path: string;
  /** New value (not present for 'remove') */
  value?: unknown;
  /** Source path (only for 'move' and 'copy') */
  from?: string;
}

/** A compressed version of a document – either a full snapshot or a delta */
export interface CompressedVersion<T extends Document = Document> {
  /** Unique version identifier */
  versionId: string;
  /** Document this version belongs to */
  documentId: string;
  /** Collection the document belongs to */
  collection: string;
  /** Timestamp when this version was created */
  timestamp: number;
  /** Whether this version stores a full snapshot or a delta */
  type: 'full' | 'delta';
  /** Full document snapshot (only for type === 'full') */
  snapshot?: T;
  /** Delta operations from previous version (only for type === 'delta') */
  delta?: DeltaOperation[];
  /** Size in bytes of this version */
  sizeBytes: number;
  /** Previous version ID (null for first version) */
  previousVersionId: string | null;
}

/** Aggregate compression statistics for a set of versions */
export interface CompressionStats {
  /** Total number of versions analysed */
  totalVersions: number;
  /** Number of full snapshots */
  fullSnapshots: number;
  /** Number of delta versions */
  deltaVersions: number;
  /** Total uncompressed size in bytes */
  totalSizeBytes: number;
  /** Total compressed size in bytes */
  compressedSizeBytes: number;
  /** Compression ratio (compressed / total) */
  compressionRatio: number;
  /** Average delta size in bytes */
  avgDeltaSize: number;
}

/** Configuration for the delta compressor */
export interface DeltaCompressionConfig {
  /** Store full snapshot every N versions (default: 10) */
  fullSnapshotInterval?: number;
  /** Force full snapshot if delta exceeds this percentage of full doc size (default: 0.8) */
  maxDeltaRatio?: number;
  /** Maximum number of versions to retain per document (default: 100) */
  maxVersionsPerDocument?: number;
  /** Prune versions older than this (ms) (default: undefined – no age limit) */
  maxAge?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default delta compression configuration */
export const DEFAULT_DELTA_CONFIG: Required<Omit<DeltaCompressionConfig, 'maxAge'>> & {
  maxAge: number | undefined;
} = {
  fullSnapshotInterval: 10,
  maxDeltaRatio: 0.8,
  maxVersionsPerDocument: 100,
  maxAge: undefined,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Deep-clone a plain JSON-serialisable value */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Approximate JSON byte size of a value */
function byteSize(value: unknown): number {
  return JSON.stringify(value).length;
}

/** Check whether a value is a plain object */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** Get a value from an object by dot-delimited path */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Set a value on an object by dot-delimited path (mutates obj) */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}

/** Delete a value from an object by dot-delimited path (mutates obj) */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current === null || current === undefined || typeof current !== 'object') {
      return;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current !== null && current !== undefined && typeof current === 'object') {
    Reflect.deleteProperty(current as Record<string, unknown>, parts[parts.length - 1]!);
  }
}

// ---------------------------------------------------------------------------
// DeltaCompressor
// ---------------------------------------------------------------------------

/**
 * Compresses document versions using JSON-patch style delta encoding.
 *
 * Full snapshots are stored periodically (every `fullSnapshotInterval`
 * versions) or when the delta would exceed `maxDeltaRatio` of the full
 * document size. All other versions store only the operations needed to
 * transform the previous version into the new one.
 *
 * @example
 * ```typescript
 * const compressor = new DeltaCompressor({ fullSnapshotInterval: 5 });
 *
 * const v1 = compressor.compress('todos', 't1', { id: 't1', text: 'Hi' }, null);
 * const v2 = compressor.compress('todos', 't1', { id: 't1', text: 'Hello' }, { id: 't1', text: 'Hi' });
 *
 * const doc = compressor.decompress([v1, v2]);
 * console.log(doc); // { id: 't1', text: 'Hello' }
 *
 * compressor.dispose();
 * ```
 */
export class DeltaCompressor {
  private readonly config: Required<Omit<DeltaCompressionConfig, 'maxAge'>> & {
    maxAge: number | undefined;
  };

  private versionCounters = new Map<string, number>();

  constructor(config: DeltaCompressionConfig = {}) {
    this.config = {
      fullSnapshotInterval:
        config.fullSnapshotInterval ?? DEFAULT_DELTA_CONFIG.fullSnapshotInterval,
      maxDeltaRatio: config.maxDeltaRatio ?? DEFAULT_DELTA_CONFIG.maxDeltaRatio,
      maxVersionsPerDocument:
        config.maxVersionsPerDocument ?? DEFAULT_DELTA_CONFIG.maxVersionsPerDocument,
      maxAge: config.maxAge ?? DEFAULT_DELTA_CONFIG.maxAge,
    };
  }

  // ---- Compress ----------------------------------------------------------

  /**
   * Compress a new document version, choosing between a full snapshot and
   * a delta based on the configured policy.
   *
   * @param collection - Collection name
   * @param documentId - Document identifier
   * @param document - Current document state
   * @param previousDocument - Previous document state (`null` for the first version)
   * @returns The compressed version entry
   *
   * @example
   * ```typescript
   * const v = compressor.compress('users', 'u1', newUser, oldUser);
   * console.log(v.type); // 'delta' or 'full'
   * ```
   */
  compress<T extends Document = Document>(
    collection: string,
    documentId: string,
    document: T,
    previousDocument: T | null
  ): CompressedVersion<T> {
    const key = `${collection}:${documentId}`;
    const count = (this.versionCounters.get(key) ?? 0) + 1;
    this.versionCounters.set(key, count);

    const shouldStoreFull =
      previousDocument === null || count % this.config.fullSnapshotInterval === 1;

    if (!shouldStoreFull && previousDocument) {
      const delta = this.computeDelta(previousDocument, document);
      const deltaSize = byteSize(delta);
      const fullSize = byteSize(document);

      if (deltaSize / fullSize <= this.config.maxDeltaRatio) {
        return {
          versionId: generateId(),
          documentId,
          collection,
          timestamp: Date.now(),
          type: 'delta',
          delta,
          sizeBytes: deltaSize,
          previousVersionId: null, // caller links versions externally
        };
      }
    }

    // Store full snapshot
    return {
      versionId: generateId(),
      documentId,
      collection,
      timestamp: Date.now(),
      type: 'full',
      snapshot: deepClone(document),
      sizeBytes: byteSize(document),
      previousVersionId: null,
    };
  }

  // ---- Decompress --------------------------------------------------------

  /**
   * Reconstruct a document from a chain of compressed versions.
   *
   * The chain must be ordered oldest → newest and the first element must be
   * a full snapshot.
   *
   * @example
   * ```typescript
   * const doc = compressor.decompress([v1, v2, v3]);
   * ```
   */
  decompress<T extends Document = Document>(versions: CompressedVersion<T>[]): T {
    if (versions.length === 0) {
      throw new Error('Cannot decompress an empty version chain');
    }

    // Walk from the most recent full snapshot forward
    let baseIdx = -1;
    for (let i = versions.length - 1; i >= 0; i--) {
      if (versions[i]!.type === 'full') {
        baseIdx = i;
        break;
      }
    }

    if (baseIdx === -1) {
      throw new Error('No full snapshot found in version chain');
    }

    let doc = deepClone(versions[baseIdx]!.snapshot!);

    for (let i = baseIdx + 1; i < versions.length; i++) {
      const version = versions[i]!;
      if (version.delta) {
        doc = this.applyDelta(doc, version.delta);
      }
    }

    return doc;
  }

  // ---- Decompress at timestamp -------------------------------------------

  /**
   * Reconstruct a document's state at a specific timestamp from a version chain.
   *
   * @returns The document state, or `null` if no version existed at or before
   *   the given timestamp.
   *
   * @example
   * ```typescript
   * const doc = compressor.decompressAt(versions, Date.now() - 60_000);
   * ```
   */
  decompressAt<T extends Document = Document>(
    versions: CompressedVersion<T>[],
    timestamp: number
  ): T | null {
    const relevant = versions.filter((v) => v.timestamp <= timestamp);
    if (relevant.length === 0) return null;
    return this.decompress(relevant);
  }

  // ---- Delta computation -------------------------------------------------

  /**
   * Compute the delta operations needed to transform `before` into `after`.
   *
   * @example
   * ```typescript
   * const delta = compressor.computeDelta(
   *   { id: '1', name: 'Alice' },
   *   { id: '1', name: 'Alice B.', role: 'admin' },
   * );
   * // [
   * //   { op: 'replace', path: 'name', value: 'Alice B.' },
   * //   { op: 'add', path: 'role', value: 'admin' },
   * // ]
   * ```
   */
  computeDelta<T extends Document>(before: T, after: T): DeltaOperation[] {
    const ops: DeltaOperation[] = [];
    this.diffObjects(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      '',
      ops
    );
    return ops;
  }

  // ---- Delta application -------------------------------------------------

  /**
   * Apply delta operations to reconstruct a document.
   *
   * Returns a new object — the input is not mutated.
   *
   * @example
   * ```typescript
   * const updated = compressor.applyDelta(doc, delta);
   * ```
   */
  applyDelta<T extends Document>(document: T, delta: DeltaOperation[]): T {
    const result = deepClone(document) as unknown as Record<string, unknown>;

    for (const op of delta) {
      switch (op.op) {
        case 'add':
        case 'replace':
          setByPath(result, op.path, deepClone(op.value));
          break;
        case 'remove':
          deleteByPath(result, op.path);
          break;
        case 'move':
          if (op.from) {
            const value = getByPath(result, op.from);
            deleteByPath(result, op.from);
            setByPath(result, op.path, value);
          }
          break;
        case 'copy':
          if (op.from) {
            const value = getByPath(result, op.from);
            setByPath(result, op.path, deepClone(value));
          }
          break;
      }
    }

    return result as unknown as T;
  }

  // ---- Pruning -----------------------------------------------------------

  /**
   * Prune a version chain according to the provided options or the
   * compressor's configured limits.
   *
   * Ensures at least one full snapshot is always retained.
   *
   * @example
   * ```typescript
   * const { retained, pruned } = compressor.prune(versions, {
   *   maxVersions: 50,
   *   maxAge: 7 * 24 * 60 * 60 * 1000,
   * });
   * ```
   */
  prune(
    versions: CompressedVersion[],
    options: { maxVersions?: number; maxAge?: number } = {}
  ): { retained: CompressedVersion[]; pruned: number } {
    const maxVersions = options.maxVersions ?? this.config.maxVersionsPerDocument;
    const maxAge = options.maxAge ?? this.config.maxAge;

    let retained = [...versions];

    // Age-based pruning
    if (maxAge !== undefined) {
      const cutoff = Date.now() - maxAge;
      retained = retained.filter((v) => v.timestamp >= cutoff || v.type === 'full');
    }

    // Count-based pruning – keep the most recent N
    if (retained.length > maxVersions) {
      retained = retained.slice(retained.length - maxVersions);
    }

    // Guarantee at least one full snapshot at the start
    const hasFullSnapshot = retained.some((v) => v.type === 'full');
    if (!hasFullSnapshot && retained.length > 0) {
      // Walk backwards through the original chain to find the nearest full snapshot
      for (let i = versions.length - 1; i >= 0; i--) {
        if (versions[i]!.type === 'full') {
          retained = [versions[i]!, ...retained];
          break;
        }
      }
    }

    return {
      retained,
      pruned: versions.length - retained.length,
    };
  }

  // ---- Stats -------------------------------------------------------------

  /**
   * Compute aggregate compression statistics for a set of versions.
   *
   * @example
   * ```typescript
   * const stats = compressor.getStats(versions);
   * console.log(`Compression ratio: ${stats.compressionRatio.toFixed(2)}`);
   * ```
   */
  getStats(versions: CompressedVersion[]): CompressionStats {
    let fullSnapshots = 0;
    let deltaVersions = 0;
    let compressedSizeBytes = 0;
    let totalSizeBytes = 0;
    let deltaTotal = 0;

    for (const v of versions) {
      compressedSizeBytes += v.sizeBytes;

      if (v.type === 'full') {
        fullSnapshots++;
        totalSizeBytes += v.sizeBytes;
      } else {
        deltaVersions++;
        deltaTotal += v.sizeBytes;
        // Estimate uncompressed size as the nearest full snapshot size
        totalSizeBytes += v.sizeBytes;
      }
    }

    // Re-estimate totalSizeBytes as if every version were a full snapshot
    // by using the average full-snapshot size
    if (fullSnapshots > 0) {
      const avgFullSize = (compressedSizeBytes - deltaTotal) / fullSnapshots;
      totalSizeBytes = avgFullSize * versions.length;
    }

    return {
      totalVersions: versions.length,
      fullSnapshots,
      deltaVersions,
      totalSizeBytes: Math.round(totalSizeBytes),
      compressedSizeBytes,
      compressionRatio: totalSizeBytes > 0 ? compressedSizeBytes / totalSizeBytes : 1,
      avgDeltaSize: deltaVersions > 0 ? Math.round(deltaTotal / deltaVersions) : 0,
    };
  }

  // ---- Lifecycle ---------------------------------------------------------

  /**
   * Clean up resources. No-op for this engine, provided for API consistency.
   */
  dispose(): void {
    this.versionCounters.clear();
  }

  // ---- Private helpers ---------------------------------------------------

  /** Recursively diff two plain objects and emit delta operations */
  private diffObjects(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    prefix: string,
    ops: DeltaOperation[]
  ): void {
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const bVal = before[key];
      const aVal = after[key];

      if (bVal === undefined && aVal !== undefined) {
        ops.push({ op: 'add', path, value: aVal });
      } else if (bVal !== undefined && aVal === undefined) {
        ops.push({ op: 'remove', path });
      } else if (isPlainObject(bVal) && isPlainObject(aVal)) {
        this.diffObjects(bVal, aVal, path, ops);
      } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        ops.push({ op: 'replace', path, value: aVal });
      }
    }
  }
}

/**
 * Create a delta compressor instance
 *
 * @example
 * ```typescript
 * const compressor = createDeltaCompressor({ fullSnapshotInterval: 5 });
 * const v1 = compressor.compress('todos', 't1', doc, null);
 * compressor.dispose();
 * ```
 */
export function createDeltaCompressor(config?: DeltaCompressionConfig): DeltaCompressor {
  return new DeltaCompressor(config);
}

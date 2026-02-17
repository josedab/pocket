/**
 * Snapshot Matcher — deterministic database state snapshot testing.
 *
 * Captures the state of a Pocket database (collections, documents, indexes)
 * as a normalized JSON snapshot for comparison in tests. Supports smart
 * diffing with configurable normalizers to ignore non-deterministic fields
 * like timestamps and UUIDs.
 *
 * @module @pocket/testing
 */

// ── Types ─────────────────────────────────────────────────

export interface SnapshotConfig {
  /** Fields to strip from all documents (default: ['_rev', 'updatedAt']) */
  stripFields?: string[];
  /** Regex patterns for values to replace with placeholders */
  normalizers?: SnapshotNormalizer[];
  /** Sort documents by this field within each collection (default: '_id') */
  sortBy?: string;
  /** Whether to include document count per collection (default: true) */
  includeCounts?: boolean;
  /** Pretty print JSON (default: true) */
  prettyPrint?: boolean;
}

export interface SnapshotNormalizer {
  /** Name for this normalizer */
  name: string;
  /** Regex pattern to match values */
  pattern: RegExp;
  /** Replacement string (default: '[NORMALIZED]') */
  replacement: string;
}

export interface DatabaseSnapshot {
  /** Snapshot metadata */
  meta: {
    timestamp: string;
    collectionCount: number;
    totalDocuments: number;
  };
  /** Collections and their documents */
  collections: Record<string, CollectionSnapshot>;
}

export interface CollectionSnapshot {
  count: number;
  documents: Record<string, unknown>[];
}

export interface SnapshotDiff {
  /** Whether snapshots are identical */
  match: boolean;
  /** Human-readable diff description */
  summary: string;
  /** Per-collection diffs */
  collections: CollectionDiff[];
}

export interface CollectionDiff {
  name: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  documentCountDiff: number;
  addedDocuments: string[];
  removedDocuments: string[];
  modifiedDocuments: ModifiedDocument[];
}

export interface ModifiedDocument {
  id: string;
  changes: FieldChange[];
}

export interface FieldChange {
  path: string;
  expected: unknown;
  actual: unknown;
}

// ── Default Normalizers ───────────────────────────────────

/** UUID pattern normalizer */
export const UUID_NORMALIZER: SnapshotNormalizer = {
  name: 'uuid',
  pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  replacement: '[UUID]',
};

/** ISO timestamp normalizer */
export const TIMESTAMP_NORMALIZER: SnapshotNormalizer = {
  name: 'timestamp',
  pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g,
  replacement: '[TIMESTAMP]',
};

/** Epoch ms normalizer */
export const EPOCH_NORMALIZER: SnapshotNormalizer = {
  name: 'epoch',
  pattern: /1[6-9]\d{11}/g,
  replacement: '[EPOCH_MS]',
};

// ── Snapshot Matcher ──────────────────────────────────────

/**
 * Captures and compares database state snapshots for deterministic testing.
 *
 * Normalizes non-deterministic values, sorts documents for stable ordering,
 * and provides detailed diffs for failing assertions.
 */
export class SnapshotMatcher {
  private readonly config: Required<SnapshotConfig>;

  constructor(snapshotConfig?: SnapshotConfig) {
    this.config = {
      stripFields: snapshotConfig?.stripFields ?? ['_rev', 'updatedAt'],
      normalizers: snapshotConfig?.normalizers ?? [],
      sortBy: snapshotConfig?.sortBy ?? '_id',
      includeCounts: snapshotConfig?.includeCounts ?? true,
      prettyPrint: snapshotConfig?.prettyPrint ?? true,
    };
  }

  /** Capture a snapshot from raw collection data */
  capture(collections: Record<string, Record<string, unknown>[]>): DatabaseSnapshot {
    const collectionSnapshots: Record<string, CollectionSnapshot> = {};
    let totalDocuments = 0;

    for (const [name, docs] of Object.entries(collections)) {
      const normalized = docs.map((doc) => this.normalizeDocument(doc));
      const sorted = this.sortDocuments(normalized);
      collectionSnapshots[name] = {
        count: sorted.length,
        documents: sorted,
      };
      totalDocuments += sorted.length;
    }

    return {
      meta: {
        timestamp: '[TIMESTAMP]',
        collectionCount: Object.keys(collectionSnapshots).length,
        totalDocuments,
      },
      collections: collectionSnapshots,
    };
  }

  /** Serialize a snapshot to a stable string representation */
  serialize(snapshot: DatabaseSnapshot): string {
    if (this.config.prettyPrint) {
      return JSON.stringify(snapshot, null, 2);
    }
    return JSON.stringify(snapshot);
  }

  /** Deserialize a snapshot from a string */
  deserialize(str: string): DatabaseSnapshot {
    return JSON.parse(str) as DatabaseSnapshot;
  }

  /** Compare two snapshots and return detailed diff */
  diff(expected: DatabaseSnapshot, actual: DatabaseSnapshot): SnapshotDiff {
    const collectionDiffs: CollectionDiff[] = [];
    const allCollections = new Set([
      ...Object.keys(expected.collections),
      ...Object.keys(actual.collections),
    ]);

    for (const name of allCollections) {
      const expectedCol = expected.collections[name];
      const actualCol = actual.collections[name];

      if (!expectedCol) {
        collectionDiffs.push({
          name,
          status: 'added',
          documentCountDiff: actualCol?.count ?? 0,
          addedDocuments: (actualCol?.documents ?? []).map((d) => String((d as Record<string, unknown>)['_id'] ?? 'unknown')),
          removedDocuments: [],
          modifiedDocuments: [],
        });
        continue;
      }

      if (!actualCol) {
        collectionDiffs.push({
          name,
          status: 'removed',
          documentCountDiff: -(expectedCol.count),
          addedDocuments: [],
          removedDocuments: expectedCol.documents.map((d) => String((d as Record<string, unknown>)['_id'] ?? 'unknown')),
          modifiedDocuments: [],
        });
        continue;
      }

      // Compare documents
      const added: string[] = [];
      const removed: string[] = [];
      const modified: ModifiedDocument[] = [];

      const expectedMap = new Map(expectedCol.documents.map((d) => [
        String((d as Record<string, unknown>)['_id'] ?? JSON.stringify(d)),
        d,
      ]));
      const actualMap = new Map(actualCol.documents.map((d) => [
        String((d as Record<string, unknown>)['_id'] ?? JSON.stringify(d)),
        d,
      ]));

      for (const [id, expectedDoc] of expectedMap) {
        const actualDoc = actualMap.get(id);
        if (!actualDoc) {
          removed.push(id);
        } else {
          const changes = this.diffObjects(expectedDoc as Record<string, unknown>, actualDoc as Record<string, unknown>);
          if (changes.length > 0) {
            modified.push({ id, changes });
          }
        }
      }

      for (const id of actualMap.keys()) {
        if (!expectedMap.has(id)) {
          added.push(id);
        }
      }

      const isUnchanged = added.length === 0 && removed.length === 0 && modified.length === 0;

      collectionDiffs.push({
        name,
        status: isUnchanged ? 'unchanged' : 'modified',
        documentCountDiff: actualCol.count - expectedCol.count,
        addedDocuments: added,
        removedDocuments: removed,
        modifiedDocuments: modified,
      });
    }

    const hasChanges = collectionDiffs.some((d) => d.status !== 'unchanged');
    const changedCount = collectionDiffs.filter((d) => d.status !== 'unchanged').length;

    return {
      match: !hasChanges,
      summary: hasChanges
        ? `${changedCount} collection(s) differ`
        : 'Snapshots match',
      collections: collectionDiffs,
    };
  }

  /** Assert that actual matches expected (throws with diff on mismatch) */
  assertMatch(expected: DatabaseSnapshot, actual: DatabaseSnapshot): void {
    const result = this.diff(expected, actual);
    if (!result.match) {
      const details = result.collections
        .filter((c) => c.status !== 'unchanged')
        .map((c) => {
          const parts = [`  ${c.name} (${c.status})`];
          if (c.addedDocuments.length > 0) parts.push(`    + added: ${c.addedDocuments.join(', ')}`);
          if (c.removedDocuments.length > 0) parts.push(`    - removed: ${c.removedDocuments.join(', ')}`);
          for (const mod of c.modifiedDocuments) {
            for (const change of mod.changes) {
              parts.push(`    ~ ${mod.id}.${change.path}: ${JSON.stringify(change.expected)} → ${JSON.stringify(change.actual)}`);
            }
          }
          return parts.join('\n');
        })
        .join('\n');

      throw new Error(`Snapshot mismatch: ${result.summary}\n${details}`);
    }
  }

  // ── Internals ─────────────────────────────────────────

  private normalizeDocument(doc: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(doc)) {
      if (this.config.stripFields.includes(key)) continue;
      result[key] = this.normalizeValue(value);
    }

    return result;
  }

  private normalizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      let normalized = value;
      for (const normalizer of this.config.normalizers) {
        normalized = normalized.replace(normalizer.pattern, normalizer.replacement);
      }
      return normalized;
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.normalizeValue(v));
    }

    if (value !== null && typeof value === 'object') {
      return this.normalizeDocument(value as Record<string, unknown>);
    }

    return value;
  }

  private sortDocuments(docs: Record<string, unknown>[]): Record<string, unknown>[] {
    return [...docs].sort((a, b) => {
      const aKey = String(a[this.config.sortBy] ?? '');
      const bKey = String(b[this.config.sortBy] ?? '');
      return aKey.localeCompare(bKey);
    });
  }

  private diffObjects(expected: Record<string, unknown>, actual: Record<string, unknown>, prefix: string = ''): FieldChange[] {
    const changes: FieldChange[] = [];
    const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const expVal = expected[key];
      const actVal = actual[key];

      if (JSON.stringify(expVal) !== JSON.stringify(actVal)) {
        if (
          expVal !== null && actVal !== null &&
          typeof expVal === 'object' && typeof actVal === 'object' &&
          !Array.isArray(expVal) && !Array.isArray(actVal)
        ) {
          changes.push(...this.diffObjects(
            expVal as Record<string, unknown>,
            actVal as Record<string, unknown>,
            path,
          ));
        } else {
          changes.push({ path, expected: expVal, actual: actVal });
        }
      }
    }

    return changes;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new snapshot matcher for database state testing */
export function createSnapshotMatcher(config?: SnapshotConfig): SnapshotMatcher {
  return new SnapshotMatcher(config);
}

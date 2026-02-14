/**
 * @module @pocket/crdt/crdt-sync-bridge
 *
 * Bridge between the CRDT system and Pocket's sync engine.
 * Enables automatic conflict-free synchronization by exchanging CRDT
 * operations instead of full documents. The bridge manages:
 * - Converting collection writes into CRDT operations
 * - Applying remote CRDT operations to local state
 * - Garbage collection of tombstoned operations
 * - Operation log compaction
 *
 * @example
 * ```typescript
 * const bridge = createCRDTSyncBridge({
 *   nodeId: 'device-abc',
 *   collections: ['todos', 'notes'],
 * });
 *
 * // Process local write
 * const ops = bridge.processLocalWrite('todos', 'todo-1', { title: 'Buy milk' });
 *
 * // Apply remote operations
 * bridge.applyRemoteOperations(remoteOps);
 *
 * // Get operations to sync
 * const pending = bridge.getPendingOperations();
 * ```
 */
import type { Observable } from 'rxjs';
import { Subject } from 'rxjs';
import { type JSONCRDTDocument, createJSONCRDTDocument } from './document-crdt.js';
import type { JSONCRDTOperation, MergeResult, NodeId, VectorClock } from './types.js';

export interface CRDTSyncBridgeConfig {
  nodeId: NodeId;
  collections: string[];
  gcIntervalMs?: number;
  maxOperationAge?: number;
  compactionThreshold?: number;
}

export interface CRDTSyncBridgeStats {
  totalDocuments: number;
  totalOperations: number;
  pendingOperations: number;
  tombstoneCount: number;
  lastGCAt: number | null;
  collections: string[];
}

export interface SyncOperationBatch {
  nodeId: NodeId;
  operations: CRDTSyncOperation[];
  vclock: VectorClock;
  timestamp: number;
}

export interface CRDTSyncOperation {
  collection: string;
  documentId: string;
  operation: JSONCRDTOperation;
}

export type CRDTMergeStrategy = 'last-write-wins' | 'crdt-auto' | 'field-level-merge';

export interface CRDTSyncBridge {
  processLocalWrite(
    collection: string,
    documentId: string,
    fields: Record<string, unknown>
  ): CRDTSyncOperation[];
  processLocalDelete(
    collection: string,
    documentId: string,
    fieldPaths?: string[][]
  ): CRDTSyncOperation[];
  applyRemoteOperations(operations: CRDTSyncOperation[]): MergeResult<Record<string, unknown>>[];
  getDocument(collection: string, documentId: string): Record<string, unknown> | null;
  getPendingOperations(): CRDTSyncOperation[];
  acknowledgeOperations(operationIds: string[]): void;
  runGarbageCollection(): GCResult;
  getStats(): CRDTSyncBridgeStats;
  readonly changes$: Observable<CRDTSyncOperation>;
  readonly mergeResults$: Observable<MergeResult>;
  destroy(): void;
}

export interface GCResult {
  removedOperations: number;
  compactedDocuments: number;
  freedTombstones: number;
}

export function createCRDTSyncBridge(config: CRDTSyncBridgeConfig): CRDTSyncBridge {
  const { nodeId } = config;
  const maxOperationAge = config.maxOperationAge ?? 3600000; // 1 hour
  const compactionThreshold = config.compactionThreshold ?? 1000;

  // Documents indexed by collection:docId
  const documents = new Map<string, JSONCRDTDocument>();
  const pendingOps: CRDTSyncOperation[] = [];
  const tombstones = new Set<string>();
  let lastGCAt: number | null = null;

  const changesSubject = new Subject<CRDTSyncOperation>();
  const mergeResultsSubject = new Subject<MergeResult<Record<string, unknown>>>();

  // GC interval
  let gcTimer: ReturnType<typeof setInterval> | undefined;
  if (config.gcIntervalMs) {
    gcTimer = setInterval(() => {
      runGarbageCollection();
    }, config.gcIntervalMs);
  }

  function docKey(collection: string, documentId: string): string {
    return `${collection}:${documentId}`;
  }

  function getOrCreateDocument(
    collection: string,
    documentId: string,
    initialValue?: Record<string, unknown>
  ): JSONCRDTDocument {
    const key = docKey(collection, documentId);
    let doc = documents.get(key);
    if (!doc) {
      doc = createJSONCRDTDocument(documentId, nodeId, initialValue);
      documents.set(key, doc);
    }
    return doc;
  }

  function processLocalWrite(
    collection: string,
    documentId: string,
    fields: Record<string, unknown>
  ): CRDTSyncOperation[] {
    const doc = getOrCreateDocument(collection, documentId);
    const ops: CRDTSyncOperation[] = [];

    // Generate a CRDT operation for each field
    for (const [field, value] of Object.entries(fields)) {
      const crdtOp = doc.set([field], value);
      const syncOp: CRDTSyncOperation = {
        collection,
        documentId,
        operation: crdtOp,
      };
      ops.push(syncOp);
      pendingOps.push(syncOp);
      changesSubject.next(syncOp);
    }

    return ops;
  }

  function processLocalDelete(
    collection: string,
    documentId: string,
    fieldPaths?: string[][]
  ): CRDTSyncOperation[] {
    const doc = getOrCreateDocument(collection, documentId);
    const ops: CRDTSyncOperation[] = [];

    if (fieldPaths) {
      // Delete specific fields
      for (const path of fieldPaths) {
        const crdtOp = doc.delete(path);
        if (crdtOp) {
          const syncOp: CRDTSyncOperation = { collection, documentId, operation: crdtOp };
          ops.push(syncOp);
          pendingOps.push(syncOp);
          changesSubject.next(syncOp);
        }
      }
    } else {
      // Mark entire document as tombstone
      const key = docKey(collection, documentId);
      tombstones.add(key);
      const crdtOp = doc.set(['_deleted'], true);
      const syncOp: CRDTSyncOperation = { collection, documentId, operation: crdtOp };
      ops.push(syncOp);
      pendingOps.push(syncOp);
      changesSubject.next(syncOp);
    }

    return ops;
  }

  function applyRemoteOperations(
    operations: CRDTSyncOperation[]
  ): MergeResult<Record<string, unknown>>[] {
    const results: MergeResult<Record<string, unknown>>[] = [];

    for (const syncOp of operations) {
      const doc = getOrCreateDocument(syncOp.collection, syncOp.documentId);
      const result = doc.applyRemote(syncOp.operation) as MergeResult<Record<string, unknown>>;
      results.push(result);
      mergeResultsSubject.next(result);

      // Check for tombstone
      if (syncOp.operation.path[0] === '_deleted' && syncOp.operation.value === true) {
        tombstones.add(docKey(syncOp.collection, syncOp.documentId));
      }
    }

    return results;
  }

  function getDocument(collection: string, documentId: string): Record<string, unknown> | null {
    const key = docKey(collection, documentId);
    if (tombstones.has(key)) return null;

    const doc = documents.get(key);
    return doc ? doc.getValue() : null;
  }

  function getPendingOperations(): CRDTSyncOperation[] {
    return [...pendingOps];
  }

  function acknowledgeOperations(operationIds: string[]): void {
    const idSet = new Set(operationIds);
    const remaining = pendingOps.filter((op) => !idSet.has(op.operation.id));
    pendingOps.length = 0;
    pendingOps.push(...remaining);

    // Also acknowledge in documents
    for (const doc of documents.values()) {
      doc.acknowledgeOps(operationIds);
    }
  }

  function runGarbageCollection(): GCResult {
    const now = Date.now();
    let removedOperations = 0;
    let compactedDocuments = 0;
    let freedTombstones = 0;

    // Remove old tombstoned documents
    for (const key of tombstones) {
      const doc = documents.get(key);
      if (doc) {
        const state = doc.getState();
        const oldestOp = state.operations[0];
        if (oldestOp && now - oldestOp.timestamp.counter > maxOperationAge) {
          documents.delete(key);
          tombstones.delete(key);
          freedTombstones++;
          removedOperations += state.operations.length;
        }
      }
    }

    // Compact documents with too many operations
    for (const [key, doc] of documents) {
      const state = doc.getState();
      if (state.operations.length > compactionThreshold) {
        // Create fresh document from current value
        const value = doc.getValue();
        const parts = key.split(':');
        const docId = parts.slice(1).join(':');
        const fresh = createJSONCRDTDocument(docId, nodeId, value);
        documents.set(key, fresh);
        compactedDocuments++;
        removedOperations += state.operations.length;
      }
    }

    lastGCAt = now;
    return { removedOperations, compactedDocuments, freedTombstones };
  }

  function getStats(): CRDTSyncBridgeStats {
    let totalOperations = 0;
    for (const doc of documents.values()) {
      totalOperations += doc.getState().operations.length;
    }

    return {
      totalDocuments: documents.size,
      totalOperations,
      pendingOperations: pendingOps.length,
      tombstoneCount: tombstones.size,
      lastGCAt,
      collections: [...config.collections],
    };
  }

  function destroy(): void {
    if (gcTimer) {
      clearInterval(gcTimer);
    }
    for (const doc of documents.values()) {
      doc.dispose();
    }
    documents.clear();
    pendingOps.length = 0;
    tombstones.clear();
    changesSubject.complete();
    mergeResultsSubject.complete();
  }

  return {
    processLocalWrite,
    processLocalDelete,
    applyRemoteOperations,
    getDocument,
    getPendingOperations,
    acknowledgeOperations,
    runGarbageCollection,
    getStats,
    changes$: changesSubject.asObservable(),
    mergeResults$: mergeResultsSubject.asObservable(),
    destroy,
  };
}

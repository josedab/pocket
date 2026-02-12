/**
 * @module automerge-sync-adapter
 *
 * Bridges Pocket's sync engine with CRDT-based synchronization,
 * managing CRDT documents for each collection item.
 */

import type {
  AutomergeConfig,
  AutomergeSyncAdapter,
  CrdtChange,
  CrdtDocument,
  MergeResult,
  SyncSession,
} from './types.js';
import { createCrdtDocument } from './crdt-document.js';
import { createSyncSession } from './sync-session.js';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const DEFAULT_CONFIG: Required<AutomergeConfig> = {
  actorId: '',
  mergeStrategy: 'auto',
  batchSize: 50,
  syncIntervalMs: 1000,
  compress: false,
};

/**
 * Creates an Automerge sync adapter that bridges Pocket's sync engine
 * with CRDT-based conflict-free synchronization.
 *
 * @param config - Adapter configuration
 * @returns An AutomergeSyncAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = createAutomergeSyncAdapter({
 *   actorId: 'user-abc',
 *   mergeStrategy: 'auto',
 * });
 *
 * // Apply a local change
 * adapter.applyLocalChange('todos', 'todo-1', (draft) => {
 *   draft.title = 'Updated title';
 * });
 * ```
 */
export function createAutomergeSyncAdapter(
  config: AutomergeConfig,
): AutomergeSyncAdapter {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const actorId = resolvedConfig.actorId || generateId();

  // collection -> documentId -> CrdtDocument
  const documents = new Map<string, Map<string, CrdtDocument>>();
  let destroyed = false;

  function getCollectionMap(collectionName: string): Map<string, CrdtDocument> {
    let map = documents.get(collectionName);
    if (!map) {
      map = new Map();
      documents.set(collectionName, map);
    }
    return map;
  }

  function getDocument<T extends Record<string, unknown>>(
    collectionName: string,
    documentId: string,
  ): CrdtDocument<T> {
    if (destroyed) throw new Error('Adapter has been destroyed');

    const collection = getCollectionMap(collectionName);
    let doc = collection.get(documentId);

    if (!doc) {
      doc = createCrdtDocument<T>({} as T, actorId);
      collection.set(documentId, doc);
    }

    return doc as CrdtDocument<T>;
  }

  function createSyncSessionForDoc(documentId: string): SyncSession {
    if (destroyed) throw new Error('Adapter has been destroyed');

    // Find the document across collections
    for (const collection of documents.values()) {
      const doc = collection.get(documentId);
      if (doc) {
        return createSyncSession(documentId, doc);
      }
    }

    throw new Error(`Document not found: ${documentId}`);
  }

  function applyLocalChange<T extends Record<string, unknown>>(
    collectionName: string,
    documentId: string,
    changeFn: (draft: T) => void,
  ): CrdtChange {
    const doc = getDocument<T>(collectionName, documentId);
    return doc.change(changeFn);
  }

  function applyRemoteChanges(
    collectionName: string,
    documentId: string,
    changes: readonly CrdtChange[],
  ): MergeResult {
    const doc = getDocument(collectionName, documentId);
    return doc.applyChanges(changes);
  }

  function getDocumentIds(collectionName: string): readonly string[] {
    const collection = documents.get(collectionName);
    return collection ? [...collection.keys()] : [];
  }

  function destroy(): void {
    destroyed = true;
    for (const collection of documents.values()) {
      for (const doc of collection.values()) {
        doc.destroy();
      }
      collection.clear();
    }
    documents.clear();
  }

  return {
    actorId,
    getDocument,
    createSyncSession: createSyncSessionForDoc,
    applyLocalChange,
    applyRemoteChanges,
    getDocumentIds,
    destroy,
  };
}

/**
 * IndexedDB-backed implementation of {@link AttachmentStore} from `@pocket/core`.
 *
 * Uses a dedicated IndexedDB database (separate from the main data DB) with
 * two object stores: `metadata` for {@link Attachment} records and `blobs`
 * for the raw binary data.
 *
 * @module
 */

import type { Attachment, AttachmentStore } from '@pocket/core';

const DEFAULT_DB_NAME = '_pocket_attachments';
const METADATA_STORE = 'metadata';
const BLOBS_STORE = 'blobs';
const DB_VERSION = 1;

/**
 * IndexedDB-backed attachment store.
 *
 * Call {@link initialize} before using any other method.
 */
export class IndexedDBAttachmentStore implements AttachmentStore {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;

  constructor(dbName: string = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  /** Open (or create) the IndexedDB database. */
  async initialize(dbName?: string): Promise<void> {
    const name = dbName ?? this.dbName;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const meta = db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
          meta.createIndex('documentId', 'documentId', { unique: false });
        }
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          db.createObjectStore(BLOBS_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () =>
        reject(new Error(request.error?.message ?? 'Failed to open attachment database'));

      request.onblocked = () =>
        reject(new Error('Attachment database blocked – close other connections'));
    });
  }

  /** Close the IndexedDB connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ---------------------------------------------------------------------------
  // AttachmentStore interface
  // ---------------------------------------------------------------------------

  async put(attachment: Attachment, data: Uint8Array): Promise<void> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([METADATA_STORE, BLOBS_STORE], 'readwrite');
      tx.objectStore(METADATA_STORE).put({ ...attachment });
      tx.objectStore(BLOBS_STORE).put({ id: attachment.id, data });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(tx.error?.message ?? 'put failed'));
      tx.onabort = () => reject(new Error(tx.error?.message ?? 'put aborted'));
    });
  }

  async get(id: string): Promise<Uint8Array | null> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS_STORE, 'readonly');
      const request = tx.objectStore(BLOBS_STORE).get(id);

      request.onsuccess = () => {
        const result = request.result as { id: string; data: Uint8Array } | undefined;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'get failed'));
    });
  }

  async delete(id: string): Promise<void> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([METADATA_STORE, BLOBS_STORE], 'readwrite');
      tx.objectStore(METADATA_STORE).delete(id);
      tx.objectStore(BLOBS_STORE).delete(id);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(tx.error?.message ?? 'delete failed'));
      tx.onabort = () => reject(new Error(tx.error?.message ?? 'delete aborted'));
    });
  }

  async list(documentId: string): Promise<Attachment[]> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const index = tx.objectStore(METADATA_STORE).index('documentId');
      const request = index.getAll(documentId);

      request.onsuccess = () => resolve(request.result as Attachment[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'list failed'));
    });
  }

  async getUsage(): Promise<{ totalSize: number; count: number }> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const request = store.openCursor();

      let totalSize = 0;
      let count = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const att = cursor.value as Attachment;
          totalSize += att.size;
          count++;
          cursor.continue();
        } else {
          resolve({ totalSize, count });
        }
      };

      request.onerror = () => reject(new Error(request.error?.message ?? 'getUsage failed'));
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDBAttachmentStore not initialized – call initialize() first');
    }
    return this.db;
  }
}

/**
 * Create and initialize an {@link IndexedDBAttachmentStore}.
 *
 * @param dbName - IndexedDB database name (defaults to `_pocket_attachments`).
 */
export async function createIndexedDBAttachmentStore(
  dbName?: string,
): Promise<IndexedDBAttachmentStore> {
  const store = new IndexedDBAttachmentStore(dbName);
  await store.initialize();
  return store;
}

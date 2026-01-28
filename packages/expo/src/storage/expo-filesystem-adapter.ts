/**
 * Expo FileSystem Storage Adapter
 *
 * Storage adapter that uses expo-file-system for data persistence.
 * Stores each collection as a JSON file.
 *
 * @module @pocket/expo/storage
 */

/* eslint-disable @typescript-eslint/no-deprecated -- expo-file-system legacy API, will be updated when they stabilize new API */
/* eslint-disable @typescript-eslint/consistent-type-imports -- Dynamic imports needed for React Native */
/* eslint-disable @typescript-eslint/no-require-imports -- Dynamic imports needed for React Native */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { Observable, Subject } from 'rxjs';

/**
 * Expo FileSystem configuration
 */
export interface ExpoFileSystemConfig {
  /** Base directory for storage (defaults to documentDirectory) */
  baseDirectory?: string;
  /** Subdirectory for Pocket data */
  subdirectory?: string;
}

/**
 * Document store implementation for Expo FileSystem
 */
class ExpoFileSystemDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private documents = new Map<string, T>();
  private filePath: string;
  private FileSystem: typeof import('expo-file-system');
  private loaded = false;
  private sequenceCounter = 0;

  constructor(FileSystem: typeof import('expo-file-system'), filePath: string, name: string) {
    this.FileSystem = FileSystem;
    this.filePath = filePath;
    this.name = name;
  }

  private emitChange(
    operation: ChangeOperation,
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document,
      previousDocument,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await this.FileSystem.readAsStringAsync(this.filePath);
      const docs = JSON.parse(content) as T[];
      for (const doc of docs) {
        this.documents.set(doc._id, doc);
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    this.loaded = true;
  }

  private async save(): Promise<void> {
    const docs = Array.from(this.documents.values());
    await this.FileSystem.writeAsStringAsync(this.filePath, JSON.stringify(docs, null, 2));
  }

  async get(id: string): Promise<T | null> {
    await this.ensureLoaded();
    return this.documents.get(id) ?? null;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    await this.ensureLoaded();
    return ids.map((id) => this.documents.get(id) ?? null);
  }

  async getAll(): Promise<T[]> {
    await this.ensureLoaded();
    return Array.from(this.documents.values());
  }

  async put(doc: T): Promise<T> {
    await this.ensureLoaded();
    const existing = this.documents.get(doc._id);
    this.documents.set(doc._id, doc);
    await this.save();
    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, doc._id, doc, existing);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    await this.ensureLoaded();
    const existingDocs = new Map<string, T | undefined>();
    for (const doc of docs) {
      existingDocs.set(doc._id, this.documents.get(doc._id));
      this.documents.set(doc._id, doc);
    }
    await this.save();
    for (const doc of docs) {
      const existing = existingDocs.get(doc._id);
      const operation: ChangeOperation = existing ? 'update' : 'insert';
      this.emitChange(operation, doc._id, doc, existing);
    }
    return docs;
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.documents.get(id);
    if (!existing) return;

    this.documents.delete(id);
    await this.save();
    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    await this.ensureLoaded();
    const deletedDocs: { id: string; doc: T }[] = [];
    for (const id of ids) {
      const existing = this.documents.get(id);
      if (existing) {
        this.documents.delete(id);
        deletedDocs.push({ id, doc: existing });
      }
    }
    await this.save();
    for (const { id, doc } of deletedDocs) {
      this.emitChange('delete', id, null, doc);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    await this.ensureLoaded();
    let results = Array.from(this.documents.values());

    if (query.spec.filter) {
      results = results.filter((doc) => {
        for (const [key, value] of Object.entries(query.spec.filter!)) {
          if ((doc as Record<string, unknown>)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    if (query.spec.sort && query.spec.sort.length > 0) {
      results.sort((a, b) => {
        for (const sort of query.spec.sort!) {
          const aVal = (a as Record<string, unknown>)[sort.field] as
            | string
            | number
            | boolean
            | null
            | undefined;
          const bVal = (b as Record<string, unknown>)[sort.field] as
            | string
            | number
            | boolean
            | null
            | undefined;

          let cmp = 0;
          if (aVal == null && bVal != null) cmp = -1;
          else if (aVal != null && bVal == null) cmp = 1;
          else if (aVal != null && bVal != null) {
            if (aVal < bVal) cmp = -1;
            else if (aVal > bVal) cmp = 1;
          }

          if (cmp !== 0) {
            return sort.direction === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    if (query.spec.skip) {
      results = results.slice(query.spec.skip);
    }

    if (query.spec.limit) {
      results = results.slice(0, query.spec.limit);
    }

    return results;
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query) {
      await this.ensureLoaded();
      return this.documents.size;
    }

    const results = await this.query(query);
    return results.length;
  }

  async createIndex(_index: IndexDefinition): Promise<void> {
    // File-based storage doesn't support indexes
    // Just a no-op for compatibility
  }

  async dropIndex(_name: string): Promise<void> {
    // No-op
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    return [];
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    // Get all documents to emit delete events
    const docs = Array.from(this.documents.values());
    this.documents.clear();
    await this.save();

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }
}

/**
 * Expo FileSystem storage adapter
 */
class ExpoFileSystemAdapter implements StorageAdapter {
  readonly name = 'expo-filesystem';
  private FileSystem: typeof import('expo-file-system') | null = null;
  private baseDir = '';
  private stores = new Map<string, DocumentStore<Document>>();
  private config: ExpoFileSystemConfig;

  constructor(config: ExpoFileSystemConfig = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    try {
      require('expo-file-system');
      return true;
    } catch {
      return false;
    }
  }

  async initialize(config: StorageConfig): Promise<void> {
    this.FileSystem = require('expo-file-system') as typeof import('expo-file-system');

    const baseDir =
      this.config.baseDirectory ??
      (this.FileSystem as { documentDirectory?: string | null }).documentDirectory ??
      '';
    const subDir = this.config.subdirectory ?? 'pocket';

    this.baseDir = `${baseDir}${subDir}/${config.name}/`;

    // Ensure directory exists
    const dirInfo = await this.FileSystem.getInfoAsync(this.baseDir);
    if (!dirInfo.exists) {
      await this.FileSystem.makeDirectoryAsync(this.baseDir, {
        intermediates: true,
      });
    }
  }

  async close(): Promise<void> {
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.FileSystem) {
      throw new Error('Storage not initialized');
    }

    if (!this.stores.has(name)) {
      const filePath = `${this.baseDir}${name}.json`;
      this.stores.set(
        name,
        new ExpoFileSystemDocumentStore<Document>(this.FileSystem, filePath, name)
      );
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    if (!this.FileSystem) return [];

    try {
      const files = await this.FileSystem.readDirectoryAsync(this.baseDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async deleteStore(name: string): Promise<void> {
    if (!this.FileSystem) return;

    const filePath = `${this.baseDir}${name}.json`;

    try {
      await this.FileSystem.deleteAsync(filePath, { idempotent: true });
    } catch {
      // File might not exist
    }

    this.stores.delete(name);
  }

  async transaction<R>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // FileSystem doesn't support transactions, just run the function
    return fn();
  }

  async getStats(): Promise<StorageStats> {
    const stores = await this.listStores();
    let documentCount = 0;
    let storageSize = 0;
    let indexCount = 0;

    for (const storeName of stores) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;

      if (this.FileSystem) {
        try {
          const filePath = `${this.baseDir}${storeName}.json`;
          const info = await this.FileSystem.getInfoAsync(filePath);
          if (info.exists && 'size' in info) {
            storageSize += info.size;
          }
        } catch {
          // Ignore errors
        }
      }
    }

    return {
      documentCount,
      storeCount: stores.length,
      storageSize,
      indexCount,
    };
  }
}

/**
 * Create an Expo FileSystem storage adapter
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createExpoFileSystemStorage } from '@pocket/expo';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createExpoFileSystemStorage(),
 * });
 * ```
 */
export function createExpoFileSystemStorage(config: ExpoFileSystemConfig = {}): StorageAdapter {
  return new ExpoFileSystemAdapter(config);
}

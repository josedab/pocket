import type {
  ChangeEvent,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { QueryExecutor, matchesFilter } from '@pocket/core';
import { Observable, Subject } from 'rxjs';
import type { WorkerRequest, WorkerResponse } from './worker.js';

/**
 * OPFS adapter options
 */
export interface OPFSAdapterOptions {
  /** URL to the worker script */
  workerUrl?: string;
  /** Use worker for operations (recommended for performance) */
  useWorker?: boolean;
}

/**
 * OPFS document store
 */
class OPFSDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;

  private readonly adapter: OPFSAdapter;
  private changes$ = new Subject<ChangeEvent<T>>();
  private sequenceCounter = 0;
  private indexes = new Map<string, NormalizedIndex>();

  constructor(name: string, adapter: OPFSAdapter) {
    this.name = name;
    this.adapter = adapter;
  }

  async get(id: string): Promise<T | null> {
    return this.adapter.workerRequest<T | null>({
      type: 'get',
      collection: this.name,
      id,
    });
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];
    for (const id of ids) {
      results.push(await this.get(id));
    }
    return results;
  }

  async getAll(): Promise<T[]> {
    const docs = await this.adapter.workerRequest<T[]>({
      type: 'getAll',
      collection: this.name,
    });
    return docs ?? [];
  }

  async put(doc: T): Promise<T> {
    const existing = await this.get(doc._id);
    const operation: ChangeEvent<T>['operation'] = existing ? 'update' : 'insert';

    const saved = await this.adapter.workerRequest<T>({
      type: 'put',
      collection: this.name,
      doc,
    });

    if (saved) {
      this.emitChange(operation, doc._id, saved, existing ?? undefined);
    }

    return saved ?? doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    // Get existing for change events
    const existingMap = new Map<string, T | null>();
    for (const doc of docs) {
      existingMap.set(doc._id, await this.get(doc._id));
    }

    const saved = await this.adapter.workerRequest<T[]>({
      type: 'bulkPut',
      collection: this.name,
      docs,
    });

    // Emit changes
    if (saved) {
      for (const doc of saved) {
        const existing = existingMap.get(doc._id);
        const operation: ChangeEvent<T>['operation'] = existing ? 'update' : 'insert';
        this.emitChange(operation, doc._id, doc, existing ?? undefined);
      }
    }

    return saved ?? docs;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);

    await this.adapter.workerRequest<void>({
      type: 'delete',
      collection: this.name,
      id,
    });

    if (existing) {
      this.emitChange('delete', id, null, existing);
    }
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    const docs = await this.getAll();
    const executor = new QueryExecutor<T>();
    const result = executor.execute(docs, query.spec);
    return result.documents;
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    const docs = await this.getAll();
    if (!query || !query.spec.filter) {
      return docs.length;
    }
    return docs.filter((doc) => matchesFilter(doc, query.spec.filter!)).length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = this.normalizeIndex(index);
    this.indexes.set(normalized.name, normalized);
  }

  async dropIndex(name: string): Promise<void> {
    this.indexes.delete(name);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    return Array.from(this.indexes.values());
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    const docs = await this.getAll();

    await this.adapter.workerRequest<void>({
      type: 'clear',
      collection: this.name,
    });

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  private emitChange(
    operation: ChangeEvent<T>['operation'],
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document: document ? structuredClone(document) : null,
      previousDocument: previousDocument ? structuredClone(previousDocument) : undefined,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  private normalizeIndex(index: IndexDefinition): NormalizedIndex {
    const fields: IndexField[] = index.fields.map((f) =>
      typeof f === 'string'
        ? { field: f, direction: 'asc' as const }
        : { field: f.field, direction: f.direction ?? ('asc' as const) }
    );

    const name = index.name ?? fields.map((f) => f.field).join('_');

    return {
      name,
      fields,
      unique: index.unique ?? false,
      sparse: index.sparse ?? false,
    };
  }

  destroy(): void {
    this.changes$.complete();
  }
}

/**
 * OPFS storage adapter
 */
export class OPFSAdapter implements StorageAdapter {
  readonly name = 'opfs';

  private readonly options: Required<OPFSAdapterOptions>;
  private worker: Worker | null = null;
  private stores = new Map<string, OPFSDocumentStore<Document>>();
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(options: OPFSAdapterOptions = {}) {
    this.options = {
      workerUrl: options.workerUrl ?? '',
      useWorker: options.useWorker ?? true,
    };
  }

  isAvailable(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      'getDirectory' in navigator.storage
    );
  }

  async initialize(config: StorageConfig): Promise<void> {
    if (this.options.useWorker && this.options.workerUrl) {
      this.worker = new Worker(this.options.workerUrl, { type: 'module' });
      this.worker.onmessage = (event) => this.handleWorkerMessage(event);

      await this.workerRequest({ type: 'init', dbName: config.name });
    } else {
      // Direct OPFS access (not recommended for main thread)
      const root = await navigator.storage.getDirectory();
      await root.getDirectoryHandle(config.name, { create: true });
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.workerRequest({ type: 'close' });
      this.worker.terminate();
      this.worker = null;
    }

    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    let store = this.stores.get(name);

    if (!store) {
      store = new OPFSDocumentStore(name, this);
      this.stores.set(name, store);
    }

    return store as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }

  async deleteStore(name: string): Promise<void> {
    const store = this.stores.get(name);
    if (store) {
      await store.clear();
      store.destroy();
      this.stores.delete(name);
    }
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    return fn();
  }

  async getStats(): Promise<StorageStats> {
    let documentCount = 0;
    let indexCount = 0;

    for (const store of this.stores.values()) {
      const docs = await store.getAll();
      documentCount += docs.length;
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    // Try to get storage estimate
    let storageSize = 0;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        storageSize = estimate.usage ?? 0;
      } catch {
        // Ignore
      }
    }

    return {
      documentCount,
      storageSize,
      storeCount: this.stores.size,
      indexCount,
    };
  }

  /**
   * Send a request to the worker
   */
  async workerRequest<T>(request: WorkerRequest): Promise<T | null> {
    if (!this.worker) {
      // Fallback to direct access (not implemented in this example)
      throw new Error('OPFS worker not initialized');
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.worker!.postMessage({ ...request, requestId: id });
    });
  }

  /**
   * Handle worker response
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse & { requestId?: number }>): void {
    const { requestId, ...response } = event.data;

    if (requestId !== undefined) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);

        if (response.type === 'success') {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.message));
        }
      }
    }
  }
}

/**
 * Create an OPFS storage adapter
 */
export function createOPFSStorage(options?: OPFSAdapterOptions): OPFSAdapter {
  return new OPFSAdapter(options);
}

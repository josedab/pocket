import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { LiveQuery, type LiveQueryOptions } from '../observable/live-query.js';
import { QueryBuilder } from '../query/query-builder.js';
import { Schema, type CollectionConfig, type ValidationResult } from '../schema/schema.js';
import type { ChangeEvent, Document, DocumentUpdate, NewDocument } from '../types/document.js';
import type { QuerySpec } from '../types/query.js';
import type {
  DocumentStore,
  IndexDefinition,
  NormalizedIndex,
  StorageQuery,
} from '../types/storage.js';
import {
  cloneDocument,
  prepareDocumentUpdate,
  prepareNewDocument,
  prepareSoftDelete,
} from './document.js';

/**
 * Collection class - main interface for working with documents
 */
export class Collection<T extends Document = Document> {
  readonly name: string;
  readonly schema?: Schema<T>;

  private readonly store: DocumentStore<T>;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private readonly nodeId?: string;
  private sequenceCounter = 0;
  private isInitialized = false;
  private readonly syncEnabled: boolean;

  constructor(config: CollectionConfig<T>, store: DocumentStore<T>, nodeId?: string) {
    this.name = config.name;
    this.store = store;
    this.nodeId = nodeId;
    this.syncEnabled = config.sync ?? false;

    if (config.schema) {
      this.schema = new Schema<T>(config.schema);
    }
  }

  /**
   * Initialize the collection (create indexes, etc.)
   */
  async initialize(indexes?: IndexDefinition[]): Promise<void> {
    if (this.isInitialized) return;

    if (indexes) {
      for (const index of indexes) {
        await this.store.createIndex(index);
      }
    }

    this.isInitialized = true;
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<T | null> {
    const doc = await this.store.get(id);
    if (doc && doc._deleted) {
      return null;
    }
    return doc;
  }

  /**
   * Get multiple documents by IDs
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    const docs = await this.store.getMany(ids);
    return docs.map((doc) => (doc && !doc._deleted ? doc : null));
  }

  /**
   * Get all documents in the collection
   */
  async getAll(): Promise<T[]> {
    const docs = await this.store.getAll();
    return docs.filter((doc) => !doc._deleted);
  }

  /**
   * Apply schema defaults and validate a document
   * @throws ValidationError if validation fails
   */
  private applySchemaAndValidate(doc: NewDocument<T>): NewDocument<T> {
    if (!this.schema) {
      return doc;
    }

    const prepared = this.schema.applyDefaults(
      doc as unknown as Partial<T>
    ) as unknown as NewDocument<T>;
    const validation = this.schema.validate(prepared as unknown as Partial<T>);
    if (!validation.valid) {
      throw new ValidationError(validation);
    }
    return prepared;
  }

  /**
   * Insert a new document
   */
  async insert(doc: NewDocument<T>): Promise<T> {
    const prepared = this.applySchemaAndValidate(doc);
    const newDoc = prepareNewDocument<T>(prepared, this.nodeId);
    const saved = await this.store.put(newDoc);

    this.emitChange('insert', saved._id, saved, undefined);

    return saved;
  }

  /**
   * Insert multiple documents
   */
  async insertMany(docs: NewDocument<T>[]): Promise<T[]> {
    const preparedDocs = docs.map((doc) => {
      const prepared = this.applySchemaAndValidate(doc);
      return prepareNewDocument<T>(prepared, this.nodeId);
    });

    const saved = await this.store.bulkPut(preparedDocs);

    for (const doc of saved) {
      this.emitChange('insert', doc._id, doc, undefined);
    }

    return saved;
  }

  /**
   * Update a document by ID
   */
  async update(id: string, changes: DocumentUpdate<T>): Promise<T> {
    const existing = await this.store.get(id);
    if (!existing) {
      throw new Error(`Document with id "${id}" not found`);
    }
    if (existing._deleted) {
      throw new Error(`Document with id "${id}" has been deleted`);
    }

    const updated = prepareDocumentUpdate(existing, changes, this.nodeId);

    // Validate if schema exists
    if (this.schema) {
      const validation = this.schema.validate(updated);
      if (!validation.valid) {
        throw new ValidationError(validation);
      }
    }

    const saved = await this.store.put(updated);
    this.emitChange('update', saved._id, saved, existing);

    return saved;
  }

  /**
   * Upsert a document (insert or update)
   */
  async upsert(id: string, doc: NewDocument<T> | DocumentUpdate<T>): Promise<T> {
    const existing = await this.store.get(id);

    if (existing && !existing._deleted) {
      return this.update(id, doc as DocumentUpdate<T>);
    } else {
      return this.insert({ ...doc, _id: id } as NewDocument<T>);
    }
  }

  /**
   * Delete a document by ID (soft delete)
   */
  async delete(id: string): Promise<void> {
    const existing = await this.store.get(id);
    if (!existing) {
      return; // Already doesn't exist
    }
    if (existing._deleted) {
      return; // Already deleted
    }

    if (this.syncEnabled) {
      // Soft delete for sync
      const deleted = prepareSoftDelete(existing, this.nodeId);
      await this.store.put(deleted);
    } else {
      // Hard delete
      await this.store.delete(id);
    }

    this.emitChange('delete', id, null, existing);
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  /**
   * Hard delete a document (remove from storage)
   */
  async hardDelete(id: string): Promise<void> {
    const existing = await this.store.get(id);
    await this.store.delete(id);

    if (existing) {
      this.emitChange('delete', id, null, existing);
    }
  }

  /**
   * Create a query builder
   */
  find(filter?: Partial<T>): QueryBuilder<T> {
    const builder = new QueryBuilder<T>(
      async (spec) => this.executeQuery(spec),
      () => this.createLiveQuery.bind(this)
    );

    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        builder.where(key as keyof T & string).equals(value as T[keyof T & string]);
      }
    }

    return builder;
  }

  /**
   * Find a single document
   */
  async findOne(filter?: Partial<T>): Promise<T | null> {
    const results = await this.find(filter).limit(1).exec();
    return results[0] ?? null;
  }

  /**
   * Count documents matching filter
   */
  async count(filter?: Partial<T>): Promise<number> {
    if (!filter) {
      return this.store.count();
    }
    const query: StorageQuery<T> = {
      spec: { filter: filter as QuerySpec<T>['filter'] },
    };
    return this.store.count(query);
  }

  /**
   * Execute a query specification
   */
  async executeQuery(spec: QuerySpec<T>): Promise<T[]> {
    const query: StorageQuery<T> = { spec };
    const results = await this.store.query(query);
    return results.filter((doc) => !doc._deleted);
  }

  /**
   * Create a live query observable
   */
  createLiveQuery(spec: QuerySpec<T>, options?: LiveQueryOptions): LiveQuery<T> {
    return new LiveQuery<T>(spec, () => this.executeQuery(spec), this.changes$, options);
  }

  /**
   * Observe a single document by ID
   */
  observeById(id: string): Observable<T | null> {
    const initial$ = new BehaviorSubject<T | null>(null);

    // Load initial value
    this.get(id).then((doc) => initial$.next(doc));

    // Merge with changes
    return new Observable<T | null>((subscriber) => {
      // Subscribe to initial
      const initialSub = initial$.subscribe((doc) => subscriber.next(doc));

      // Subscribe to changes for this document
      const changesSub = this.changes$
        .pipe(
          filter((event) => event.documentId === id),
          map((event) => event.document)
        )
        .subscribe((doc) => subscriber.next(doc));

      return () => {
        initialSub.unsubscribe();
        changesSub.unsubscribe();
      };
    });
  }

  /**
   * Observable stream of all changes
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  /**
   * Create an index
   */
  async createIndex(index: IndexDefinition): Promise<void> {
    await this.store.createIndex(index);
  }

  /**
   * Drop an index
   */
  async dropIndex(name: string): Promise<void> {
    await this.store.dropIndex(name);
  }

  /**
   * Get all indexes
   */
  async getIndexes(): Promise<NormalizedIndex[]> {
    return this.store.getIndexes();
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    const docs = await this.getAll();
    await this.store.clear();

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /**
   * Emit a change event
   */
  private emitChange(
    operation: ChangeEvent<T>['operation'],
    documentId: string,
    document: T | null,
    previousDocument?: T,
    isFromSync = false
  ): void {
    this.sequenceCounter++;
    this.changes$.next({
      operation,
      documentId,
      document: document ? cloneDocument(document) : null,
      previousDocument: previousDocument ? cloneDocument(previousDocument) : undefined,
      isFromSync,
      timestamp: Date.now(),
      sequence: this.sequenceCounter,
    });
  }

  /**
   * Apply a change from sync (bypasses validation)
   */
  async applyRemoteChange(event: ChangeEvent<T>): Promise<void> {
    if (event.operation === 'delete') {
      if (this.syncEnabled && event.document) {
        await this.store.put(event.document);
      } else {
        await this.store.delete(event.documentId);
      }
    } else if (event.document) {
      await this.store.put(event.document);
    }

    this.emitChange(
      event.operation,
      event.documentId,
      event.document,
      event.previousDocument,
      true
    );
  }
}

/**
 * Validation error with details
 */
export class ValidationError extends Error {
  readonly validation: ValidationResult;

  constructor(validation: ValidationResult) {
    const messages = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Validation failed: ${messages}`);
    this.name = 'ValidationError';
    this.validation = validation;
  }
}

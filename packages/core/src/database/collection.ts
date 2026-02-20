import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { DocumentDeletedError, DocumentNotFoundError } from '../errors/pocket-error.js';
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
 * Collection class - the main interface for working with documents.
 *
 * A Collection represents a group of related documents, similar to a table
 * in SQL databases. Collections support CRUD operations, queries, reactive
 * subscriptions, indexing, and optional schema validation.
 *
 * @typeParam T - The document type stored in this collection
 *
 * @example Basic CRUD operations
 * ```typescript
 * interface User extends Document {
 *   name: string;
 *   email: string;
 *   age: number;
 * }
 *
 * const users = db.collection<User>('users');
 *
 * // Create
 * const alice = await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30 });
 *
 * // Read
 * const user = await users.get(alice._id);
 *
 * // Update
 * await users.update(alice._id, { age: 31 });
 *
 * // Delete
 * await users.delete(alice._id);
 * ```
 *
 * @example Reactive queries
 * ```typescript
 * // Subscribe to all active users
 * const activeUsers$ = users.find({ active: true }).live();
 *
 * activeUsers$.subscribe(users => {
 *   console.log('Active users:', users.length);
 * });
 * ```
 *
 * @example Observe single document
 * ```typescript
 * users.observeById('user-123').subscribe(user => {
 *   if (user) {
 *     console.log('User updated:', user.name);
 *   }
 * });
 * ```
 *
 * @see {@link Database.collection} for getting a collection
 * @see {@link QueryBuilder} for advanced queries
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
   * Get a document by its unique ID.
   *
   * Returns `null` if the document doesn't exist or has been soft-deleted.
   *
   * @param id - The document ID to retrieve
   * @returns The document if found, or `null` if not found/deleted
   *
   * @example
   * ```typescript
   * const user = await users.get('user-123');
   * if (user) {
   *   console.log('Found user:', user.name);
   * } else {
   *   console.log('User not found');
   * }
   * ```
   */
  async get(id: string): Promise<T | null> {
    const doc = await this.store.get(id);
    if (doc && doc._deleted) {
      return null;
    }
    return doc;
  }

  /**
   * Get multiple documents by their IDs in a single operation.
   *
   * More efficient than multiple {@link get} calls for batch retrieval.
   * Returns `null` for documents that don't exist or are deleted.
   *
   * @param ids - Array of document IDs to retrieve
   * @returns Array of documents (or `null`) in the same order as input IDs
   *
   * @example
   * ```typescript
   * const users = await collection.getMany(['id-1', 'id-2', 'id-3']);
   * // Returns: [User | null, User | null, User | null]
   *
   * const found = users.filter(Boolean);
   * console.log(`Found ${found.length} of 3 users`);
   * ```
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    const docs = await this.store.getMany(ids);
    return docs.map((doc) => (doc && !doc._deleted ? doc : null));
  }

  /**
   * Get all documents in the collection.
   *
   * For large collections, prefer using {@link find} with pagination
   * (skip/limit) to avoid loading everything into memory.
   *
   * @returns All non-deleted documents in the collection
   *
   * @example
   * ```typescript
   * const allUsers = await users.getAll();
   * console.log(`Total users: ${allUsers.length}`);
   * ```
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
   * Insert a new document into the collection.
   *
   * If no `_id` is provided, one will be auto-generated. The document
   * will be validated against the schema (if configured) before insertion.
   *
   * @param doc - The document to insert (without system fields)
   * @returns The inserted document with all system fields populated
   * @throws {@link ValidationError} if schema validation fails
   *
   * @example
   * ```typescript
   * // Auto-generated ID
   * const user = await users.insert({
   *   name: 'Alice',
   *   email: 'alice@example.com'
   * });
   * console.log(user._id); // e.g., '550e8400-e29b-41d4-a716-446655440000'
   *
   * // Custom ID
   * const admin = await users.insert({
   *   _id: 'admin',
   *   name: 'Admin',
   *   email: 'admin@example.com'
   * });
   * ```
   */
  async insert(doc: NewDocument<T>): Promise<T> {
    const prepared = this.applySchemaAndValidate(doc);
    const newDoc = prepareNewDocument<T>(prepared, this.nodeId);
    const saved = await this.store.put(newDoc);

    this.emitChange('insert', saved._id, saved, undefined);

    return saved;
  }

  /**
   * Insert multiple documents in a single batch operation.
   *
   * More efficient than multiple {@link insert} calls for bulk inserts.
   * All documents are validated before any are inserted.
   *
   * @param docs - Array of documents to insert
   * @returns Array of inserted documents with system fields populated
   * @throws {@link ValidationError} if any document fails schema validation
   *
   * @example
   * ```typescript
   * const newUsers = await users.insertMany([
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   *   { name: 'Charlie', email: 'charlie@example.com' }
   * ]);
   * console.log(`Inserted ${newUsers.length} users`);
   * ```
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
   * Update an existing document by ID.
   *
   * Only the specified fields are updated; other fields remain unchanged.
   * The updated document is validated against the schema (if configured).
   *
   * @param id - The document ID to update
   * @param changes - Partial document with fields to update
   * @returns The updated document
   * @throws Error if document not found or has been deleted
   * @throws {@link ValidationError} if schema validation fails
   *
   * @example
   * ```typescript
   * // Update specific fields
   * const updated = await users.update('user-123', {
   *   name: 'Alice Smith',
   *   age: 31
   * });
   *
   * // Increment a counter
   * const user = await users.get('user-123');
   * await users.update('user-123', { loginCount: user.loginCount + 1 });
   * ```
   */
  async update(id: string, changes: DocumentUpdate<T>): Promise<T> {
    const existing = await this.store.get(id);
    if (!existing) {
      throw new DocumentNotFoundError(this.name, id);
    }
    if (existing._deleted) {
      throw new DocumentDeletedError(this.name, id);
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
   * Insert or update a document by ID.
   *
   * If a document with the given ID exists, it's updated. Otherwise,
   * a new document is inserted with that ID.
   *
   * @param id - The document ID to upsert
   * @param doc - Document data to insert/update
   * @returns The upserted document
   * @throws {@link ValidationError} if schema validation fails
   *
   * @example
   * ```typescript
   * // Upsert user settings - creates if not exists, updates if exists
   * const settings = await collection.upsert('user-123-settings', {
   *   theme: 'dark',
   *   notifications: true
   * });
   * ```
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
   * Delete a document by ID.
   *
   * When sync is enabled, performs a soft delete (marks `_deleted: true`)
   * to allow the deletion to propagate to other clients. Otherwise,
   * performs a hard delete.
   *
   * @param id - The document ID to delete
   *
   * @example
   * ```typescript
   * await users.delete('user-123');
   *
   * // Document is no longer returned by queries
   * const user = await users.get('user-123');
   * console.log(user); // null
   * ```
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
   * Delete multiple documents by their IDs.
   *
   * @param ids - Array of document IDs to delete
   *
   * @example
   * ```typescript
   * await users.deleteMany(['user-1', 'user-2', 'user-3']);
   * ```
   */
  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  /**
   * Permanently delete a document from storage.
   *
   * Unlike {@link delete}, this always removes the document completely,
   * even when sync is enabled. Use with caution as the deletion won't
   * sync to other clients.
   *
   * @param id - The document ID to hard delete
   *
   * @example
   * ```typescript
   * // Permanently remove document (won't sync deletion)
   * await collection.hardDelete('temp-data-123');
   * ```
   */
  async hardDelete(id: string): Promise<void> {
    const existing = await this.store.get(id);
    await this.store.delete(id);

    if (existing) {
      this.emitChange('delete', id, null, existing);
    }
  }

  /**
   * Create a query builder for finding documents.
   *
   * Returns a fluent query builder that supports filtering, sorting,
   * pagination, and projection. Call {@link QueryBuilder.exec} to
   * execute the query or {@link QueryBuilder.live} for reactive results.
   *
   * @param filter - Optional simple equality filter for common cases
   * @returns A query builder instance for chaining
   *
   * @example Simple filter
   * ```typescript
   * // Find by field equality
   * const activeUsers = await users.find({ active: true }).exec();
   * ```
   *
   * @example Complex query
   * ```typescript
   * const results = await users
   *   .find()
   *   .where('age').greaterThan(18)
   *   .where('role').in(['admin', 'moderator'])
   *   .sort('createdAt', 'desc')
   *   .limit(10)
   *   .exec();
   * ```
   *
   * @example Live query
   * ```typescript
   * const todos$ = todos
   *   .find({ completed: false })
   *   .sort('priority', 'desc')
   *   .live();
   *
   * todos$.subscribe(items => {
   *   renderTodoList(items);
   * });
   * ```
   *
   * @see {@link QueryBuilder} for all query methods
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
   * Find a single document matching the filter.
   *
   * Shorthand for `find(filter).limit(1).exec()[0]`.
   *
   * @param filter - Optional equality filter
   * @returns The first matching document, or `null` if none found
   *
   * @example
   * ```typescript
   * const admin = await users.findOne({ role: 'admin' });
   * if (admin) {
   *   console.log('Admin:', admin.name);
   * }
   * ```
   */
  async findOne(filter?: Partial<T>): Promise<T | null> {
    const results = await this.find(filter).limit(1).exec();
    return results[0] ?? null;
  }

  /**
   * Count documents in the collection.
   *
   * @param filter - Optional filter to count only matching documents
   * @returns The number of documents matching the filter
   *
   * @example
   * ```typescript
   * const total = await users.count();
   * const admins = await users.count({ role: 'admin' });
   * console.log(`${admins} of ${total} users are admins`);
   * ```
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
   * Execute a query specification directly.
   *
   * For internal use and advanced scenarios. Most users should use
   * {@link find} instead for a more ergonomic API.
   *
   * @param spec - The query specification to execute
   * @returns Array of matching documents
   */
  async executeQuery(spec: QuerySpec<T>): Promise<T[]> {
    const query: StorageQuery<T> = { spec };
    const results = await this.store.query(query);
    return results.filter((doc) => !doc._deleted);
  }

  /**
   * Create a live query with manual lifecycle control.
   *
   * For most use cases, prefer using {@link QueryBuilder.live} which
   * handles lifecycle automatically.
   *
   * @param spec - The query specification
   * @param options - Live query options (debounce, EventReduce, etc.)
   * @returns A LiveQuery instance that must be manually started/stopped
   *
   * @see {@link LiveQuery}
   */
  createLiveQuery(spec: QuerySpec<T>, options?: LiveQueryOptions): LiveQuery<T> {
    return new LiveQuery<T>(spec, () => this.executeQuery(spec), this.changes$, options);
  }

  /**
   * Observe a single document by ID with reactive updates.
   *
   * The observable emits whenever the document is created, updated,
   * or deleted. Emits `null` if the document doesn't exist.
   *
   * @param id - The document ID to observe
   * @returns An observable that emits the document state
   *
   * @example
   * ```typescript
   * // React component
   * const [user, setUser] = useState<User | null>(null);
   *
   * useEffect(() => {
   *   const sub = users.observeById(userId).subscribe(setUser);
   *   return () => sub.unsubscribe();
   * }, [userId]);
   * ```
   *
   * @example With RxJS operators
   * ```typescript
   * users.observeById('user-123')
   *   .pipe(
   *     filter(Boolean),
   *     map(user => user.name)
   *   )
   *   .subscribe(name => console.log('Name:', name));
   * ```
   */
  observeById(id: string): Observable<T | null> {
    const initial$ = new BehaviorSubject<T | null>(null);

    // Load initial value
    void this.get(id).then((doc) => initial$.next(doc));

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
   * Get an observable stream of all changes in this collection.
   *
   * Emits {@link ChangeEvent} objects for every insert, update, and delete.
   * Useful for building custom reactive features or audit logging.
   *
   * @returns An observable of change events
   *
   * @example
   * ```typescript
   * collection.changes().subscribe(event => {
   *   console.log(`${event.operation}: ${event.documentId}`);
   *   if (event.operation === 'update') {
   *     console.log('Previous:', event.previousDocument);
   *     console.log('Current:', event.document);
   *   }
   * });
   * ```
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  /**
   * Create an index on one or more fields.
   *
   * Indexes improve query performance for frequently accessed fields.
   * Create indexes before the collection grows large for best results.
   *
   * @param index - Index definition specifying fields and options
   *
   * @example Single field index
   * ```typescript
   * await users.createIndex({
   *   name: 'email-idx',
   *   fields: ['email'],
   *   unique: true
   * });
   * ```
   *
   * @example Compound index
   * ```typescript
   * await todos.createIndex({
   *   name: 'status-priority-idx',
   *   fields: [
   *     { field: 'status', direction: 'asc' },
   *     { field: 'priority', direction: 'desc' }
   *   ]
   * });
   * ```
   *
   * @see {@link IndexDefinition}
   */
  async createIndex(index: IndexDefinition): Promise<void> {
    await this.store.createIndex(index);
  }

  /**
   * Remove an index by name.
   *
   * @param name - The name of the index to drop
   *
   * @example
   * ```typescript
   * await collection.dropIndex('email-idx');
   * ```
   */
  async dropIndex(name: string): Promise<void> {
    await this.store.dropIndex(name);
  }

  /**
   * Get all indexes defined on this collection.
   *
   * @returns Array of normalized index definitions
   *
   * @example
   * ```typescript
   * const indexes = await collection.getIndexes();
   * console.log('Indexes:', indexes.map(i => i.name));
   * ```
   */
  async getIndexes(): Promise<NormalizedIndex[]> {
    return this.store.getIndexes();
  }

  /**
   * Remove all documents from the collection.
   *
   * This operation is permanent and emits delete events for all documents.
   * Indexes and schema configuration are preserved.
   *
   * @example
   * ```typescript
   * await tempData.clear();
   * console.log(await tempData.count()); // 0
   * ```
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
   * Apply a remote change from the sync engine.
   *
   * This method bypasses schema validation as remote changes have already
   * been validated on the server. Used internally by the sync system.
   *
   * @param event - The change event received from sync
   * @internal
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

  /** Release resources held by this collection */
  destroy(): void {
    this.changes$.complete();
  }
}

/**
 * Error thrown when a document fails schema validation.
 *
 * Contains detailed information about which fields failed validation
 * and why, enabling precise error messages to users.
 *
 * @example Handling validation errors
 * ```typescript
 * try {
 *   await users.insert({ name: '', age: -5 });
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.log('Validation failed:');
 *     for (const err of error.validation.errors) {
 *       console.log(`  ${err.path}: ${err.message}`);
 *     }
 *     // Output:
 *     //   name: String must be at least 1 characters
 *     //   age: Value must be at least 0
 *   }
 * }
 * ```
 *
 * @see {@link ValidationResult}
 * @see {@link Schema.validate}
 */
export class ValidationError extends Error {
  /** The full validation result with all errors */
  readonly validation: ValidationResult;

  /**
   * Create a new ValidationError.
   *
   * @param validation - The validation result containing errors
   */
  constructor(validation: ValidationResult) {
    const messages = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Validation failed: ${messages}`);
    this.name = 'ValidationError';
    this.validation = validation;
  }
}

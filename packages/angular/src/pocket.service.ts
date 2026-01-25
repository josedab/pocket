/**
 * Angular Service for Pocket Database
 *
 * Injectable service that provides access to Pocket database operations.
 *
 * @module @pocket/angular
 */

import type { Collection, Database, Document, QueryBuilder, StorageAdapter } from '@pocket/core';
import { Observable, shareReplay, switchMap } from 'rxjs';

/**
 * Pocket service configuration
 */
export interface PocketServiceConfig {
  /** Database name */
  name: string;
  /** Storage type or adapter */
  storage: 'indexeddb' | 'opfs' | 'memory' | StorageAdapter;
  /** Additional database options */
  options?: Record<string, unknown>;
}

/**
 * Angular service for Pocket database operations.
 *
 * @example
 * ```typescript
 * @Component({
 *   selector: 'app-users',
 *   template: `
 *     <ul>
 *       <li *ngFor="let user of users$ | async">{{ user.name }}</li>
 *     </ul>
 *   `
 * })
 * export class UsersComponent {
 *   users$ = this.pocket.liveQuery<User>('users');
 *
 *   constructor(private pocket: PocketService) {}
 *
 *   async addUser(name: string) {
 *     await this.pocket.collection('users').insert({ name });
 *   }
 * }
 * ```
 */
export class PocketService {
  private databasePromise: Promise<Database> | null = null;
  private database$: Observable<Database>;

  constructor() {
    // Initialize database observable (will be configured via provider)
    this.database$ = new Observable<Database>((subscriber) => {
      this.getDatabase()
        .then((db) => {
          subscriber.next(db);
          // Don't complete - keep the observable alive
        })
        .catch((err: unknown) => subscriber.error(err));
    }).pipe(shareReplay(1));
  }

  /**
   * Initialize the service with configuration
   * Called by the provider
   */
  initialize(config: PocketServiceConfig): void {
    this.databasePromise = this.createDatabase(config);
  }

  /**
   * Create the database instance
   */
  private async createDatabase(config: PocketServiceConfig): Promise<Database> {
    // Dynamic import to support tree-shaking
    const { Database } = await import('@pocket/core');

    // Resolve storage adapter
    let storage: StorageAdapter;
    if (typeof config.storage === 'string') {
      switch (config.storage) {
        case 'indexeddb': {
          const { createIndexedDBStorage } = await import('@pocket/storage-indexeddb');
          storage = createIndexedDBStorage();
          break;
        }
        case 'opfs': {
          const { createOPFSStorage } = await import('@pocket/storage-opfs');
          storage = createOPFSStorage();
          break;
        }
        case 'memory':
        default: {
          const { createMemoryStorage } = await import('@pocket/storage-memory');
          storage = createMemoryStorage();
          break;
        }
      }
    } else {
      storage = config.storage;
    }

    return Database.create({
      name: config.name,
      storage,
      ...config.options,
    });
  }

  /**
   * Get the database instance
   */
  async getDatabase(): Promise<Database> {
    if (!this.databasePromise) {
      throw new Error(
        'PocketService not initialized. Use providePocket() or PocketModule.forRoot()'
      );
    }
    return this.databasePromise;
  }

  /**
   * Get a collection by name
   */
  async collection<T extends Document>(name: string): Promise<Collection<T>> {
    const db = await this.getDatabase();
    return db.collection<T>(name);
  }

  /**
   * Create a live query observable
   *
   * @example
   * ```typescript
   * users$ = this.pocket.liveQuery<User>('users', (q) =>
   *   q.where('active').equals(true).orderBy('name')
   * );
   * ```
   */
  liveQuery<T extends Document>(
    collectionName: string,
    queryFn?: (collection: Collection<T>) => QueryBuilder<T>
  ): Observable<T[]> {
    return this.database$.pipe(
      switchMap((db) => {
        const collection = db.collection<T>(collectionName);
        const builder = queryFn ? queryFn(collection) : collection.find();
        return builder.live();
      })
    );
  }

  /**
   * Get a single document by ID as an observable
   */
  document<T extends Document>(collectionName: string, id: string): Observable<T | null> {
    return this.database$.pipe(
      switchMap((db) => {
        const collection = db.collection<T>(collectionName);
        return collection.observeById(id);
      })
    );
  }

  /**
   * Insert a document
   */
  async insert<T extends Document>(collectionName: string, doc: Omit<T, '_id'>): Promise<T> {
    const collection = await this.collection<T>(collectionName);
    return collection.insert(doc as T);
  }

  /**
   * Update a document
   */
  async update<T extends Document>(
    collectionName: string,
    id: string,
    changes: Partial<T>
  ): Promise<T | null> {
    const collection = await this.collection<T>(collectionName);
    return collection.update(id, changes);
  }

  /**
   * Delete a document
   */
  async delete(collectionName: string, id: string): Promise<void> {
    const collection = await this.collection(collectionName);
    await collection.delete(id);
  }

  /**
   * Get database as an observable (for advanced use)
   */
  get db$(): Observable<Database> {
    return this.database$;
  }
}

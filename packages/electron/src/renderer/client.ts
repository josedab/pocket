/**
 * Electron Renderer Client
 *
 * Client-side API for interacting with Pocket from the renderer process.
 *
 * @module @pocket/electron/renderer
 */

import type { Document } from '@pocket/core';
import { Observable, Subject, shareReplay, startWith, switchMap } from 'rxjs';
import type { PocketAPI } from '../preload/index.js';

// Re-declare Window.pocket for the renderer context (non-optional, matching preload)
declare global {
  interface Window {
    pocket: PocketAPI;
  }
}

/**
 * Query options for the renderer client
 */
export interface QueryOptions {
  filter?: Record<string, unknown>;
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

/**
 * Pocket collection client for the renderer process
 */
export class RendererCollection<T extends Document> {
  private collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<T | null> {
    return window.pocket.get<T>(this.collectionName, id);
  }

  /**
   * Get multiple documents by IDs
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    return window.pocket.getMany<T>(this.collectionName, ids);
  }

  /**
   * Get all documents in the collection
   */
  async getAll(): Promise<T[]> {
    return window.pocket.getAll<T>(this.collectionName);
  }

  /**
   * Insert or update a document
   */
  async put(doc: T): Promise<T> {
    return window.pocket.put<T>(this.collectionName, doc);
  }

  /**
   * Insert or update multiple documents
   */
  async bulkPut(docs: T[]): Promise<T[]> {
    return window.pocket.bulkPut<T>(this.collectionName, docs);
  }

  /**
   * Delete a document by ID
   */
  async delete(id: string): Promise<void> {
    return window.pocket.delete(this.collectionName, id);
  }

  /**
   * Delete multiple documents by IDs
   */
  async bulkDelete(ids: string[]): Promise<void> {
    return window.pocket.bulkDelete(this.collectionName, ids);
  }

  /**
   * Query documents with filters, sorting, and pagination
   */
  async query(options?: QueryOptions): Promise<T[]> {
    return window.pocket.query<T>(this.collectionName, options);
  }

  /**
   * Count documents matching a filter
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    return window.pocket.count(this.collectionName, filter);
  }

  /**
   * Clear all documents in the collection
   */
  async clear(): Promise<void> {
    await window.pocket.clear(this.collectionName);
  }

  /**
   * Subscribe to collection changes
   */
  subscribe(callback: (docs: T[]) => void): Promise<{ unsubscribe: () => void }> {
    return window.pocket.subscribe(this.collectionName, callback as (docs: Document[]) => void);
  }

  /**
   * Create an observable for collection changes
   */
  changes$(): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      let unsubscribe: (() => void) | null = null;

      // Initial fetch
      this.getAll()
        .then((docs) => subscriber.next(docs))
        .catch((err: unknown) => subscriber.error(err));

      // Subscribe to changes
      this.subscribe((docs) => {
        subscriber.next(docs);
      })
        .then((sub) => {
          unsubscribe = sub.unsubscribe;
        })
        .catch((err: unknown) => subscriber.error(err));

      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }).pipe(shareReplay(1));
  }

  /**
   * Create an observable for a single document
   */
  document$(id: string): Observable<T | null> {
    const refresh$ = new Subject<void>();

    return refresh$.pipe(
      startWith(undefined),
      switchMap(() => this.get(id)),
      shareReplay(1)
    );
  }
}

/**
 * Pocket client for the renderer process
 */
export class PocketClient {
  private initialized = false;
  private collections = new Map<string, RendererCollection<Document>>();

  /**
   * Initialize the database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pocket may not be exposed if preload script didn't run
    if (!window.pocket) {
      throw new Error(
        'Pocket API not found. Make sure exposePocketAPI() is called in your preload script.'
      );
    }

    await window.pocket.init();
    this.initialized = true;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await window.pocket.close();
    this.collections.clear();
    this.initialized = false;
  }

  /**
   * Get a collection by name
   */
  collection<T extends Document>(name: string): RendererCollection<T> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new RendererCollection<T>(name));
    }

    return this.collections.get(name) as RendererCollection<T>;
  }

  /**
   * List all collection names
   */
  async listCollections(): Promise<string[]> {
    return window.pocket.listCollections();
  }

  /**
   * Check if the client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a Pocket client for the renderer process
 *
 * @example
 * ```typescript
 * // In your renderer process
 * import { createPocketClient } from '@pocket/electron/renderer';
 *
 * const client = await createPocketClient();
 *
 * // Use the client
 * const users = client.collection<User>('users');
 * const allUsers = await users.getAll();
 *
 * // Subscribe to changes
 * users.changes$().subscribe(docs => {
 *   console.log('Users updated:', docs);
 * });
 * ```
 */
export async function createPocketClient(): Promise<PocketClient> {
  const client = new PocketClient();
  await client.initialize();
  return client;
}

/**
 * Singleton instance of the Pocket client
 */
let sharedClient: PocketClient | null = null;

/**
 * Get the shared Pocket client instance
 *
 * @example
 * ```typescript
 * import { getPocketClient } from '@pocket/electron/renderer';
 *
 * // First call initializes the client
 * const client = await getPocketClient();
 *
 * // Subsequent calls return the same instance
 * const sameClient = await getPocketClient();
 * ```
 */
export async function getPocketClient(): Promise<PocketClient> {
  sharedClient ??= await createPocketClient();
  return sharedClient;
}

/**
 * Hook-like helper for use with React in the renderer
 */
export function createCollectionAccessor<T extends Document>(
  collectionName: string
): RendererCollection<T> {
  return new RendererCollection<T>(collectionName);
}

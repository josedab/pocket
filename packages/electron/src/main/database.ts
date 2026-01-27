/**
 * Electron Main Process Database
 *
 * Database operations for the Electron main process using better-sqlite3.
 *
 * @module @pocket/electron/main
 */

import type { Document, StorageAdapter } from '@pocket/core';
import { Database as PocketDatabase } from '@pocket/core';
import { createSQLiteStorage } from '@pocket/storage-sqlite';
import type { IpcMainInvokeEvent } from 'electron';
import { app, ipcMain } from 'electron';
import * as path from 'path';

/**
 * IPC channel names for database operations
 */
export const IPC_CHANNELS = {
  INIT: 'pocket:init',
  CLOSE: 'pocket:close',
  GET: 'pocket:get',
  GET_MANY: 'pocket:getMany',
  GET_ALL: 'pocket:getAll',
  PUT: 'pocket:put',
  BULK_PUT: 'pocket:bulkPut',
  DELETE: 'pocket:delete',
  BULK_DELETE: 'pocket:bulkDelete',
  QUERY: 'pocket:query',
  COUNT: 'pocket:count',
  CLEAR: 'pocket:clear',
  LIST_COLLECTIONS: 'pocket:listCollections',
  SUBSCRIBE: 'pocket:subscribe',
  UNSUBSCRIBE: 'pocket:unsubscribe',
} as const;

/**
 * Configuration for the main process database
 */
export interface MainDatabaseConfig {
  /** Database name (used for file naming) */
  name: string;
  /** Custom database directory path (defaults to app.getPath('userData')) */
  directory?: string;
  /** Custom storage adapter (defaults to SQLite) */
  storage?: StorageAdapter;
}

/**
 * Subscription registry for reactive queries
 */
interface Subscription {
  collectionName: string;
  unsubscribe: () => void;
}

/**
 * Main process database manager
 */
export class MainProcessDatabase {
  private db: PocketDatabase | null = null;
  private subscriptions = new Map<string, Subscription>();
  private config: MainDatabaseConfig;

  constructor(config: MainDatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize the database in the main process
   */
  async initialize(): Promise<void> {
    if (this.db) {
      return;
    }

    const directory = this.config.directory ?? app.getPath('userData');
    const dbPath = path.join(directory, `${this.config.name}.db`);

    const storage = this.config.storage ?? createSQLiteStorage({ path: dbPath });

    this.db = await PocketDatabase.create({
      name: this.config.name,
      storage,
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    // Unsubscribe all active subscriptions
    for (const [id, sub] of this.subscriptions) {
      sub.unsubscribe();
      this.subscriptions.delete(id);
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  /**
   * Get the database instance
   */
  getDatabase(): PocketDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Register IPC handlers for database operations
   */
  registerIpcHandlers(): void {
    // Initialize
    ipcMain.handle(IPC_CHANNELS.INIT, async () => {
      await this.initialize();
      return { success: true };
    });

    // Close
    ipcMain.handle(IPC_CHANNELS.CLOSE, async () => {
      await this.close();
      return { success: true };
    });

    // Get document
    ipcMain.handle(
      IPC_CHANNELS.GET,
      async (_event: IpcMainInvokeEvent, collectionName: string, id: string) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return collection.get(id);
      }
    );

    // Get many documents
    ipcMain.handle(
      IPC_CHANNELS.GET_MANY,
      async (_event: IpcMainInvokeEvent, collectionName: string, ids: string[]) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return Promise.all(ids.map((id) => collection.get(id)));
      }
    );

    // Get all documents
    ipcMain.handle(
      IPC_CHANNELS.GET_ALL,
      async (_event: IpcMainInvokeEvent, collectionName: string) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return collection.find().exec();
      }
    );

    // Put document
    ipcMain.handle(
      IPC_CHANNELS.PUT,
      async (_event: IpcMainInvokeEvent, collectionName: string, doc: Document) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return collection.upsert(doc._id, doc);
      }
    );

    // Bulk put documents
    ipcMain.handle(
      IPC_CHANNELS.BULK_PUT,
      async (_event: IpcMainInvokeEvent, collectionName: string, docs: Document[]) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return Promise.all(docs.map((doc) => collection.upsert(doc._id, doc)));
      }
    );

    // Delete document
    ipcMain.handle(
      IPC_CHANNELS.DELETE,
      async (_event: IpcMainInvokeEvent, collectionName: string, id: string) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return collection.delete(id);
      }
    );

    // Bulk delete documents
    ipcMain.handle(
      IPC_CHANNELS.BULK_DELETE,
      async (_event: IpcMainInvokeEvent, collectionName: string, ids: string[]) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        return Promise.all(ids.map((id) => collection.delete(id)));
      }
    );

    // Query documents
    ipcMain.handle(
      IPC_CHANNELS.QUERY,
      async (
        _event: IpcMainInvokeEvent,
        collectionName: string,
        query: {
          filter?: Record<string, unknown>;
          sort?: { field: string; direction: 'asc' | 'desc' }[];
          limit?: number;
          offset?: number;
        }
      ) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        let queryBuilder = collection.find();

        if (query.filter) {
          for (const [key, value] of Object.entries(query.filter)) {
            queryBuilder = queryBuilder.where(key).equals(value as Document[keyof Document]);
          }
        }

        if (query.sort) {
          for (const { field, direction } of query.sort) {
            queryBuilder = queryBuilder.sort(field, direction);
          }
        }

        if (query.limit !== undefined) {
          queryBuilder = queryBuilder.limit(query.limit);
        }

        if (query.offset !== undefined) {
          queryBuilder = queryBuilder.skip(query.offset);
        }

        return queryBuilder.exec();
      }
    );

    // Count documents
    ipcMain.handle(
      IPC_CHANNELS.COUNT,
      async (
        _event: IpcMainInvokeEvent,
        collectionName: string,
        filter?: Record<string, unknown>
      ) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);

        if (filter) {
          let queryBuilder = collection.find();
          for (const [key, value] of Object.entries(filter)) {
            queryBuilder = queryBuilder.where(key).equals(value as Document[keyof Document]);
          }
          const results = await queryBuilder.exec();
          return results.length;
        }

        const results = await collection.find().exec();
        return results.length;
      }
    );

    // Clear collection
    ipcMain.handle(
      IPC_CHANNELS.CLEAR,
      async (_event: IpcMainInvokeEvent, collectionName: string) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);
        const docs = await collection.find().exec();
        await Promise.all(docs.map((doc) => collection.delete(doc._id)));
        return { success: true };
      }
    );

    // List collections
    ipcMain.handle(IPC_CHANNELS.LIST_COLLECTIONS, async () => {
      const db = this.getDatabase();
      return db.listCollections();
    });

    // Subscribe to collection changes
    ipcMain.handle(
      IPC_CHANNELS.SUBSCRIBE,
      async (event: IpcMainInvokeEvent, subscriptionId: string, collectionName: string) => {
        const db = this.getDatabase();
        const collection = db.collection(collectionName);

        const subscription = collection
          .find()
          .live()
          .subscribe((docs: Document[]) => {
            // Send updates to the renderer process
            event.sender.send(`pocket:update:${subscriptionId}`, docs);
          });

        this.subscriptions.set(subscriptionId, {
          collectionName,
          unsubscribe: () => subscription.unsubscribe(),
        });

        return { success: true, subscriptionId };
      }
    );

    // Unsubscribe from collection changes
    ipcMain.handle(
      IPC_CHANNELS.UNSUBSCRIBE,
      async (_event: IpcMainInvokeEvent, subscriptionId: string) => {
        const sub = this.subscriptions.get(subscriptionId);
        if (sub) {
          sub.unsubscribe();
          this.subscriptions.delete(subscriptionId);
        }
        return { success: true };
      }
    );
  }

  /**
   * Remove all IPC handlers
   */
  removeIpcHandlers(): void {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  }
}

/**
 * Create and initialize a main process database
 *
 * @example
 * ```typescript
 * // In your main process (main.ts)
 * import { createMainDatabase } from '@pocket/electron/main';
 *
 * const db = await createMainDatabase({ name: 'my-app' });
 * db.registerIpcHandlers();
 *
 * app.on('before-quit', async () => {
 *   await db.close();
 * });
 * ```
 */
export async function createMainDatabase(config: MainDatabaseConfig): Promise<MainProcessDatabase> {
  const db = new MainProcessDatabase(config);
  await db.initialize();
  return db;
}

export { IPC_CHANNELS as PocketIpcChannels };

/**
 * Electron Preload Script
 *
 * IPC bridge between main and renderer processes.
 * This file should be loaded as the preload script in your BrowserWindow.
 *
 * @module @pocket/electron/preload
 */

import type { Document } from '@pocket/core';
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * IPC channel names (must match main process)
 */
const IPC_CHANNELS = {
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
 * Query options for the renderer process
 */
export interface RendererQueryOptions {
  filter?: Record<string, unknown>;
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

/**
 * Pocket API exposed to the renderer process
 */
export interface PocketAPI {
  /** Initialize the database connection */
  init(): Promise<{ success: boolean }>;

  /** Close the database connection */
  close(): Promise<{ success: boolean }>;

  /** Get a document by ID */
  get<T extends Document>(collectionName: string, id: string): Promise<T | null>;

  /** Get multiple documents by IDs */
  getMany<T extends Document>(collectionName: string, ids: string[]): Promise<(T | null)[]>;

  /** Get all documents in a collection */
  getAll<T extends Document>(collectionName: string): Promise<T[]>;

  /** Insert or update a document */
  put<T extends Document>(collectionName: string, doc: T): Promise<T>;

  /** Insert or update multiple documents */
  bulkPut<T extends Document>(collectionName: string, docs: T[]): Promise<T[]>;

  /** Delete a document by ID */
  delete(collectionName: string, id: string): Promise<void>;

  /** Delete multiple documents by IDs */
  bulkDelete(collectionName: string, ids: string[]): Promise<void>;

  /** Query documents with filters, sorting, and pagination */
  query<T extends Document>(collectionName: string, options?: RendererQueryOptions): Promise<T[]>;

  /** Count documents matching a filter */
  count(collectionName: string, filter?: Record<string, unknown>): Promise<number>;

  /** Clear all documents in a collection */
  clear(collectionName: string): Promise<{ success: boolean }>;

  /** List all collection names */
  listCollections(): Promise<string[]>;

  /** Subscribe to collection changes */
  subscribe(
    collectionName: string,
    callback: (docs: Document[]) => void
  ): Promise<{ subscriptionId: string; unsubscribe: () => void }>;
}

/**
 * Create the Pocket API for the renderer process
 */
function createPocketAPI(): PocketAPI {
  const activeSubscriptions = new Map<
    string,
    { listener: (event: IpcRendererEvent, docs: unknown[]) => void }
  >();

  return {
    async init() {
      return ipcRenderer.invoke(IPC_CHANNELS.INIT);
    },

    async close() {
      // Clean up all subscriptions
      for (const [subscriptionId] of activeSubscriptions) {
        await ipcRenderer.invoke(IPC_CHANNELS.UNSUBSCRIBE, subscriptionId);
      }
      activeSubscriptions.clear();

      return ipcRenderer.invoke(IPC_CHANNELS.CLOSE);
    },

    async get<T extends Document>(collectionName: string, id: string): Promise<T | null> {
      return ipcRenderer.invoke(IPC_CHANNELS.GET, collectionName, id);
    },

    async getMany<T extends Document>(
      collectionName: string,
      ids: string[]
    ): Promise<(T | null)[]> {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_MANY, collectionName, ids);
    },

    async getAll<T extends Document>(collectionName: string): Promise<T[]> {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ALL, collectionName);
    },

    async put<T extends Document>(collectionName: string, doc: T): Promise<T> {
      return ipcRenderer.invoke(IPC_CHANNELS.PUT, collectionName, doc);
    },

    async bulkPut<T extends Document>(collectionName: string, docs: T[]): Promise<T[]> {
      return ipcRenderer.invoke(IPC_CHANNELS.BULK_PUT, collectionName, docs);
    },

    async delete(collectionName: string, id: string): Promise<void> {
      return ipcRenderer.invoke(IPC_CHANNELS.DELETE, collectionName, id);
    },

    async bulkDelete(collectionName: string, ids: string[]): Promise<void> {
      return ipcRenderer.invoke(IPC_CHANNELS.BULK_DELETE, collectionName, ids);
    },

    async query<T extends Document>(
      collectionName: string,
      options?: RendererQueryOptions
    ): Promise<T[]> {
      return ipcRenderer.invoke(IPC_CHANNELS.QUERY, collectionName, options ?? {});
    },

    async count(collectionName: string, filter?: Record<string, unknown>): Promise<number> {
      return ipcRenderer.invoke(IPC_CHANNELS.COUNT, collectionName, filter);
    },

    async clear(collectionName: string): Promise<{ success: boolean }> {
      return ipcRenderer.invoke(IPC_CHANNELS.CLEAR, collectionName);
    },

    async listCollections(): Promise<string[]> {
      return ipcRenderer.invoke(IPC_CHANNELS.LIST_COLLECTIONS);
    },

    async subscribe(
      collectionName: string,
      callback: (docs: Document[]) => void
    ): Promise<{ subscriptionId: string; unsubscribe: () => void }> {
      const subscriptionId = `${collectionName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Set up listener for updates
      const listener = (_event: IpcRendererEvent, docs: unknown[]) => {
        callback(docs as Document[]);
      };

      ipcRenderer.on(`pocket:update:${subscriptionId}`, listener);
      activeSubscriptions.set(subscriptionId, { listener });

      // Register subscription with main process
      await ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBE, subscriptionId, collectionName);

      return {
        subscriptionId,
        unsubscribe: () => {
          ipcRenderer.removeListener(`pocket:update:${subscriptionId}`, listener);
          activeSubscriptions.delete(subscriptionId);
          void ipcRenderer.invoke(IPC_CHANNELS.UNSUBSCRIBE, subscriptionId);
        },
      };
    },
  };
}

/**
 * Expose Pocket API to the renderer process
 *
 * Call this in your preload script to make Pocket available in the renderer.
 *
 * @example
 * ```typescript
 * // In your preload.ts
 * import { exposePocketAPI } from '@pocket/electron/preload';
 *
 * exposePocketAPI();
 *
 * // Now window.pocket is available in the renderer
 * ```
 */
export function exposePocketAPI(): void {
  const api = createPocketAPI();
  contextBridge.exposeInMainWorld('pocket', api);
}

/**
 * Type augmentation for the window object
 */
declare global {
  interface Window {
    pocket: PocketAPI;
  }
}

export type { RendererQueryOptions as QueryOptions };

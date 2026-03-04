/**
 * RxDB Compatibility Layer - Wraps a Pocket database with an RxDB-like API.
 *
 * Provides familiar RxDB method signatures (`createRxDatabase`, `collection.find`,
 * `collection.insert`, `collection.bulkInsert`) backed by Pocket operations.
 * Emits deprecation warnings for RxDB-only features.
 *
 * @module compat/rxdb-compat
 */

import type { CompatLayerConfig, RxDBCompatAPI } from './types.js';

/**
 * A compatibility collection that mimics RxDB's collection API.
 */
interface RxDBCompatCollection {
  find(query?: Record<string, unknown>): { exec(): Promise<Record<string, unknown>[]> };
  findOne(query?: Record<string, unknown>): { exec(): Promise<Record<string, unknown> | null> };
  insert(doc: Record<string, unknown>): Promise<Record<string, unknown>>;
  bulkInsert(docs: Record<string, unknown>[]): Promise<{ success: Record<string, unknown>[]; error: unknown[] }>;
  upsert(doc: Record<string, unknown>): Promise<Record<string, unknown>>;
  remove(id: string): Promise<void>;
}

/**
 * RxDB compatibility wrapper around a Pocket database.
 *
 * Exposes RxDB-like APIs that delegate to the underlying Pocket database.
 * Use this as a drop-in shim during migration to minimize code changes.
 *
 * @example
 * ```typescript
 * const compat = createRxDBCompat(pocketDb);
 * const db = await compat.createRxDatabase({ name: 'mydb' });
 * ```
 */
export class RxDBCompatLayer implements RxDBCompatAPI {
  private readonly db: unknown;
  private readonly config: CompatLayerConfig;
  private readonly collections = new Map<string, RxDBCompatCollection>();

  constructor(pocketDb: unknown, config: CompatLayerConfig = {}) {
    this.db = pocketDb;
    this.config = config;
  }

  /**
   * Mimics `createRxDatabase()`. Returns this compat layer as the "database".
   */
  async createRxDatabase(_config: Record<string, unknown>): Promise<RxDBCompatLayer> {
    this.logDeprecation('createRxDatabase', 'Use Pocket createDatabase() directly');
    return this;
  }

  /**
   * Mimics `addCollections()`. Registers collection shims.
   */
  async addCollections(collections: Record<string, unknown>): Promise<void> {
    this.logDeprecation('addCollections', 'Use Pocket collection APIs directly');

    for (const [name, _schema] of Object.entries(collections)) {
      this.collections.set(name, this.createCollectionShim(name));
    }
  }

  /**
   * Gets a collection by name. Returns an RxDB-like collection API.
   */
  collection(name: string): RxDBCompatCollection {
    const existing = this.collections.get(name);
    if (existing) return existing;

    const shim = this.createCollectionShim(name);
    this.collections.set(name, shim);
    return shim;
  }

  /** Creates a collection shim that delegates to Pocket operations. */
  private createCollectionShim(name: string): RxDBCompatCollection {
    const self = this;
    const pocketDb = this.db as Record<string, unknown>;

    return {
      find(query?: Record<string, unknown>) {
        self.logDeprecation('collection.find()', 'Use Pocket query API');
        return {
          async exec(): Promise<Record<string, unknown>[]> {
            // Delegate to Pocket's query mechanism
            if (pocketDb && typeof pocketDb === 'object' && 'query' in pocketDb) {
              const queryFn = pocketDb.query as (
                collection: string,
                q: Record<string, unknown>,
              ) => Promise<Record<string, unknown>[]>;
              return queryFn(name, query ?? {});
            }
            return [];
          },
        };
      },

      findOne(query?: Record<string, unknown>) {
        self.logDeprecation('collection.findOne()', 'Use Pocket query API');
        return {
          async exec(): Promise<Record<string, unknown> | null> {
            if (pocketDb && typeof pocketDb === 'object' && 'query' in pocketDb) {
              const queryFn = pocketDb.query as (
                collection: string,
                q: Record<string, unknown>,
              ) => Promise<Record<string, unknown>[]>;
              const results = await queryFn(name, { ...query, limit: 1 });
              return results[0] ?? null;
            }
            return null;
          },
        };
      },

      async insert(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
        self.logDeprecation('collection.insert()', 'Use Pocket insert API');
        if (pocketDb && typeof pocketDb === 'object' && 'insert' in pocketDb) {
          const insertFn = pocketDb.insert as (
            collection: string,
            doc: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
          return insertFn(name, doc);
        }
        return doc;
      },

      async bulkInsert(
        docs: Record<string, unknown>[],
      ): Promise<{ success: Record<string, unknown>[]; error: unknown[] }> {
        self.logDeprecation('collection.bulkInsert()', 'Use Pocket bulk insert API');
        const success: Record<string, unknown>[] = [];
        const error: unknown[] = [];

        if (pocketDb && typeof pocketDb === 'object' && 'bulkInsert' in pocketDb) {
          const bulkFn = pocketDb.bulkInsert as (
            collection: string,
            docs: Record<string, unknown>[],
          ) => Promise<Record<string, unknown>[]>;
          try {
            const results = await bulkFn(name, docs);
            success.push(...results);
          } catch (err) {
            error.push(err);
          }
        } else {
          // Fallback: insert one by one
          for (const doc of docs) {
            try {
              const result = await this.insert(doc);
              success.push(result);
            } catch (err) {
              error.push(err);
            }
          }
        }

        return { success, error };
      },

      async upsert(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
        self.logDeprecation('collection.upsert()', 'Use Pocket upsert API');
        if (pocketDb && typeof pocketDb === 'object' && 'upsert' in pocketDb) {
          const upsertFn = pocketDb.upsert as (
            collection: string,
            doc: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
          return upsertFn(name, doc);
        }
        return doc;
      },

      async remove(id: string): Promise<void> {
        self.logDeprecation('collection.remove()', 'Use Pocket delete API');
        if (pocketDb && typeof pocketDb === 'object' && 'delete' in pocketDb) {
          const deleteFn = pocketDb.delete as (collection: string, id: string) => Promise<void>;
          await deleteFn(name, id);
        }
      },
    };
  }

  /** Logs a deprecation warning if configured to do so. */
  private logDeprecation(method: string, suggestion: string): void {
    if (this.config.logDeprecations) {
      console.warn(`[pocket/compat] DEPRECATED: ${method} — ${suggestion}`);
    }
  }
}

/**
 * Creates an RxDB compatibility layer wrapping a Pocket database.
 *
 * @param pocketDb - The Pocket database instance to wrap
 * @param config - Optional compatibility layer configuration
 * @returns An RxDBCompatLayer with RxDB-like API methods
 *
 * @example
 * ```typescript
 * const compat = createRxDBCompat(myPocketDb, { logDeprecations: true });
 * await compat.addCollections({ todos: { schema: todoSchema } });
 * const docs = await compat.collection('todos').find().exec();
 * ```
 */
export function createRxDBCompat(
  pocketDb: unknown,
  config?: CompatLayerConfig,
): RxDBCompatLayer {
  return new RxDBCompatLayer(pocketDb, config);
}

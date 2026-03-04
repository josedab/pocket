/**
 * Dexie Compatibility Layer - Wraps a Pocket database with a Dexie-like API.
 *
 * Provides familiar Dexie method signatures (`db.version().stores()`,
 * `db.table().get/put/delete/where`) backed by Pocket operations.
 * Supports basic transaction semantics delegated to Pocket.
 *
 * @module compat/dexie-compat
 */

import type { CompatLayerConfig, DexieCompatAPI } from './types.js';

/**
 * A compatibility table that mimics Dexie's Table API.
 */
interface DexieCompatTable {
  get(key: string | number): Promise<Record<string, unknown> | undefined>;
  put(item: Record<string, unknown>): Promise<string>;
  add(item: Record<string, unknown>): Promise<string>;
  delete(key: string | number): Promise<void>;
  bulkPut(items: Record<string, unknown>[]): Promise<void>;
  bulkAdd(items: Record<string, unknown>[]): Promise<void>;
  bulkDelete(keys: (string | number)[]): Promise<void>;
  toArray(): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
  where(field: string): DexieCompatWhereClause;
}

/**
 * A compatibility where clause that mimics Dexie's WhereClause API.
 */
interface DexieCompatWhereClause {
  equals(value: unknown): DexieCompatCollection;
  above(value: number): DexieCompatCollection;
  below(value: number): DexieCompatCollection;
  between(lower: number, upper: number): DexieCompatCollection;
  anyOf(values: unknown[]): DexieCompatCollection;
}

/**
 * A compatibility collection result set that mimics Dexie's Collection API.
 */
interface DexieCompatCollection {
  toArray(): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
  first(): Promise<Record<string, unknown> | undefined>;
  limit(n: number): DexieCompatCollection;
  sortBy(field: string): Promise<Record<string, unknown>[]>;
}

/**
 * Dexie compatibility wrapper around a Pocket database.
 *
 * Exposes Dexie-like APIs that delegate to the underlying Pocket database.
 * Use this as a drop-in shim during migration to minimize code changes.
 *
 * @example
 * ```typescript
 * const db = createDexieCompat(pocketDb);
 * db.version(1).stores({ friends: '++id, name, age' });
 * await db.open();
 * const friends = await db.table('friends').toArray();
 * ```
 */
export class DexieCompatLayer implements DexieCompatAPI {
  private readonly db: unknown;
  private readonly config: CompatLayerConfig;
  private readonly schemas = new Map<string, string>();
  private readonly tables = new Map<string, DexieCompatTable>();
  private opened = false;

  constructor(pocketDb: unknown, config: CompatLayerConfig = {}) {
    this.db = pocketDb;
    this.config = config;
  }

  /**
   * Mimics `db.version(n).stores(schema)`. Registers table schemas.
   */
  version(_num: number): { stores: (schema: Record<string, string>) => DexieCompatLayer } {
    this.logDeprecation('version().stores()', 'Use Pocket schema definition');
    return {
      stores: (schema: Record<string, string>): DexieCompatLayer => {
        for (const [tableName, indexDef] of Object.entries(schema)) {
          this.schemas.set(tableName, indexDef);
        }
        return this;
      },
    };
  }

  /**
   * Returns whether the database has been opened.
   */
  get isOpen(): boolean {
    return this.opened;
  }

  /**
   * Gets a table by name. Returns a Dexie-like Table API.
   */
  table(name: string): DexieCompatTable {
    const existing = this.tables.get(name);
    if (existing) return existing;

    const shim = this.createTableShim(name);
    this.tables.set(name, shim);
    return shim;
  }

  /**
   * Mimics `db.open()`. Marks the compat layer as ready.
   */
  async open(): Promise<void> {
    this.logDeprecation('open()', 'Pocket databases are opened on creation');
    this.opened = true;
  }

  /**
   * Mimics `db.close()`. No-op for Pocket.
   */
  close(): void {
    this.logDeprecation('close()', 'Use Pocket database lifecycle methods');
    this.opened = false;
  }

  /**
   * Mimics Dexie's `db.transaction()`. Wraps operations in a Pocket transaction.
   */
  async transaction(
    mode: string,
    tableNames: string | string[],
    fn: () => Promise<void>,
  ): Promise<void> {
    this.logDeprecation('transaction()', 'Use Pocket transaction API');
    const pocketDb = this.db as Record<string, unknown>;

    if (pocketDb && typeof pocketDb === 'object' && 'transaction' in pocketDb) {
      const txFn = pocketDb.transaction as (
        tables: string[],
        mode: string,
        fn: () => Promise<void>,
      ) => Promise<void>;
      const tables = Array.isArray(tableNames) ? tableNames : [tableNames];
      await txFn(tables, mode, fn);
    } else {
      await fn();
    }
  }

  /** Creates a table shim that delegates to Pocket operations. */
  private createTableShim(name: string): DexieCompatTable {
    const self = this;
    const pocketDb = this.db as Record<string, unknown>;

    return {
      async get(key: string | number): Promise<Record<string, unknown> | undefined> {
        self.logDeprecation('table.get()', 'Use Pocket get API');
        if (pocketDb && typeof pocketDb === 'object' && 'get' in pocketDb) {
          const getFn = pocketDb.get as (
            collection: string,
            key: string,
          ) => Promise<Record<string, unknown> | undefined>;
          return getFn(name, String(key));
        }
        return undefined;
      },

      async put(item: Record<string, unknown>): Promise<string> {
        self.logDeprecation('table.put()', 'Use Pocket upsert API');
        if (pocketDb && typeof pocketDb === 'object' && 'upsert' in pocketDb) {
          const upsertFn = pocketDb.upsert as (
            collection: string,
            doc: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
          const result = await upsertFn(name, item);
          return String(result._id ?? '');
        }
        return String(item.id ?? '');
      },

      async add(item: Record<string, unknown>): Promise<string> {
        self.logDeprecation('table.add()', 'Use Pocket insert API');
        if (pocketDb && typeof pocketDb === 'object' && 'insert' in pocketDb) {
          const insertFn = pocketDb.insert as (
            collection: string,
            doc: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
          const result = await insertFn(name, item);
          return String(result._id ?? '');
        }
        return String(item.id ?? '');
      },

      async delete(key: string | number): Promise<void> {
        self.logDeprecation('table.delete()', 'Use Pocket delete API');
        if (pocketDb && typeof pocketDb === 'object' && 'delete' in pocketDb) {
          const deleteFn = pocketDb.delete as (collection: string, id: string) => Promise<void>;
          await deleteFn(name, String(key));
        }
      },

      async bulkPut(items: Record<string, unknown>[]): Promise<void> {
        self.logDeprecation('table.bulkPut()', 'Use Pocket bulk upsert API');
        for (const item of items) {
          await this.put(item);
        }
      },

      async bulkAdd(items: Record<string, unknown>[]): Promise<void> {
        self.logDeprecation('table.bulkAdd()', 'Use Pocket bulk insert API');
        for (const item of items) {
          await this.add(item);
        }
      },

      async bulkDelete(keys: (string | number)[]): Promise<void> {
        self.logDeprecation('table.bulkDelete()', 'Use Pocket bulk delete API');
        for (const key of keys) {
          await this.delete(key);
        }
      },

      async toArray(): Promise<Record<string, unknown>[]> {
        self.logDeprecation('table.toArray()', 'Use Pocket query API');
        if (pocketDb && typeof pocketDb === 'object' && 'query' in pocketDb) {
          const queryFn = pocketDb.query as (
            collection: string,
            q: Record<string, unknown>,
          ) => Promise<Record<string, unknown>[]>;
          return queryFn(name, {});
        }
        return [];
      },

      async count(): Promise<number> {
        self.logDeprecation('table.count()', 'Use Pocket count API');
        const items = await this.toArray();
        return items.length;
      },

      where(field: string): DexieCompatWhereClause {
        self.logDeprecation('table.where()', 'Use Pocket query API');
        return self.createWhereClause(name, field);
      },
    };
  }

  /** Creates a where clause shim for Dexie-like queries. */
  private createWhereClause(tableName: string, field: string): DexieCompatWhereClause {
    const self = this;

    const createCollection = (filterFn: (item: Record<string, unknown>) => boolean): DexieCompatCollection => {
      let limitCount: number | undefined;

      const collection: DexieCompatCollection = {
        async toArray(): Promise<Record<string, unknown>[]> {
          const table = self.table(tableName);
          const all = await table.toArray();
          const filtered = all.filter(filterFn);
          return limitCount !== undefined ? filtered.slice(0, limitCount) : filtered;
        },
        async count(): Promise<number> {
          const items = await this.toArray();
          return items.length;
        },
        async first(): Promise<Record<string, unknown> | undefined> {
          const items = await this.toArray();
          return items[0];
        },
        limit(n: number): DexieCompatCollection {
          limitCount = n;
          return collection;
        },
        async sortBy(sortField: string): Promise<Record<string, unknown>[]> {
          const items = await this.toArray();
          return items.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            if (aVal === bVal) return 0;
            return (aVal as number) < (bVal as number) ? -1 : 1;
          });
        },
      };

      return collection;
    };

    return {
      equals(value: unknown): DexieCompatCollection {
        return createCollection((item) => item[field] === value);
      },
      above(value: number): DexieCompatCollection {
        return createCollection((item) => (item[field] as number) > value);
      },
      below(value: number): DexieCompatCollection {
        return createCollection((item) => (item[field] as number) < value);
      },
      between(lower: number, upper: number): DexieCompatCollection {
        return createCollection(
          (item) => (item[field] as number) >= lower && (item[field] as number) <= upper,
        );
      },
      anyOf(values: unknown[]): DexieCompatCollection {
        return createCollection((item) => values.includes(item[field]));
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
 * Creates a Dexie compatibility layer wrapping a Pocket database.
 *
 * @param pocketDb - The Pocket database instance to wrap
 * @param config - Optional compatibility layer configuration
 * @returns A DexieCompatLayer with Dexie-like API methods
 *
 * @example
 * ```typescript
 * const db = createDexieCompat(myPocketDb, { logDeprecations: true });
 * db.version(1).stores({ friends: '++id, name, age' });
 * await db.open();
 * const allFriends = await db.table('friends').toArray();
 * ```
 */
export function createDexieCompat(
  pocketDb: unknown,
  config?: CompatLayerConfig,
): DexieCompatLayer {
  return new DexieCompatLayer(pocketDb, config);
}

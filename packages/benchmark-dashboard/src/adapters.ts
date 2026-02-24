/**
 * Competitor Engine Adapters — wraps third-party database libraries
 * to conform to the BenchmarkEngine interface for fair comparison.
 *
 * These are stub adapters that define the integration shape. In the
 * browser, each competitor's CDN build is loaded and wired in.
 */

import type { BenchmarkEngine } from './types.js';

/**
 * Create a Dexie.js benchmark adapter.
 *
 * Usage in browser:
 * ```ts
 * import Dexie from 'https://cdn.jsdelivr.net/npm/dexie/dist/dexie.min.mjs';
 * const engine = createDexieAdapter(Dexie);
 * ```
 */
export function createDexieAdapter(
  DexieConstructor: new (name: string) => {
    version(v: number): { stores(s: Record<string, string>): void };
    table(name: string): {
      add(doc: Record<string, unknown>): Promise<unknown>;
      bulkAdd(docs: readonly Record<string, unknown>[]): Promise<unknown>;
      toArray(): Promise<unknown[]>;
      where(filter: Record<string, unknown>): {
        equals(v: unknown): { toArray(): Promise<unknown[]> };
      };
      update(id: string, changes: Record<string, unknown>): Promise<number>;
      delete(id: string): Promise<void>;
    };
    delete(): Promise<void>;
    open(): Promise<void>;
  }
): BenchmarkEngine {
  let db: ReturnType<typeof createInstance>;

  function createInstance() {
    const instance = new DexieConstructor('pocket-bench-dexie');
    instance.version(1).stores({ docs: '_id,active,value' });
    return instance;
  }

  return {
    name: 'Dexie.js',
    version: '4.x',
    async setup() {
      db = createInstance();
      await db.open();
    },
    async teardown() {
      await db.delete();
    },
    async insertOne(doc) {
      await db.table('docs').add(doc);
    },
    async insertBatch(docs) {
      await db.table('docs').bulkAdd(docs);
    },
    async findAll() {
      return db.table('docs').toArray();
    },
    async findWithFilter(filter) {
      const [, val] = Object.entries(filter)[0]!;
      return db.table('docs').where(filter).equals(val).toArray();
    },
    async updateOne(id, changes) {
      await db.table('docs').update(id, changes);
    },
    async deleteOne(id) {
      await db.table('docs').delete(id);
    },
  };
}

/**
 * Create a PouchDB benchmark adapter.
 *
 * Usage in browser:
 * ```ts
 * import PouchDB from 'https://cdn.jsdelivr.net/npm/pouchdb/dist/pouchdb.min.js';
 * const engine = createPouchDBAdapter(PouchDB);
 * ```
 */
export function createPouchDBAdapter(
  PouchDBConstructor: new (name: string) => {
    put(doc: Record<string, unknown>): Promise<{ rev: string }>;
    bulkDocs(docs: readonly Record<string, unknown>[]): Promise<unknown>;
    allDocs(opts: { include_docs: boolean }): Promise<{ rows: { doc: Record<string, unknown> }[] }>;
    get(id: string): Promise<Record<string, unknown>>;
    remove(doc: Record<string, unknown>): Promise<unknown>;
    destroy(): Promise<void>;
  }
): BenchmarkEngine {
  let db: InstanceType<typeof PouchDBConstructor>;

  return {
    name: 'PouchDB',
    version: '8.x',
    async setup() {
      db = new PouchDBConstructor('pocket-bench-pouchdb');
    },
    async teardown() {
      await db.destroy();
    },
    async insertOne(doc) {
      await db.put({ ...doc, _id: (doc._id as string) ?? crypto.randomUUID() });
    },
    async insertBatch(docs) {
      await db.bulkDocs(docs.map((d) => ({ ...d, _id: (d._id as string) ?? crypto.randomUUID() })));
    },
    async findAll() {
      const result = await db.allDocs({ include_docs: true });
      return result.rows.map((r) => r.doc);
    },
    async findWithFilter(filter) {
      const all = await this.findAll();
      return all.filter((doc) => {
        const d = doc as Record<string, unknown>;
        return Object.entries(filter).every(([k, v]) => d[k] === v);
      });
    },
    async updateOne(id, changes) {
      const doc = await db.get(id);
      await db.put({ ...doc, ...changes });
    },
    async deleteOne(id) {
      try {
        const doc = await db.get(id);
        await db.remove(doc);
      } catch {
        // doc not found
      }
    },
  };
}

/**
 * Create a generic adapter from any key-value store for comparison.
 * Useful for wrapping localStorage, Map, or custom implementations.
 */
export function createGenericAdapter(
  name: string,
  version: string,
  store: {
    set(key: string, value: Record<string, unknown>): void | Promise<void>;
    get(
      key: string
    ): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
    delete(key: string): void | Promise<void>;
    entries():
      | Iterable<[string, Record<string, unknown>]>
      | AsyncIterable<[string, Record<string, unknown>]>;
    clear(): void | Promise<void>;
  }
): BenchmarkEngine {
  return {
    name,
    version,
    async setup() {
      await store.clear();
    },
    async teardown() {
      await store.clear();
    },
    async insertOne(doc) {
      const id = (doc._id as string) ?? `auto-${Date.now()}-${Math.random()}`;
      await store.set(id, { ...doc, _id: id });
    },
    async insertBatch(docs) {
      for (const doc of docs) {
        const id = (doc._id as string) ?? `auto-${Date.now()}-${Math.random()}`;
        await store.set(id, { ...doc, _id: id });
      }
    },
    async findAll() {
      const results: Record<string, unknown>[] = [];
      for await (const [, v] of store.entries()) results.push(v);
      return results;
    },
    async findWithFilter(filter) {
      const all = await this.findAll();
      return all.filter((d) =>
        Object.entries(filter).every(([k, v]) => (d as Record<string, unknown>)[k] === v)
      );
    },
    async updateOne(id, changes) {
      const doc = await store.get(id);
      if (doc) await store.set(id, { ...doc, ...changes });
    },
    async deleteOne(id) {
      await store.delete(id);
    },
  };
}

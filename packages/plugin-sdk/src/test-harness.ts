/**
 * Plugin Test Harness — enables isolated testing of Pocket plugins
 * without a real database instance.
 */

import type { PluginTestResult } from './types.js';

export interface MockDatabaseConfig {
  collections?: Record<string, Record<string, unknown>[]>;
}

export interface MockCollection {
  name: string;
  documents: Map<string, Record<string, unknown>>;
  insertedDocs: Record<string, unknown>[];
  updatedDocs: { id: string; changes: Record<string, unknown> }[];
  deletedIds: string[];
}

/**
 * Mock database for plugin testing.
 */
export class MockDatabase {
  readonly collections = new Map<string, MockCollection>();

  constructor(config: MockDatabaseConfig = {}) {
    if (config.collections) {
      for (const [name, docs] of Object.entries(config.collections)) {
        const col = this.getOrCreateCollection(name);
        for (const doc of docs) {
          const id = (doc._id as string) ?? crypto.randomUUID();
          col.documents.set(id, { ...doc, _id: id });
        }
      }
    }
  }

  collection(name: string): {
    get: (id: string) => Promise<Record<string, unknown> | null>;
    find: () => Promise<Record<string, unknown>[]>;
    insert: (doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
    update: (id: string, changes: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (id: string) => Promise<void>;
  } {
    const col = this.getOrCreateCollection(name);
    return {
      async get(id: string) {
        return col.documents.get(id) ?? null;
      },
      async find() {
        return Array.from(col.documents.values());
      },
      async insert(doc: Record<string, unknown>) {
        const id = (doc._id as string) ?? crypto.randomUUID();
        const full = { ...doc, _id: id };
        col.documents.set(id, full);
        col.insertedDocs.push(full);
        return full;
      },
      async update(id: string, changes: Record<string, unknown>) {
        const existing = col.documents.get(id);
        if (!existing) throw new Error(`Document ${id} not found`);
        const updated = { ...existing, ...changes };
        col.documents.set(id, updated);
        col.updatedDocs.push({ id, changes });
        return updated;
      },
      async delete(id: string) {
        col.documents.delete(id);
        col.deletedIds.push(id);
      },
    };
  }

  private getOrCreateCollection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, {
        name,
        documents: new Map(),
        insertedDocs: [],
        updatedDocs: [],
        deletedIds: [],
      });
    }
    return this.collections.get(name)!;
  }
}

export type PluginInstallFn = (context: {
  hooks: PluginHookRegistry;
}) => void;

export interface PluginHookRegistry {
  beforeInsert: (fn: (doc: Record<string, unknown>, collection: string) => Promise<Record<string, unknown>>) => void;
  afterInsert: (fn: (doc: Record<string, unknown>, collection: string) => Promise<void>) => void;
  beforeUpdate: (fn: (id: string, changes: Record<string, unknown>, collection: string) => Promise<Record<string, unknown>>) => void;
  afterUpdate: (fn: (doc: Record<string, unknown>, collection: string) => Promise<void>) => void;
  beforeDelete: (fn: (id: string, collection: string) => Promise<void>) => void;
  afterDelete: (fn: (id: string, collection: string) => Promise<void>) => void;
}

/**
 * Plugin Test Harness — runs isolated tests against a plugin.
 */
export class PluginTestHarness {
  private readonly hooks: Record<string, ((...args: unknown[]) => Promise<unknown>)[]> = {};
  private readonly hookRegistry: PluginHookRegistry;
  readonly db: MockDatabase;

  constructor(config?: MockDatabaseConfig) {
    this.db = new MockDatabase(config);

    this.hookRegistry = {
      beforeInsert: (fn) => this.registerHook('beforeInsert', fn as (...args: unknown[]) => Promise<unknown>),
      afterInsert: (fn) => this.registerHook('afterInsert', fn as (...args: unknown[]) => Promise<unknown>),
      beforeUpdate: (fn) => this.registerHook('beforeUpdate', fn as (...args: unknown[]) => Promise<unknown>),
      afterUpdate: (fn) => this.registerHook('afterUpdate', fn as (...args: unknown[]) => Promise<unknown>),
      beforeDelete: (fn) => this.registerHook('beforeDelete', fn as (...args: unknown[]) => Promise<unknown>),
      afterDelete: (fn) => this.registerHook('afterDelete', fn as (...args: unknown[]) => Promise<unknown>),
    };
  }

  /**
   * Install a plugin into the test harness.
   */
  install(pluginInstall: PluginInstallFn): void {
    pluginInstall({ hooks: this.hookRegistry });
  }

  /**
   * Run a named test case.
   */
  async runTest(
    name: string,
    testFn: (harness: PluginTestHarness) => Promise<void>,
  ): Promise<PluginTestResult> {
    const start = performance.now();
    try {
      await testFn(this);
      return {
        name,
        passed: true,
        duration: performance.now() - start,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate an insert and run all hooks.
   */
  async simulateInsert(
    collection: string,
    doc: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let processed = { ...doc };

    for (const fn of this.hooks.beforeInsert ?? []) {
      const result = await fn(processed, collection);
      if (result && typeof result === 'object') {
        processed = result as Record<string, unknown>;
      }
    }

    const inserted = await this.db.collection(collection).insert(processed);

    for (const fn of this.hooks.afterInsert ?? []) {
      await fn(inserted, collection);
    }

    return inserted;
  }

  /**
   * Simulate an update and run all hooks.
   */
  async simulateUpdate(
    collection: string,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let processed = { ...changes };

    for (const fn of this.hooks.beforeUpdate ?? []) {
      const result = await fn(id, processed, collection);
      if (result && typeof result === 'object') {
        processed = result as Record<string, unknown>;
      }
    }

    const updated = await this.db.collection(collection).update(id, processed);

    for (const fn of this.hooks.afterUpdate ?? []) {
      await fn(updated, collection);
    }

    return updated;
  }

  /**
   * Get registered hook count.
   */
  getHookCount(): number {
    return Object.values(this.hooks).reduce((sum, fns) => sum + fns.length, 0);
  }

  private registerHook(name: string, fn: (...args: unknown[]) => Promise<unknown>): void {
    this.hooks[name] ??= [];
    this.hooks[name].push(fn);
  }
}

/**
 * Create a PluginTestHarness.
 */
export function createPluginTestHarness(config?: MockDatabaseConfig): PluginTestHarness {
  return new PluginTestHarness(config);
}

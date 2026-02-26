/**
 * Offline-First Testing Toolkit — utilities for testing offline
 * scenarios, sync conflicts, and CRDT convergence.
 */

/** Options for creating a test database. */
export interface TestDatabaseOptions {
  readonly name?: string;
  readonly collections?: readonly string[];
  readonly seedData?: Record<string, readonly Record<string, unknown>[]>;
}

/** A minimal in-memory database for testing. */
export interface TestDatabase {
  readonly name: string;
  insert(collection: string, doc: Record<string, unknown>): void;
  find(collection: string, filter?: Record<string, unknown>): Record<string, unknown>[];
  get(collection: string, id: string): Record<string, unknown> | undefined;
  update(collection: string, id: string, changes: Record<string, unknown>): boolean;
  delete(collection: string, id: string): boolean;
  getAll(collection: string): Record<string, unknown>[];
  clear(collection?: string): void;
}

/** Create a test database with optional seed data. */
export function createTestDatabase(options?: TestDatabaseOptions): TestDatabase {
  const name = options?.name ?? `test-db-${Date.now()}`;
  const store = new Map<string, Map<string, Record<string, unknown>>>();

  for (const col of options?.collections ?? []) {
    store.set(col, new Map());
  }

  if (options?.seedData) {
    for (const [col, docs] of Object.entries(options.seedData)) {
      const colStore = store.get(col) ?? new Map();
      for (const doc of docs) {
        const id = (doc._id as string) ?? `auto-${Math.random().toString(36).slice(2)}`;
        colStore.set(id, { ...doc, _id: id });
      }
      store.set(col, colStore);
    }
  }

  function getOrCreateCollection(collection: string): Map<string, Record<string, unknown>> {
    let col = store.get(collection);
    if (!col) {
      col = new Map();
      store.set(collection, col);
    }
    return col;
  }

  return {
    name,
    insert(collection, doc) {
      const col = getOrCreateCollection(collection);
      const id = (doc._id as string) ?? `auto-${Math.random().toString(36).slice(2)}`;
      col.set(id, { ...doc, _id: id });
    },
    find(collection, filter) {
      const col = store.get(collection);
      if (!col) return [];
      const docs = Array.from(col.values());
      if (!filter) return docs;
      return docs.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
    },
    get(collection, id) {
      return store.get(collection)?.get(id);
    },
    update(collection, id, changes) {
      const col = store.get(collection);
      const doc = col?.get(id);
      if (!doc) return false;
      col!.set(id, { ...doc, ...changes });
      return true;
    },
    delete(collection, id) {
      return store.get(collection)?.delete(id) ?? false;
    },
    getAll(collection) {
      return Array.from(store.get(collection)?.values() ?? []);
    },
    clear(collection) {
      if (collection) {
        store.get(collection)?.clear();
      } else {
        store.clear();
      }
    },
  };
}

// ─── Network Simulation ──────────────────────────────────────────

/** Network condition preset. */
export type OfflineNetworkCondition = 'online' | 'offline' | 'slow' | 'flaky';

/** Network simulation state. */
export interface NetworkSimulation {
  readonly condition: OfflineNetworkCondition;
  isOnline(): boolean;
  setCondition(condition: OfflineNetworkCondition): void;
  /** Simulate a request — resolves or rejects based on condition. */
  simulateRequest<T>(fn: () => Promise<T>): Promise<T>;
}

/** Create a network simulator. */
export function simulateNetwork(initial: OfflineNetworkCondition = 'online'): NetworkSimulation {
  let condition = initial;
  let requestCount = 0;

  return {
    get condition() {
      return condition;
    },
    isOnline() {
      return condition !== 'offline';
    },
    setCondition(c) {
      condition = c;
    },
    async simulateRequest<T>(fn: () => Promise<T>): Promise<T> {
      requestCount++;
      switch (condition) {
        case 'offline':
          throw new Error('Network offline');
        case 'slow':
          await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
          return fn();
        case 'flaky':
          if (requestCount % 3 === 0) throw new Error('Network flaky: request failed');
          return fn();
        case 'online':
        default:
          return fn();
      }
    },
  };
}

/** Shorthand: simulate going offline. */
export function simulateOffline(): NetworkSimulation {
  return simulateNetwork('offline');
}

// ─── Conflict Simulation ─────────────────────────────────────────

/** A simulated conflict between two versions of a document. */
export interface SimulatedConflict {
  readonly documentId: string;
  readonly collection: string;
  readonly localVersion: Record<string, unknown>;
  readonly remoteVersion: Record<string, unknown>;
  readonly baseVersion: Record<string, unknown>;
}

/** Create a conflict scenario for testing resolution strategies. */
export function simulateConflict(
  collection: string,
  baseDoc: Record<string, unknown>,
  localChanges: Record<string, unknown>,
  remoteChanges: Record<string, unknown>
): SimulatedConflict {
  const id = (baseDoc._id as string) ?? 'conflict-doc';
  return {
    documentId: id,
    collection,
    localVersion: { ...baseDoc, ...localChanges, _id: id },
    remoteVersion: { ...baseDoc, ...remoteChanges, _id: id },
    baseVersion: { ...baseDoc, _id: id },
  };
}

// ─── Convergence Assertions ──────────────────────────────────────

/** Assert that two document sets are equivalent (same docs, any order). */
export function assertConvergence(
  replicaA: readonly Record<string, unknown>[],
  replicaB: readonly Record<string, unknown>[]
): { converged: boolean; differences: string[] } {
  const differences: string[] = [];

  if (replicaA.length !== replicaB.length) {
    differences.push(`Document count mismatch: A has ${replicaA.length}, B has ${replicaB.length}`);
  }

  const mapA = new Map(replicaA.map((d) => [d._id as string, d]));
  const mapB = new Map(replicaB.map((d) => [d._id as string, d]));

  for (const [id, docA] of mapA) {
    const docB = mapB.get(id);
    if (!docB) {
      differences.push(`Document ${id} in A but not in B`);
      continue;
    }
    const aStr = JSON.stringify(docA, Object.keys(docA).sort());
    const bStr = JSON.stringify(docB, Object.keys(docB).sort());
    if (aStr !== bStr) {
      differences.push(`Document ${id} differs between replicas`);
    }
  }

  for (const id of mapB.keys()) {
    if (!mapA.has(id)) {
      differences.push(`Document ${id} in B but not in A`);
    }
  }

  return { converged: differences.length === 0, differences };
}

// ─── Mock Sync ───────────────────────────────────────────────────

/** A mock sync channel between two test databases. */
export interface MockSync {
  /** Sync changes from source to target. */
  syncTo(source: TestDatabase, target: TestDatabase, collection: string): void;
  /** Bidirectional sync. */
  syncBoth(dbA: TestDatabase, dbB: TestDatabase, collection: string): void;
  /** Get sync history. */
  readonly history: readonly { from: string; to: string; collection: string; docCount: number }[];
}

/** Create a mock sync channel. */
export function createMockSync(): MockSync {
  const history: { from: string; to: string; collection: string; docCount: number }[] = [];

  return {
    syncTo(source, target, collection) {
      const docs = source.getAll(collection);
      for (const doc of docs) {
        target.insert(collection, doc);
      }
      history.push({ from: source.name, to: target.name, collection, docCount: docs.length });
    },
    syncBoth(dbA, dbB, collection) {
      this.syncTo(dbA, dbB, collection);
      this.syncTo(dbB, dbA, collection);
    },
    get history() {
      return history;
    },
  };
}

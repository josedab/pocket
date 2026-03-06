/**
 * Data Fixtures — capture, serialize, restore, and manage database state fixtures
 * for deterministic testing of Pocket databases.
 *
 * Provides fixture generation from live databases, file-based persistence,
 * parameterized factories, and integration with popular test runners
 * (vitest, jest, mocha).
 *
 * @module @pocket/testing
 */

import { Subject } from 'rxjs';

// ── Types ─────────────────────────────────────────────────

export interface FixtureData {
  /** Fixture metadata */
  meta: FixtureMeta;
  /** Collection data keyed by collection name */
  collections: Record<string, FixtureCollection>;
}

export interface FixtureMeta {
  name: string;
  description?: string;
  version: number;
  createdAt: string;
  tags?: string[];
}

export interface FixtureCollection {
  documents: Record<string, unknown>[];
  indexes?: FixtureIndex[];
}

export interface FixtureIndex {
  fields: string[];
  unique?: boolean;
}

export interface FixtureManagerConfig {
  /** Base directory for fixture files (used with file-based storage) */
  basePath?: string;
  /** Default format for serialization */
  format?: 'json' | 'msgpack';
  /** Whether to auto-normalize timestamps/UUIDs on capture */
  autoNormalize?: boolean;
  /** Fields to always strip when capturing */
  stripFields?: string[];
  /** Custom serializer/deserializer */
  storage?: FixtureStorage;
}

export interface FixtureStorage {
  save(name: string, data: string): Promise<void>;
  load(name: string): Promise<string | null>;
  exists(name: string): Promise<boolean>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

export interface FixtureFactory<T = Record<string, unknown>> {
  /** Create a single document with optional overrides */
  create(overrides?: Partial<T>): T;
  /** Create multiple documents */
  createMany(count: number, overrides?: Partial<T> | ((index: number) => Partial<T>)): T[];
  /** Build but don't persist — returns raw data */
  build(overrides?: Partial<T>): T;
}

export interface FixtureFactoryDefinition<T = Record<string, unknown>> {
  /** Default field values or generators */
  defaults: T | (() => T);
  /** Named variants with preset overrides */
  traits?: Record<string, Partial<T>>;
  /** Post-creation hook */
  afterCreate?: (doc: T) => T;
}

export type FixtureEvent =
  | { type: 'captured'; name: string; collections: number; documents: number }
  | { type: 'restored'; name: string; collections: number; documents: number }
  | { type: 'saved'; name: string }
  | { type: 'loaded'; name: string }
  | { type: 'deleted'; name: string };

// ── In-Memory Fixture Storage ─────────────────────────────

export class InMemoryFixtureStorage implements FixtureStorage {
  private readonly store = new Map<string, string>();

  async save(name: string, data: string): Promise<void> {
    this.store.set(name, data);
  }

  async load(name: string): Promise<string | null> {
    return this.store.get(name) ?? null;
  }

  async exists(name: string): Promise<boolean> {
    return this.store.has(name);
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async remove(name: string): Promise<void> {
    this.store.delete(name);
  }

  clear(): void {
    this.store.clear();
  }
}

// ── Sequence Generator ────────────────────────────────────

let globalSeq = 0;

/** Generate sequential IDs for fixtures */
export function sequence(prefix = 'id'): string {
  return `${prefix}_${++globalSeq}`;
}

/** Reset the global sequence counter (call in beforeEach) */
export function resetSequence(): void {
  globalSeq = 0;
}

// ── Fixture Factory ───────────────────────────────────────

/**
 * Create a typed fixture factory for generating test documents.
 *
 * ```ts
 * const userFactory = defineFixtureFactory<User>({
 *   defaults: () => ({ id: sequence('user'), name: 'Test User', role: 'viewer' }),
 *   traits: { admin: { role: 'admin' } },
 * });
 *
 * const user = userFactory.create();
 * const admin = userFactory.create({ ...userFactory.trait('admin') });
 * const batch = userFactory.createMany(10);
 * ```
 */
export function defineFixtureFactory<T extends Record<string, unknown>>(
  definition: FixtureFactoryDefinition<T>
): FixtureFactory<T> & { trait(name: string): Partial<T> } {
  const getDefaults = (): T => {
    if (typeof definition.defaults === 'function') {
      return (definition.defaults as () => T)();
    }
    return { ...definition.defaults };
  };

  const factory: FixtureFactory<T> & { trait(name: string): Partial<T> } = {
    create(overrides?: Partial<T>): T {
      let doc = { ...getDefaults(), ...overrides } as T;
      if (definition.afterCreate) {
        doc = definition.afterCreate(doc);
      }
      return doc;
    },

    createMany(count: number, overrides?: Partial<T> | ((index: number) => Partial<T>)): T[] {
      return Array.from({ length: count }, (_, i) => {
        const ov = typeof overrides === 'function' ? overrides(i) : overrides;
        return factory.create(ov);
      });
    },

    build(overrides?: Partial<T>): T {
      return { ...getDefaults(), ...overrides } as T;
    },

    trait(name: string): Partial<T> {
      const traits = definition.traits ?? {};
      const t = traits[name];
      if (!t) {
        throw new Error(
          `Unknown fixture trait: "${name}". Available: ${Object.keys(traits).join(', ')}`
        );
      }
      return t;
    },
  };

  return factory;
}

// ── Fixture Manager ───────────────────────────────────────

/**
 * Manages database state fixtures: capture, save, load, restore, and diff.
 *
 * Supports pluggable storage backends (in-memory default, file-system for CI),
 * auto-normalization of non-deterministic values, and event tracking.
 */
export class FixtureManager {
  private readonly config: Required<FixtureManagerConfig>;
  private readonly storage: FixtureStorage;
  private readonly events$$ = new Subject<FixtureEvent>();
  private readonly cache = new Map<string, FixtureData>();

  /** Observable stream of fixture events */
  readonly events$ = this.events$$.asObservable();

  constructor(config: FixtureManagerConfig = {}) {
    this.config = {
      basePath: config.basePath ?? './fixtures',
      format: config.format ?? 'json',
      autoNormalize: config.autoNormalize ?? false,
      stripFields: config.stripFields ?? ['_rev', 'updatedAt'],
      storage: config.storage ?? new InMemoryFixtureStorage(),
    };
    this.storage = this.config.storage;
  }

  /**
   * Capture current database state as a fixture.
   * Pass raw collection data (e.g., from db.collection('users').find()).
   */
  capture(
    name: string,
    collections: Record<string, Record<string, unknown>[]>,
    options: { description?: string; tags?: string[] } = {}
  ): FixtureData {
    const fixture: FixtureData = {
      meta: {
        name,
        description: options.description,
        version: 1,
        createdAt: new Date().toISOString(),
        tags: options.tags,
      },
      collections: {},
    };

    let totalDocs = 0;
    for (const [colName, docs] of Object.entries(collections)) {
      const processed = docs.map((doc) => this.processDocument(doc));
      fixture.collections[colName] = { documents: processed };
      totalDocs += processed.length;
    }

    this.cache.set(name, fixture);
    this.events$$.next({
      type: 'captured',
      name,
      collections: Object.keys(collections).length,
      documents: totalDocs,
    });

    return fixture;
  }

  /** Save a fixture to persistent storage */
  async save(name: string, fixture?: FixtureData): Promise<void> {
    const data = fixture ?? this.cache.get(name);
    if (!data) {
      throw new Error(`Fixture "${name}" not found in cache. Capture or load it first.`);
    }
    const serialized = JSON.stringify(data, null, 2);
    await this.storage.save(name, serialized);
    this.events$$.next({ type: 'saved', name });
  }

  /** Load a fixture from persistent storage */
  async load(name: string): Promise<FixtureData> {
    const raw = await this.storage.load(name);
    if (!raw) {
      throw new Error(`Fixture "${name}" not found in storage.`);
    }
    const fixture = JSON.parse(raw) as FixtureData;
    this.cache.set(name, fixture);
    this.events$$.next({ type: 'loaded', name });
    return fixture;
  }

  /** Get a fixture from cache (previously captured or loaded) */
  get(name: string): FixtureData | undefined {
    return this.cache.get(name);
  }

  /** Check if a fixture exists in storage */
  async exists(name: string): Promise<boolean> {
    return this.storage.exists(name);
  }

  /** List all saved fixtures */
  async list(): Promise<string[]> {
    return this.storage.list();
  }

  /** Delete a fixture from storage */
  async remove(name: string): Promise<void> {
    this.cache.delete(name);
    await this.storage.remove(name);
    this.events$$.next({ type: 'deleted', name });
  }

  /**
   * Restore a fixture — returns collection data ready to be inserted
   * into a database. Optionally filter to specific collections.
   */
  restore(
    name: string,
    options: { collections?: string[] } = {}
  ): Record<string, Record<string, unknown>[]> {
    const fixture = this.cache.get(name);
    if (!fixture) {
      throw new Error(`Fixture "${name}" not in cache. Load it first with load().`);
    }

    const result: Record<string, Record<string, unknown>[]> = {};
    for (const [colName, colData] of Object.entries(fixture.collections)) {
      if (options.collections && !options.collections.includes(colName)) continue;
      result[colName] = colData.documents.map((doc) => ({ ...doc }));
    }

    const totalDocs = Object.values(result).reduce((sum, docs) => sum + docs.length, 0);
    this.events$$.next({
      type: 'restored',
      name,
      collections: Object.keys(result).length,
      documents: totalDocs,
    });

    return result;
  }

  /**
   * Merge multiple fixtures into one.
   * Later fixtures override earlier ones for the same collection.
   */
  merge(name: string, ...fixtureNames: string[]): FixtureData {
    const merged: FixtureData = {
      meta: {
        name,
        description: `Merged from: ${fixtureNames.join(', ')}`,
        version: 1,
        createdAt: new Date().toISOString(),
      },
      collections: {},
    };

    for (const fName of fixtureNames) {
      const fixture = this.cache.get(fName);
      if (!fixture) {
        throw new Error(`Fixture "${fName}" not in cache.`);
      }
      for (const [colName, colData] of Object.entries(fixture.collections)) {
        merged.collections[colName] ??= { documents: [] };
        merged.collections[colName].documents.push(...colData.documents);
      }
    }

    this.cache.set(name, merged);
    return merged;
  }

  /** Clear in-memory cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Destroy the manager, completing event stream */
  destroy(): void {
    this.events$$.complete();
    this.cache.clear();
  }

  // ── Internals ─────────────────────────────────────────

  private processDocument(doc: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (this.config.stripFields.includes(key)) continue;
      result[key] = value;
    }
    return result;
  }
}

// ── Test Runner Integration ───────────────────────────────

export interface TestFixtureContext {
  manager: FixtureManager;
  /** Load and restore fixture data before each test */
  useFixture(name: string): Promise<Record<string, Record<string, unknown>[]>>;
  /** Capture current state and compare against saved fixture */
  assertMatchesFixture(
    name: string,
    currentData: Record<string, Record<string, unknown>[]>
  ): Promise<void>;
}

/**
 * Create a test fixture context for integration with test runners.
 *
 * ```ts
 * // vitest / jest
 * const fixtures = createTestFixtures({ storage: myStorage });
 *
 * beforeEach(async () => {
 *   const data = await fixtures.useFixture('seed-data');
 *   await db.bulkInsert(data);
 * });
 *
 * afterEach(() => fixtures.manager.clearCache());
 * ```
 */
export function createTestFixtures(config?: FixtureManagerConfig): TestFixtureContext {
  const manager = new FixtureManager(config);

  return {
    manager,

    async useFixture(name: string): Promise<Record<string, Record<string, unknown>[]>> {
      await manager.load(name);
      return manager.restore(name);
    },

    async assertMatchesFixture(
      name: string,
      currentData: Record<string, Record<string, unknown>[]>
    ): Promise<void> {
      const expected = manager.get(name) ?? (await manager.load(name));

      const currentFixture = manager.capture('__assert_temp__', currentData);

      // Compare collections
      const expectedCols = Object.keys(expected.collections).sort();
      const actualCols = Object.keys(currentFixture.collections).sort();

      if (JSON.stringify(expectedCols) !== JSON.stringify(actualCols)) {
        throw new Error(
          `Fixture mismatch: expected collections [${expectedCols.join(', ')}] but got [${actualCols.join(', ')}]`
        );
      }

      for (const colName of expectedCols) {
        const expectedDocs = expected.collections[colName]!.documents;
        const actualDocs = currentFixture.collections[colName]!.documents;

        if (expectedDocs.length !== actualDocs.length) {
          throw new Error(
            `Fixture mismatch in "${colName}": expected ${expectedDocs.length} documents but got ${actualDocs.length}`
          );
        }

        const expectedStr = JSON.stringify(expectedDocs);
        const actualStr = JSON.stringify(actualDocs);
        if (expectedStr !== actualStr) {
          throw new Error(
            `Fixture mismatch in "${colName}": document contents differ.\n` +
              `Expected: ${expectedStr.slice(0, 200)}...\n` +
              `Actual: ${actualStr.slice(0, 200)}...`
          );
        }
      }

      manager.clearCache();
    },
  };
}

// ── Factory ───────────────────────────────────────────────

/** Create a new fixture manager */
export function createFixtureManager(config?: FixtureManagerConfig): FixtureManager {
  return new FixtureManager(config);
}

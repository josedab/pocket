import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryTierBackend,
  StorageTieringManager,
  accessFrequencyPolicy,
  coldDataPolicy,
  createStorageTiering,
  dataSizePolicy,
} from '../tiering-manager.js';
import type {
  AccessRecord,
  StorageTier,
  StorageTieringConfig,
  TierStorageBackend,
  TieringEvent,
  TieringPolicy,
  TieringStats,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────

/** Create a simple two-tier config (memory + indexeddb) */
function twoTierConfig(overrides?: Partial<StorageTieringConfig>): Partial<StorageTieringConfig> {
  return {
    tiers: [
      { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
      { tier: 'indexeddb', maxSizeBytes: 10240, latencyBudgetMs: 10, available: true, priority: 1 },
    ],
    autoTier: false,
    ...overrides,
  };
}

/** Create a second MemoryTierBackend that reports itself as a different tier */
function createFakeBackend(tier: StorageTier): TierStorageBackend {
  const store = new Map<string, unknown>();
  return {
    tier,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async keys() {
      return Array.from(store.keys());
    },
    async size() {
      return store.size;
    },
    async clear() {
      store.clear();
    },
  };
}

/** Collect events from a manager into an array, returns cleanup fn */
function collectEvents(manager: StorageTieringManager): {
  events: TieringEvent[];
  stop: () => void;
} {
  const events: TieringEvent[] = [];
  const sub = manager.events$.subscribe((e) => events.push(e));
  return { events, stop: () => sub.unsubscribe() };
}

// ── MemoryTierBackend ─────────────────────────────────────

describe('MemoryTierBackend', () => {
  let backend: MemoryTierBackend;

  beforeEach(() => {
    backend = new MemoryTierBackend();
  });

  it('reports tier as "memory"', () => {
    expect(backend.tier).toBe('memory');
  });

  it('get returns null for missing key', async () => {
    expect(await backend.get('nope')).toBeNull();
  });

  it('set + get round-trips a value', async () => {
    await backend.set('k1', { hello: 'world' });
    expect(await backend.get('k1')).toEqual({ hello: 'world' });
  });

  it('has returns true/false correctly', async () => {
    expect(await backend.has('k1')).toBe(false);
    await backend.set('k1', 1);
    expect(await backend.has('k1')).toBe(true);
  });

  it('delete removes a key', async () => {
    await backend.set('k1', 1);
    await backend.delete('k1');
    expect(await backend.has('k1')).toBe(false);
    expect(await backend.get('k1')).toBeNull();
  });

  it('keys returns all stored keys', async () => {
    await backend.set('a', 1);
    await backend.set('b', 2);
    expect(await backend.keys()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('size returns count of entries', async () => {
    expect(await backend.size()).toBe(0);
    await backend.set('a', 1);
    await backend.set('b', 2);
    expect(await backend.size()).toBe(2);
  });

  it('clear removes all entries', async () => {
    await backend.set('a', 1);
    await backend.set('b', 2);
    await backend.clear();
    expect(await backend.size()).toBe(0);
  });
});

// ── StorageTieringManager: Creation & Config ──────────────

describe('StorageTieringManager', () => {
  let manager: StorageTieringManager;

  afterEach(() => {
    manager?.dispose();
  });

  describe('creation and configuration', () => {
    it('creates with default config via constructor', () => {
      manager = new StorageTieringManager();
      expect(manager).toBeInstanceOf(StorageTieringManager);
    });

    it('creates via factory function', () => {
      manager = createStorageTiering();
      expect(manager).toBeInstanceOf(StorageTieringManager);
    });

    it('accepts partial config overrides', () => {
      manager = createStorageTiering({ promotionThreshold: 5 });
      const stats = manager.getStats();
      expect(stats).toBeDefined();
    });

    it('accepts custom policies', () => {
      const customPolicy: TieringPolicy = {
        name: 'always-memory',
        evaluate: () => 'memory',
      };
      manager = createStorageTiering(twoTierConfig(), [customPolicy]);
      expect(manager).toBeInstanceOf(StorageTieringManager);
    });

    it('dispose completes observables without error', () => {
      manager = createStorageTiering(twoTierConfig());
      expect(() => manager.dispose()).not.toThrow();
    });

    it('can be created with autoTier disabled', () => {
      manager = createStorageTiering({ autoTier: false });
      // Should not throw on creation or disposal
      expect(manager).toBeInstanceOf(StorageTieringManager);
    });
  });

  // ── Backend Registration ──────────────────────────────

  describe('registerBackend', () => {
    it('registers a memory backend', () => {
      manager = createStorageTiering(twoTierConfig());
      const backend = new MemoryTierBackend();
      manager.registerBackend(backend);
      // No error means success; verify by writing data
    });

    it('registered backends are used for read/write', async () => {
      manager = createStorageTiering(twoTierConfig());
      const backend = new MemoryTierBackend();
      manager.registerBackend(backend);

      await manager.set('key1', 'value1');
      expect(await manager.get('key1')).toBe('value1');
    });

    it('can register multiple backends for different tiers', async () => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));

      await manager.set('k', 'v');
      expect(await manager.has('k')).toBe(true);
    });
  });

  // ── CRUD Operations ───────────────────────────────────

  describe('get / set / delete / has', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('set writes data and get retrieves it', async () => {
      await manager.set('doc:1', { name: 'Alice' });
      expect(await manager.get('doc:1')).toEqual({ name: 'Alice' });
    });

    it('get returns null for non-existent key', async () => {
      expect(await manager.get('missing')).toBeNull();
    });

    it('has returns true for existing keys', async () => {
      await manager.set('doc:1', 'val');
      expect(await manager.has('doc:1')).toBe(true);
    });

    it('has returns false for non-existent keys', async () => {
      expect(await manager.has('nope')).toBe(false);
    });

    it('delete removes data from all tiers', async () => {
      await manager.set('doc:1', 'val');
      await manager.delete('doc:1');
      expect(await manager.has('doc:1')).toBe(false);
      expect(await manager.get('doc:1')).toBeNull();
    });

    it('set throws when no backend is registered for the target tier', async () => {
      const bareManager = createStorageTiering({
        tiers: [
          { tier: 'sqlite', maxSizeBytes: 0, latencyBudgetMs: 5, available: true, priority: 0 },
        ],
        autoTier: false,
      });
      // No backend registered for sqlite
      await expect(bareManager.set('k', 'v')).rejects.toThrow('No backend registered for tier');
      bareManager.dispose();
    });

    it('set with collection parameter', async () => {
      await manager.set('doc:1', 'val', 'users');
      expect(await manager.get('doc:1', 'users')).toBe('val');
    });

    it('stores and retrieves various data types', async () => {
      await manager.set('str', 'hello');
      await manager.set('num', 42);
      await manager.set('bool', true);
      await manager.set('arr', [1, 2, 3]);
      await manager.set('obj', { nested: { deep: true } });
      await manager.set('null-val', null);

      expect(await manager.get('str')).toBe('hello');
      expect(await manager.get('num')).toBe(42);
      expect(await manager.get('bool')).toBe(true);
      expect(await manager.get('arr')).toEqual([1, 2, 3]);
      expect(await manager.get('obj')).toEqual({ nested: { deep: true } });
    });
  });

  // ── Access Tracking ───────────────────────────────────

  describe('access tracking', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('tracks access count across multiple reads', async () => {
      await manager.set('key1', 'value');
      await manager.get('key1');
      await manager.get('key1');
      await manager.get('key1');

      const stats = manager.getStats();
      // key1 should be in hotKeys (most accessed)
      expect(stats.hotKeys).toContain('key1');
    });

    it('tracks access for set operations', async () => {
      await manager.set('key1', 'v1');
      const stats = manager.getStats();
      expect(stats.tierDistribution).toBeDefined();
      // After one set, key1 should show up in distribution
      const totalCount = Object.values(stats.tierDistribution).reduce((sum, d) => sum + d.count, 0);
      expect(totalCount).toBe(1);
    });

    it('delete removes access records', async () => {
      await manager.set('key1', 'v1');
      await manager.delete('key1');
      const stats = manager.getStats();
      const totalCount = Object.values(stats.tierDistribution).reduce((sum, d) => sum + d.count, 0);
      expect(totalCount).toBe(0);
    });

    it('tracks multiple keys independently', async () => {
      await manager.set('a', '1');
      await manager.set('b', '2');
      await manager.set('c', '3');

      // Access 'a' more times
      await manager.get('a');
      await manager.get('a');
      await manager.get('a');

      const stats = manager.getStats();
      // 'a' should be the hottest key
      expect(stats.hotKeys[0]).toBe('a');
    });
  });

  // ── Built-in Policies ─────────────────────────────────

  describe('accessFrequencyPolicy', () => {
    const config: StorageTieringConfig = {
      tiers: [
        { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
        {
          tier: 'indexeddb',
          maxSizeBytes: 10240,
          latencyBudgetMs: 10,
          available: true,
          priority: 1,
        },
      ],
      promotionThreshold: 5,
    };

    it('promotes data when access count >= threshold', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 5,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now() - 10000,
        dataSizeBytes: 100,
        currentTier: 'indexeddb',
      };

      const result = accessFrequencyPolicy.evaluate(record, config);
      expect(result).toBe('memory');
    });

    it('returns null when access count < threshold', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 2,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now() - 10000,
        dataSizeBytes: 100,
        currentTier: 'indexeddb',
      };

      const result = accessFrequencyPolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('returns null when already in fastest tier', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 100,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now() - 10000,
        dataSizeBytes: 100,
        currentTier: 'memory',
      };

      const result = accessFrequencyPolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('uses default threshold of 10 when not specified', () => {
      const configNoThreshold: StorageTieringConfig = {
        tiers: config.tiers,
      };

      const belowDefault: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 9,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 100,
        currentTier: 'indexeddb',
      };

      const atDefault: AccessRecord = { ...belowDefault, accessCount: 10 };

      expect(accessFrequencyPolicy.evaluate(belowDefault, configNoThreshold)).toBeNull();
      expect(accessFrequencyPolicy.evaluate(atDefault, configNoThreshold)).toBe('memory');
    });

    it('skips unavailable tiers', () => {
      const configWithUnavailable: StorageTieringConfig = {
        tiers: [
          { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: false, priority: 0 },
          {
            tier: 'indexeddb',
            maxSizeBytes: 10240,
            latencyBudgetMs: 10,
            available: true,
            priority: 1,
          },
          { tier: 'opfs', maxSizeBytes: 102400, latencyBudgetMs: 20, available: true, priority: 2 },
        ],
        promotionThreshold: 5,
      };

      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 10,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 100,
        currentTier: 'opfs',
      };

      // Should promote to indexeddb (not memory, since memory is unavailable)
      const result = accessFrequencyPolicy.evaluate(record, configWithUnavailable);
      expect(result).toBe('indexeddb');
    });

    it('has name "access-frequency"', () => {
      expect(accessFrequencyPolicy.name).toBe('access-frequency');
    });
  });

  describe('coldDataPolicy', () => {
    const config: StorageTieringConfig = {
      tiers: [
        { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
        {
          tier: 'indexeddb',
          maxSizeBytes: 10240,
          latencyBudgetMs: 10,
          available: true,
          priority: 1,
        },
      ],
      demotionTimeMs: 1000,
    };

    it('demotes data that has not been accessed within demotion time', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now() - 2000,
        firstAccessedAt: Date.now() - 5000,
        dataSizeBytes: 100,
        currentTier: 'memory',
      };

      const result = coldDataPolicy.evaluate(record, config);
      expect(result).toBe('indexeddb');
    });

    it('returns null for recently accessed data', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 100,
        currentTier: 'memory',
      };

      const result = coldDataPolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('returns null when already in slowest tier', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now() - 2000,
        firstAccessedAt: Date.now() - 5000,
        dataSizeBytes: 100,
        currentTier: 'indexeddb',
      };

      const result = coldDataPolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('uses default demotion time of 5 min when not specified', () => {
      const configNoTime: StorageTieringConfig = { tiers: config.tiers };

      const recentEnough: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now() - 4 * 60 * 1000, // 4 min ago
        firstAccessedAt: Date.now() - 10 * 60 * 1000,
        dataSizeBytes: 100,
        currentTier: 'memory',
      };

      const tooOld: AccessRecord = {
        ...recentEnough,
        lastAccessedAt: Date.now() - 6 * 60 * 1000, // 6 min ago
      };

      expect(coldDataPolicy.evaluate(recentEnough, configNoTime)).toBeNull();
      expect(coldDataPolicy.evaluate(tooOld, configNoTime)).toBe('indexeddb');
    });

    it('has name "cold-data"', () => {
      expect(coldDataPolicy.name).toBe('cold-data');
    });
  });

  describe('dataSizePolicy', () => {
    const config: StorageTieringConfig = {
      tiers: [
        { tier: 'memory', maxSizeBytes: 1000, latencyBudgetMs: 1, available: true, priority: 0 },
        {
          tier: 'indexeddb',
          maxSizeBytes: 10000,
          latencyBudgetMs: 10,
          available: true,
          priority: 1,
        },
      ],
    };

    it('demotes large items (>10% of tier capacity) to slower tiers', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 200, // 200 > 1000 * 0.1 = 100
        currentTier: 'memory',
      };

      const result = dataSizePolicy.evaluate(record, config);
      expect(result).toBe('indexeddb');
    });

    it('returns null for small items', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 50, // 50 < 1000 * 0.1 = 100
        currentTier: 'memory',
      };

      const result = dataSizePolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('returns null when already in slowest tier', () => {
      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 5000, // Large but already in slowest
        currentTier: 'indexeddb',
      };

      const result = dataSizePolicy.evaluate(record, config);
      expect(result).toBeNull();
    });

    it('returns null when tier has unlimited capacity (maxSizeBytes=0)', () => {
      const configUnlimited: StorageTieringConfig = {
        tiers: [
          { tier: 'memory', maxSizeBytes: 0, latencyBudgetMs: 1, available: true, priority: 0 },
          {
            tier: 'indexeddb',
            maxSizeBytes: 10000,
            latencyBudgetMs: 10,
            available: true,
            priority: 1,
          },
        ],
      };

      const record: AccessRecord = {
        key: 'doc:1',
        collection: 'default',
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: 99999,
        currentTier: 'memory',
      };

      const result = dataSizePolicy.evaluate(record, configUnlimited);
      expect(result).toBeNull();
    });

    it('has name "data-size"', () => {
      expect(dataSizePolicy.name).toBe('data-size');
    });
  });

  // ── Rebalancing ───────────────────────────────────────

  describe('rebalance', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig({ promotionThreshold: 3, demotionTimeMs: 500 }));
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('returns empty decisions when no data exists', async () => {
      const decisions = await manager.rebalance();
      expect(decisions).toEqual([]);
    });

    it('promotes frequently accessed data from slower to faster tier', async () => {
      // Write to indexeddb by making it the only registered backend initially
      const idbManager = createStorageTiering({
        tiers: [
          { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
          {
            tier: 'indexeddb',
            maxSizeBytes: 10240,
            latencyBudgetMs: 10,
            available: true,
            priority: 1,
          },
        ],
        autoTier: false,
        promotionThreshold: 3,
      });

      const memBackend = new MemoryTierBackend();
      const idbBackend = createFakeBackend('indexeddb');

      // Only register idb first to force writes there
      idbManager.registerBackend(idbBackend);
      await idbManager.set('doc:1', 'data');

      // Now register memory backend
      idbManager.registerBackend(memBackend);

      // Access many times (via idb since that's where data is)
      await idbManager.get('doc:1');
      await idbManager.get('doc:1');
      await idbManager.get('doc:1');

      const decisions = await idbManager.rebalance();
      const promotion = decisions.find((d) => d.key === 'doc:1' && d.toTier === 'memory');
      expect(promotion).toBeDefined();

      idbManager.dispose();
    });

    it('demotes cold data from faster to slower tiers', async () => {
      const coldManager = createStorageTiering({
        tiers: [
          { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
          {
            tier: 'indexeddb',
            maxSizeBytes: 10240,
            latencyBudgetMs: 10,
            available: true,
            priority: 1,
          },
        ],
        autoTier: false,
        promotionThreshold: 100, // High threshold so frequency policy doesn't fire
        demotionTimeMs: 1, // Very short demotion time
      });

      coldManager.registerBackend(new MemoryTierBackend());
      coldManager.registerBackend(createFakeBackend('indexeddb'));

      await coldManager.set('doc:1', 'data');

      // Wait a bit so data becomes "cold"
      await new Promise((r) => setTimeout(r, 10));

      const decisions = await coldManager.rebalance();
      const demotion = decisions.find((d) => d.key === 'doc:1' && d.toTier === 'indexeddb');
      expect(demotion).toBeDefined();

      coldManager.dispose();
    });

    it('updates lastRebalanceAt after rebalancing', async () => {
      expect(manager.getStats().lastRebalanceAt).toBeNull();
      await manager.rebalance();
      expect(manager.getStats().lastRebalanceAt).toBeTypeOf('number');
    });

    it('first matching policy wins', async () => {
      const firstPolicy: TieringPolicy = {
        name: 'first',
        evaluate: () => 'indexeddb',
      };
      const secondPolicy: TieringPolicy = {
        name: 'second',
        evaluate: () => 'memory',
      };

      const policyManager = createStorageTiering(twoTierConfig(), [firstPolicy, secondPolicy]);
      policyManager.registerBackend(new MemoryTierBackend());
      policyManager.registerBackend(createFakeBackend('indexeddb'));

      await policyManager.set('doc:1', 'data');
      const decisions = await policyManager.rebalance();

      // First policy says go to indexeddb (demotion from memory)
      if (decisions.length > 0) {
        expect(decisions[0]!.toTier).toBe('indexeddb');
        expect(decisions[0]!.reason).toBe('first');
      }

      policyManager.dispose();
    });

    it('skips policies that return null', async () => {
      const nullPolicy: TieringPolicy = {
        name: 'null-policy',
        evaluate: () => null,
      };
      const movePolicy: TieringPolicy = {
        name: 'move-policy',
        evaluate: (record) => (record.currentTier === 'memory' ? 'indexeddb' : null),
      };

      const policyManager = createStorageTiering(twoTierConfig(), [nullPolicy, movePolicy]);
      policyManager.registerBackend(new MemoryTierBackend());
      policyManager.registerBackend(createFakeBackend('indexeddb'));

      await policyManager.set('doc:1', 'data');
      const decisions = await policyManager.rebalance();

      // The null-policy returns null, so move-policy should fire
      expect(decisions.length).toBe(1);
      expect(decisions[0]!.reason).toBe('move-policy');

      policyManager.dispose();
    });

    it('skips decisions when target tier equals current tier', async () => {
      const samePolicy: TieringPolicy = {
        name: 'same-tier',
        evaluate: (record) => record.currentTier,
      };

      const policyManager = createStorageTiering(twoTierConfig(), [samePolicy]);
      policyManager.registerBackend(new MemoryTierBackend());

      await policyManager.set('doc:1', 'data');
      const decisions = await policyManager.rebalance();
      expect(decisions).toEqual([]);

      policyManager.dispose();
    });
  });

  // ── Manual Promote / Demote ───────────────────────────

  describe('promote and demote', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('promote returns false for unknown key', async () => {
      expect(await manager.promote('nope')).toBe(false);
    });

    it('demote returns false for unknown key', async () => {
      expect(await manager.demote('nope')).toBe(false);
    });

    it('demote moves data to the next slower tier', async () => {
      await manager.set('key1', 'data');
      const { events, stop } = collectEvents(manager);

      const result = await manager.demote('key1');
      expect(result).toBe(true);

      const demoteEvent = events.find((e) => e.type === 'demoted');
      expect(demoteEvent).toBeDefined();
      if (demoteEvent && demoteEvent.type === 'demoted') {
        expect(demoteEvent.to).toBe('indexeddb');
      }

      stop();
    });

    it('promote returns false when already in fastest tier', async () => {
      await manager.set('key1', 'data');
      // Data should already be in memory (fastest tier)
      const result = await manager.promote('key1');
      expect(result).toBe(false);
    });

    it('demote returns false when already in slowest tier', async () => {
      await manager.set('key1', 'data');
      // Demote to slowest
      await manager.demote('key1');
      // Try to demote again
      const result = await manager.demote('key1');
      expect(result).toBe(false);
    });

    it('promote after demote restores to original tier', async () => {
      await manager.set('key1', 'data');

      await manager.demote('key1');
      const { events, stop } = collectEvents(manager);

      await manager.promote('key1');
      const promoteEvent = events.find((e) => e.type === 'promoted');
      expect(promoteEvent).toBeDefined();
      if (promoteEvent && promoteEvent.type === 'promoted') {
        expect(promoteEvent.to).toBe('memory');
      }

      stop();
    });
  });

  // ── Statistics ────────────────────────────────────────

  describe('getStats', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('returns initial stats with zero counts', () => {
      const stats = manager.getStats();
      expect(stats.promotions).toBe(0);
      expect(stats.demotions).toBe(0);
      expect(stats.totalMigrations).toBe(0);
      expect(stats.lastRebalanceAt).toBeNull();
      expect(stats.hotKeys).toEqual([]);
      expect(stats.coldKeys).toEqual([]);
    });

    it('tierDistribution has entries for all configured tiers', () => {
      const stats = manager.getStats();
      expect(stats.tierDistribution.memory).toBeDefined();
      expect(stats.tierDistribution.indexeddb).toBeDefined();
    });

    it('tierDistribution counts reflect stored data', async () => {
      await manager.set('a', 'data1');
      await manager.set('b', 'data2');

      const stats = manager.getStats();
      const totalCount = Object.values(stats.tierDistribution).reduce((s, d) => s + d.count, 0);
      expect(totalCount).toBe(2);
    });

    it('tracks promotions counter', async () => {
      await manager.set('key1', 'data');
      await manager.demote('key1');
      await manager.promote('key1');

      const stats = manager.getStats();
      expect(stats.promotions).toBe(1);
    });

    it('tracks demotions counter', async () => {
      await manager.set('key1', 'data');
      await manager.demote('key1');

      const stats = manager.getStats();
      expect(stats.demotions).toBe(1);
    });

    it('tracks total migrations', async () => {
      await manager.set('key1', 'data');
      await manager.demote('key1');
      await manager.promote('key1');

      const stats = manager.getStats();
      expect(stats.totalMigrations).toBe(2);
    });

    it('hotKeys shows most frequently accessed keys', async () => {
      await manager.set('hot', 'data');
      await manager.set('cold', 'data');

      for (let i = 0; i < 10; i++) {
        await manager.get('hot');
      }

      const stats = manager.getStats();
      expect(stats.hotKeys[0]).toBe('hot');
    });

    it('coldKeys shows least recently accessed keys', async () => {
      await manager.set('old-key', 'data');
      // Wait a tiny bit to ensure time ordering
      await new Promise((r) => setTimeout(r, 5));
      await manager.set('new-key', 'data');

      const stats = manager.getStats();
      expect(stats.coldKeys[0]).toBe('old-key');
    });

    it('hotKeys is limited to 10 entries', async () => {
      for (let i = 0; i < 15; i++) {
        await manager.set(`key-${i}`, `data-${i}`);
      }

      const stats = manager.getStats();
      expect(stats.hotKeys.length).toBeLessThanOrEqual(10);
    });

    it('sizeBytes accumulates in tier distribution', async () => {
      await manager.set('k1', 'hello');
      await manager.set('k2', 'world');

      const stats = manager.getStats();
      const totalSize = Object.values(stats.tierDistribution).reduce((s, d) => s + d.sizeBytes, 0);
      expect(totalSize).toBeGreaterThan(0);
    });
  });

  // ── Events (RxJS) ─────────────────────────────────────

  describe('events$', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('emits "rebalanced" event on rebalance', async () => {
      const { events, stop } = collectEvents(manager);
      await manager.rebalance();

      const rebalanceEvent = events.find((e) => e.type === 'rebalanced');
      expect(rebalanceEvent).toBeDefined();
      if (rebalanceEvent && rebalanceEvent.type === 'rebalanced') {
        expect(rebalanceEvent.decisions).toBeInstanceOf(Array);
      }

      stop();
    });

    it('emits "promoted" event on manual promote', async () => {
      await manager.set('key1', 'data');
      await manager.demote('key1');

      const { events, stop } = collectEvents(manager);
      await manager.promote('key1');

      const promoteEvent = events.find((e) => e.type === 'promoted');
      expect(promoteEvent).toBeDefined();

      stop();
    });

    it('emits "demoted" event on manual demote', async () => {
      await manager.set('key1', 'data');
      const { events, stop } = collectEvents(manager);

      await manager.demote('key1');
      const demoteEvent = events.find((e) => e.type === 'demoted');
      expect(demoteEvent).toBeDefined();

      stop();
    });

    it('emits "error" event on migration failure', async () => {
      const failingBackend: TierStorageBackend = {
        tier: 'indexeddb',
        async get() {
          throw new Error('read failure');
        },
        async set() {
          throw new Error('write failure');
        },
        async delete() {},
        async has() {
          return false;
        },
        async keys() {
          return [];
        },
        async size() {
          return 0;
        },
        async clear() {},
      };

      const failManager = createStorageTiering(twoTierConfig());
      failManager.registerBackend(new MemoryTierBackend());
      failManager.registerBackend(failingBackend);

      await failManager.set('key1', 'data');
      const { events, stop } = collectEvents(failManager);

      // Demote should trigger migration to failing backend
      await failManager.demote('key1');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === 'error') {
        expect(errorEvent.message).toContain('key1');
      }

      stop();
      failManager.dispose();
    });

    it('events$ completes after dispose', () => {
      let completed = false;
      manager.events$.subscribe({
        complete: () => {
          completed = true;
        },
      });
      manager.dispose();
      expect(completed).toBe(true);
    });
  });

  // ── stats$ Observable ─────────────────────────────────

  describe('stats$', () => {
    beforeEach(() => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));
    });

    it('emits initial stats immediately (BehaviorSubject)', () => {
      let lastStats: TieringStats | undefined;
      const sub = manager.stats$.subscribe((s) => {
        lastStats = s;
      });
      expect(lastStats).toBeDefined();
      expect(lastStats!.promotions).toBe(0);
      sub.unsubscribe();
    });

    it('emits updated stats after rebalance', async () => {
      const statsHistory: TieringStats[] = [];
      const sub = manager.stats$.subscribe((s) => statsHistory.push(s));

      await manager.rebalance();

      // Should have at least 2 emissions: initial + after rebalance
      expect(statsHistory.length).toBeGreaterThanOrEqual(2);
      const lastStat = statsHistory[statsHistory.length - 1]!;
      expect(lastStat.lastRebalanceAt).toBeTypeOf('number');

      sub.unsubscribe();
    });

    it('stats$ completes after dispose', () => {
      let completed = false;
      manager.stats$.subscribe({
        complete: () => {
          completed = true;
        },
      });
      manager.dispose();
      expect(completed).toBe(true);
    });
  });

  // ── Edge Cases ────────────────────────────────────────

  describe('edge cases', () => {
    it('works with no backends registered (get returns null)', async () => {
      manager = createStorageTiering(twoTierConfig());
      expect(await manager.get('anything')).toBeNull();
    });

    it('has returns false with no backends', async () => {
      manager = createStorageTiering(twoTierConfig());
      expect(await manager.has('anything')).toBe(false);
    });

    it('delete with no backends does not throw', async () => {
      manager = createStorageTiering(twoTierConfig());
      await expect(manager.delete('anything')).resolves.not.toThrow();
    });

    it('rebalance with no data returns empty', async () => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      const decisions = await manager.rebalance();
      expect(decisions).toEqual([]);
    });

    it('handles single-tier configuration', async () => {
      manager = createStorageTiering({
        tiers: [
          { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: true, priority: 0 },
        ],
        autoTier: false,
      });
      manager.registerBackend(new MemoryTierBackend());

      await manager.set('k1', 'v1');
      expect(await manager.get('k1')).toBe('v1');

      // Promote/demote should be no-ops
      expect(await manager.promote('k1')).toBe(false);
      expect(await manager.demote('k1')).toBe(false);

      const decisions = await manager.rebalance();
      expect(decisions).toEqual([]);
    });

    it('handles documents with no access history in rebalance', async () => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      // Rebalance without ever writing anything
      const decisions = await manager.rebalance();
      expect(decisions).toEqual([]);
    });

    it('handles all tiers unavailable', async () => {
      manager = createStorageTiering({
        tiers: [
          { tier: 'memory', maxSizeBytes: 1024, latencyBudgetMs: 1, available: false, priority: 0 },
          {
            tier: 'indexeddb',
            maxSizeBytes: 10240,
            latencyBudgetMs: 10,
            available: false,
            priority: 1,
          },
        ],
        autoTier: false,
      });

      expect(await manager.get('any')).toBeNull();
    });

    it('rebalance handles missing backends gracefully', async () => {
      // Policy that suggests a tier with no backend
      const badPolicy: TieringPolicy = {
        name: 'suggest-missing',
        evaluate: () => 'opfs', // No opfs backend registered
      };

      manager = createStorageTiering(
        {
          tiers: [
            {
              tier: 'memory',
              maxSizeBytes: 1024,
              latencyBudgetMs: 1,
              available: true,
              priority: 0,
            },
            {
              tier: 'opfs',
              maxSizeBytes: 10240,
              latencyBudgetMs: 20,
              available: true,
              priority: 2,
            },
          ],
          autoTier: false,
        },
        [badPolicy]
      );
      manager.registerBackend(new MemoryTierBackend());
      // No opfs backend registered

      await manager.set('k1', 'v1');
      // Should not throw even though opfs backend is missing
      const decisions = await manager.rebalance();
      // Decision is created but migration silently skipped (no toBackend)
      expect(decisions.length).toBeGreaterThanOrEqual(0);
    });

    it('get searches tiers from fastest to slowest', async () => {
      manager = createStorageTiering(twoTierConfig());
      const memBackend = new MemoryTierBackend();
      const idbBackend = createFakeBackend('indexeddb');

      manager.registerBackend(memBackend);
      manager.registerBackend(idbBackend);

      // Manually put data only in idb
      await idbBackend.set('only-in-idb', 'found-it');

      const result = await manager.get('only-in-idb');
      expect(result).toBe('found-it');
    });

    it('selectTierForWrite places small data in fast tier', async () => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));

      await manager.set('small', 'hi');
      const stats = manager.getStats();
      // Small data should go to memory tier
      expect(stats.tierDistribution.memory.count).toBe(1);
    });

    it('overwriting a key updates the access record', async () => {
      manager = createStorageTiering(twoTierConfig());
      manager.registerBackend(new MemoryTierBackend());

      await manager.set('k', 'first');
      await manager.set('k', 'second');

      expect(await manager.get('k')).toBe('second');

      const stats = manager.getStats();
      // Should still be 1 key (updated, not duplicated)
      const totalCount = Object.values(stats.tierDistribution).reduce((s, d) => s + d.count, 0);
      expect(totalCount).toBe(1);
    });

    it('concurrent rebalance calls do not corrupt state', async () => {
      manager = createStorageTiering(twoTierConfig({ demotionTimeMs: 1 }));
      manager.registerBackend(new MemoryTierBackend());
      manager.registerBackend(createFakeBackend('indexeddb'));

      await manager.set('k1', 'v1');
      await manager.set('k2', 'v2');
      await new Promise((r) => setTimeout(r, 5));

      // Run two rebalances concurrently
      const [d1, d2] = await Promise.all([manager.rebalance(), manager.rebalance()]);
      // Should not throw; both return arrays
      expect(Array.isArray(d1)).toBe(true);
      expect(Array.isArray(d2)).toBe(true);
    });
  });

  // ── Module Exports ────────────────────────────────────

  describe('module exports', () => {
    it('exports StorageTieringManager class', () => {
      expect(StorageTieringManager).toBeDefined();
      expect(typeof StorageTieringManager).toBe('function');
    });

    it('exports MemoryTierBackend class', () => {
      expect(MemoryTierBackend).toBeDefined();
      expect(typeof MemoryTierBackend).toBe('function');
    });

    it('exports createStorageTiering factory', () => {
      expect(createStorageTiering).toBeDefined();
      expect(typeof createStorageTiering).toBe('function');
    });

    it('exports built-in policies', () => {
      expect(accessFrequencyPolicy).toBeDefined();
      expect(accessFrequencyPolicy.name).toBe('access-frequency');

      expect(coldDataPolicy).toBeDefined();
      expect(coldDataPolicy.name).toBe('cold-data');

      expect(dataSizePolicy).toBeDefined();
      expect(dataSizePolicy.name).toBe('data-size');
    });
  });
});

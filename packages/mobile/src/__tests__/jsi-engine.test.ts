import { describe, expect, it } from 'vitest';
import type { PocketJSIModule } from '../jsi-engine.js';
import { createJSIStorageAdapter, decideSyncSchedule, getTurboModuleSpec } from '../jsi-engine.js';

describe('TurboModule Spec', () => {
  it('should generate valid module spec', () => {
    const spec = getTurboModuleSpec();
    expect(spec.moduleName).toBe('PocketJSI');
    expect(spec.methods.length).toBeGreaterThanOrEqual(8);
  });

  it('should include sync and async methods', () => {
    const spec = getTurboModuleSpec();
    const syncMethods = spec.methods.filter((m) => m.sync);
    const asyncMethods = spec.methods.filter((m) => !m.sync);
    expect(syncMethods.length).toBeGreaterThan(0);
    expect(asyncMethods.length).toBeGreaterThan(0);
  });

  it('should include transaction methods', () => {
    const spec = getTurboModuleSpec();
    const names = spec.methods.map((m) => m.name);
    expect(names).toContain('beginTransaction');
    expect(names).toContain('commitTransaction');
    expect(names).toContain('rollbackTransaction');
  });
});

describe('Battery-Aware Sync Scheduler', () => {
  it('should sync aggressively when charging', () => {
    const decision = decideSyncSchedule({ level: 0.5, isCharging: true, isLowPowerMode: false });
    expect(decision.shouldSync).toBe(true);
    expect(decision.mode).toBe('full');
    expect(decision.intervalMs).toBe(5000);
  });

  it('should reduce sync frequency in low power mode', () => {
    const decision = decideSyncSchedule({ level: 0.5, isCharging: false, isLowPowerMode: true });
    expect(decision.shouldSync).toBe(true);
    expect(decision.mode).toBe('incremental');
    expect(decision.intervalMs).toBe(120000);
  });

  it('should defer sync when battery is critically low', () => {
    const decision = decideSyncSchedule({ level: 0.05, isCharging: false, isLowPowerMode: false });
    expect(decision.shouldSync).toBe(false);
    expect(decision.mode).toBe('deferred');
  });

  it('should use incremental sync on low battery', () => {
    const decision = decideSyncSchedule({ level: 0.15, isCharging: false, isLowPowerMode: false });
    expect(decision.shouldSync).toBe(true);
    expect(decision.mode).toBe('incremental');
  });

  it('should use full sync with good battery', () => {
    const decision = decideSyncSchedule({ level: 0.8, isCharging: false, isLowPowerMode: false });
    expect(decision.shouldSync).toBe(true);
    expect(decision.mode).toBe('full');
  });

  it('should respect custom thresholds', () => {
    const decision = decideSyncSchedule(
      { level: 0.4, isCharging: false, isLowPowerMode: false },
      { minBatteryForFullSync: 0.5 }
    );
    expect(decision.mode).toBe('incremental');
  });
});

describe('JSIStorageAdapter', () => {
  function createMockJSI(): PocketJSIModule {
    const dbs = new Map<string, Record<string, unknown>[]>();
    return {
      executeSqlSync(dbName, _sql, _params) {
        return dbs.get(dbName) ?? [];
      },
      async executeSqlAsync(_dbName, _sql, _params) {
        return { rowsAffected: 1 };
      },
      openDatabase(name) {
        dbs.set(name, []);
        return true;
      },
      closeDatabase(name) {
        dbs.delete(name);
      },
      databaseExists(name) {
        return dbs.has(name);
      },
      deleteDatabase(name) {
        return dbs.delete(name);
      },
      getDatabaseSize() {
        return 1024;
      },
      beginTransaction() {},
      commitTransaction() {},
      rollbackTransaction() {},
    };
  }

  it('should connect to JSI module', () => {
    const adapter = createJSIStorageAdapter('test-db');
    adapter.connect(createMockJSI());
    expect(adapter.getSize()).toBe(1024);
  });

  it('should execute sync queries', () => {
    const adapter = createJSIStorageAdapter('test-db');
    adapter.connect(createMockJSI());
    const results = adapter.querySync('SELECT * FROM todos');
    expect(Array.isArray(results)).toBe(true);
  });

  it('should execute async writes', async () => {
    const adapter = createJSIStorageAdapter('test-db');
    adapter.connect(createMockJSI());
    const rowsAffected = await adapter.execute('INSERT INTO todos VALUES (?)');
    expect(rowsAffected).toBe(1);
  });

  it('should support transactions', async () => {
    const adapter = createJSIStorageAdapter('test-db');
    adapter.connect(createMockJSI());

    const result = await adapter.transaction(async () => {
      await adapter.execute('INSERT INTO a VALUES (1)');
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('should rollback on transaction error', async () => {
    const adapter = createJSIStorageAdapter('test-db');
    const jsi = createMockJSI();
    let rolledBack = false;
    jsi.rollbackTransaction = () => {
      rolledBack = true;
    };
    adapter.connect(jsi);

    await expect(
      adapter.transaction(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    expect(rolledBack).toBe(true);
  });

  it('should throw if not connected', () => {
    const adapter = createJSIStorageAdapter('test-db');
    expect(() => adapter.querySync('SELECT 1')).toThrow('not connected');
  });

  it('should close database', () => {
    const adapter = createJSIStorageAdapter('test-db');
    adapter.connect(createMockJSI());
    expect(() => adapter.close()).not.toThrow();
  });
});

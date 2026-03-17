/**
 * Extended tests for WasmQueryOrchestrator.
 *
 * Covers metrics tracking, aggregate caching, observable metrics,
 * config defaults, edge cases, and integration scenarios.
 */
import { describe, expect, it } from 'vitest';
import type { QueryPlan } from '../types.js';
import { createWasmEngine, WasmQueryOrchestrator } from '../wasm-engine.js';

const DOCS = [
  { _id: '1', name: 'Alice', age: 30, role: 'admin', score: 95 },
  { _id: '2', name: 'Bob', age: 25, role: 'user', score: 80 },
  { _id: '3', name: 'Charlie', age: 35, role: 'admin', score: 88 },
  { _id: '4', name: 'Diana', age: 28, role: 'user', score: 92 },
  { _id: '5', name: 'Eve', age: 22, role: 'user', score: 70 },
];

// ─── Initialization ─────────────────────────────────────────────────────────

describe('WasmQueryOrchestrator — initialization', () => {
  it('defaults to no wasm and no worker', async () => {
    const engine = createWasmEngine({ enableWasm: false, enableWorker: false });
    await engine.initialize();
    expect(engine.isWasmAvailable).toBe(false);
    expect(engine.isWorkerActive).toBe(false);
    engine.destroy();
  });

  it('isWasmAvailable is false without wasmUrl', async () => {
    const engine = createWasmEngine({ enableWasm: true, enableWorker: false });
    await engine.initialize();
    expect(engine.isWasmAvailable).toBe(false);
    engine.destroy();
  });

  it('can be used without calling initialize (direct JS engine)', async () => {
    const engine = createWasmEngine({ enableWasm: false, enableWorker: false });
    // Don't call initialize — the JS engine should still work
    const result = await engine.execute(DOCS, {});
    expect(result.documents).toHaveLength(5);
    engine.destroy();
  });
});

// ─── Metrics ────────────────────────────────────────────────────────────────

describe('WasmQueryOrchestrator — metrics', () => {
  it('starts with zero metrics', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();
    const metrics = engine.getMetrics();
    expect(metrics.queriesExecuted).toBe(0);
    expect(metrics.totalExecutionTimeMs).toBe(0);
    expect(metrics.avgExecutionTimeMs).toBe(0);
    expect(metrics.wasmAvailable).toBe(false);
    expect(metrics.workerActive).toBe(false);
    expect(metrics.cacheHitRate).toBe(0);
    engine.destroy();
  });

  it('increments queriesExecuted per unique query', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    await engine.execute(DOCS, { limit: 1 });
    await engine.execute(DOCS, { limit: 2 });
    await engine.execute(DOCS, { limit: 3 });

    expect(engine.getMetrics().queriesExecuted).toBe(3);
    engine.destroy();
  });

  it('accumulates totalExecutionTimeMs', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    await engine.execute(DOCS, {});
    const metrics = engine.getMetrics();
    expect(metrics.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
    expect(metrics.avgExecutionTimeMs).toBeGreaterThanOrEqual(0);
    engine.destroy();
  });

  it('avgExecutionTimeMs = totalExecutionTimeMs / queriesExecuted', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    await engine.execute(DOCS, { filter: { field: 'role', operator: 'eq', value: 'admin' } });
    await engine.execute(DOCS, { filter: { field: 'role', operator: 'eq', value: 'user' } });

    const metrics = engine.getMetrics();
    if (metrics.queriesExecuted > 0) {
      const expectedAvg = metrics.totalExecutionTimeMs / metrics.queriesExecuted;
      expect(metrics.avgExecutionTimeMs).toBeCloseTo(expectedAvg);
    }
    engine.destroy();
  });

  it('emits metrics via observable', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const emitted: number[] = [];
    const sub = engine.metrics.subscribe((m) => emitted.push(m.queriesExecuted));

    await engine.execute(DOCS, { limit: 1 });
    await engine.execute(DOCS, { limit: 2 });

    // At least initial + 2 updates
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    sub.unsubscribe();
    engine.destroy();
  });
});

// ─── Caching Behavior ───────────────────────────────────────────────────────

describe('WasmQueryOrchestrator — caching', () => {
  it('caches execute results (same plan + doc count = cache hit)', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const plan: QueryPlan = { filter: { field: 'age', operator: 'gt', value: 25 } };
    const r1 = await engine.execute(DOCS, plan);
    const r2 = await engine.execute(DOCS, plan);

    expect(r1).toBe(r2); // Same cached reference
    expect(engine.getMetrics().queriesExecuted).toBe(1);
    expect(engine.getMetrics().cacheHitRate).toBeGreaterThan(0);
    engine.destroy();
  });

  it('caches aggregate results', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const groupBy = { fields: ['role'], aggregates: [{ function: 'count' as const, alias: 'n' }] };
    const r1 = await engine.aggregate(DOCS, groupBy);
    const r2 = await engine.aggregate(DOCS, groupBy);

    expect(r1).toBe(r2);
    expect(engine.getMetrics().queriesExecuted).toBe(1);
    engine.destroy();
  });

  it('different plans produce different cache entries', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    await engine.execute(DOCS, { limit: 1 });
    await engine.execute(DOCS, { limit: 2 });

    expect(engine.getMetrics().queriesExecuted).toBe(2);
    engine.destroy();
  });

  it('invalidateCache forces re-execution', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const plan: QueryPlan = { filter: { field: 'role', operator: 'eq', value: 'admin' } };
    await engine.execute(DOCS, plan);

    engine.invalidateCache();
    await engine.execute(DOCS, plan);

    expect(engine.getMetrics().queriesExecuted).toBe(2);
    engine.destroy();
  });

  it('aggregate caching with filter', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const groupBy = {
      fields: ['role'],
      aggregates: [{ function: 'sum' as const, field: 'score', alias: 's' }],
    };
    const filter = { field: 'age', operator: 'gte' as const, value: 25 };

    await engine.aggregate(DOCS, groupBy, filter);
    await engine.aggregate(DOCS, groupBy, filter);

    expect(engine.getMetrics().queriesExecuted).toBe(1);
    engine.destroy();
  });
});

// ─── Query Execution ────────────────────────────────────────────────────────

describe('WasmQueryOrchestrator — query execution', () => {
  it('filter + sort + pagination', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.execute(DOCS, {
      filter: { field: 'role', operator: 'eq', value: 'user' },
      sort: [{ field: 'score', direction: 'desc' }],
      skip: 1,
      limit: 1,
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('Bob'); // Diana(92) skipped, Bob(80) next
    engine.destroy();
  });

  it('empty result set', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.execute(DOCS, {
      filter: { field: 'role', operator: 'eq', value: 'nonexistent' },
    });

    expect(result.documents).toHaveLength(0);
    expect(result.totalMatched).toBe(0);
    engine.destroy();
  });

  it('projection through orchestrator', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.execute(DOCS, {
      projection: { include: ['name', 'age'] },
      limit: 2,
    });

    expect(Object.keys(result.documents[0]!)).toEqual(['name', 'age']);
    engine.destroy();
  });

  it('empty dataset', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.execute([], {
      filter: { field: 'x', operator: 'eq', value: 1 },
    });
    expect(result.documents).toHaveLength(0);
    engine.destroy();
  });

  it('aggregation via orchestrator', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.aggregate(DOCS, {
      fields: ['role'],
      aggregates: [
        { function: 'count', alias: 'n' },
        { function: 'avg', field: 'score', alias: 'avgScore' },
        { function: 'min', field: 'age', alias: 'minAge' },
        { function: 'max', field: 'age', alias: 'maxAge' },
      ],
    });

    expect(result.groups).toHaveLength(2);
    const admin = result.groups.find((g) => g['role'] === 'admin');
    expect(admin?.['n']).toBe(2);
    expect(admin?.['minAge']).toBe(30);
    expect(admin?.['maxAge']).toBe(35);
    engine.destroy();
  });
});

// ─── Destroy / Cleanup ──────────────────────────────────────────────────────

describe('WasmQueryOrchestrator — destroy', () => {
  it('completes metrics observable', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    let completed = false;
    engine.metrics.subscribe({
      complete: () => {
        completed = true;
      },
    });
    engine.destroy();

    expect(completed).toBe(true);
  });

  it('double destroy does not throw', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
  });
});

// ─── createWasmEngine factory ───────────────────────────────────────────────

describe('createWasmEngine factory', () => {
  it('returns WasmQueryOrchestrator instance', () => {
    const engine = createWasmEngine();
    expect(engine).toBeInstanceOf(WasmQueryOrchestrator);
    engine.destroy();
  });

  it('accepts no arguments', () => {
    const engine = createWasmEngine();
    expect(engine.isWasmAvailable).toBe(false);
    engine.destroy();
  });
});

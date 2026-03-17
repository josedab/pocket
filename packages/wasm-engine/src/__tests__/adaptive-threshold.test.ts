/**
 * Comprehensive tests for AdaptiveThresholdEngine.
 *
 * Covers complexity scoring, engine decision routing,
 * metric recording, EMA updates, threshold adaptation,
 * state observables, reset, and destroy.
 */
import { describe, expect, it } from 'vitest';
import {
  AdaptiveThresholdEngine,
  computeQueryComplexity,
  createAdaptiveThresholdEngine,
  type EngineDecision,
  type QueryMetric,
} from '../adaptive-threshold.js';
import type { FilterCondition, FilterGroup, QueryPlan } from '../types.js';

// ─── computeQueryComplexity ─────────────────────────────────────────────────

describe('computeQueryComplexity', () => {
  it('returns 1 for empty plan', () => {
    expect(computeQueryComplexity({})).toBe(1);
  });

  it('adds cost for simple eq filter', () => {
    const plan: QueryPlan = { filter: { field: 'x', operator: 'eq', value: 1 } };
    expect(computeQueryComplexity(plan)).toBe(2); // 1 base + 1 eq
  });

  it('regex has highest single-operator cost', () => {
    const plan: QueryPlan = { filter: { field: 'x', operator: 'regex', value: '.*' } };
    expect(computeQueryComplexity(plan)).toBe(6); // 1 + 5 regex
  });

  it('scores each operator correctly', () => {
    const costs: Record<string, number> = {
      eq: 1,
      ne: 1,
      gt: 1,
      gte: 1,
      lt: 1,
      lte: 1,
      in: 2,
      nin: 2,
      startsWith: 2,
      contains: 3,
      endsWith: 3,
      exists: 1,
      regex: 5,
    };
    for (const [op, expected] of Object.entries(costs)) {
      const plan: QueryPlan = {
        filter: { field: 'x', operator: op as FilterCondition['operator'], value: 'v' },
      };
      expect(computeQueryComplexity(plan)).toBe(1 + expected);
    }
  });

  it('adds sort complexity (2 per clause)', () => {
    const plan: QueryPlan = {
      sort: [
        { field: 'a', direction: 'asc' },
        { field: 'b', direction: 'desc' },
      ],
    };
    expect(computeQueryComplexity(plan)).toBe(1 + 4); // base + 2*2
  });

  it('adds aggregation complexity (3 per aggregate)', () => {
    const plan: QueryPlan = {
      groupBy: {
        fields: ['role'],
        aggregates: [
          { function: 'count', alias: 'n' },
          { function: 'sum', field: 'score', alias: 's' },
        ],
      },
    };
    expect(computeQueryComplexity(plan)).toBe(1 + 6); // base + 2*3
  });

  it('adds 0.5 for projection', () => {
    const plan: QueryPlan = { projection: { include: ['name'] } };
    expect(computeQueryComplexity(plan)).toBe(1.5);
  });

  it('combined complexity sums all parts', () => {
    const plan: QueryPlan = {
      filter: { field: 'x', operator: 'regex', value: '.*' }, // +5
      sort: [{ field: 'a', direction: 'asc' }], // +2
      groupBy: {
        fields: ['g'],
        aggregates: [{ function: 'count', alias: 'n' }], // +3
      },
      projection: { include: ['x'] }, // +0.5
    };
    expect(computeQueryComplexity(plan)).toBe(1 + 5 + 2 + 3 + 0.5);
  });

  it('AND group sums condition costs (multiplier 1)', () => {
    const filter: FilterGroup = {
      logic: 'and',
      conditions: [
        { field: 'x', operator: 'eq', value: 1 } as FilterCondition, // 1
        { field: 'y', operator: 'regex', value: '.*' } as FilterCondition, // 5
      ],
    };
    expect(computeQueryComplexity({ filter })).toBe(1 + (1 + 5) * 1);
  });

  it('OR group applies 1.5x multiplier', () => {
    const filter: FilterGroup = {
      logic: 'or',
      conditions: [
        { field: 'x', operator: 'eq', value: 1 } as FilterCondition, // 1
        { field: 'y', operator: 'eq', value: 2 } as FilterCondition, // 1
      ],
    };
    // (1+1) * 1.5 = 3
    expect(computeQueryComplexity({ filter })).toBe(1 + 3);
  });

  it('nested filter groups accumulate cost', () => {
    const filter: FilterGroup = {
      logic: 'and',
      conditions: [
        { field: 'a', operator: 'eq', value: 1 } as FilterCondition, // 1
        {
          logic: 'or',
          conditions: [
            { field: 'b', operator: 'contains', value: 'x' } as FilterCondition, // 3
            { field: 'c', operator: 'in', value: [1] } as FilterCondition, // 2
          ],
        } as FilterGroup, // (3+2)*1.5 = 7.5
      ],
    };
    // AND: (1 + 7.5) * 1 = 8.5
    expect(computeQueryComplexity({ filter })).toBe(1 + 8.5);
  });
});

// ─── AdaptiveThresholdEngine — decide ───────────────────────────────────────

describe('AdaptiveThresholdEngine — decide', () => {
  it('returns js-main for small simple queries', () => {
    const engine = new AdaptiveThresholdEngine({ initialWasmThreshold: 500 });
    const decision = engine.decide(100, {});
    expect(decision).toBe('js-main');
    engine.destroy();
  });

  it('returns wasm-main when at wasm threshold', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      initialWorkerThreshold: 10000,
    });
    const decision = engine.decide(500, {});
    expect(decision).toBe('wasm-main');
    engine.destroy();
  });

  it('returns wasm-worker when above worker threshold', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      initialWorkerThreshold: 10000,
    });
    const decision = engine.decide(10000, {});
    expect(decision).toBe('wasm-worker');
    engine.destroy();
  });

  it('forces wasm-worker for very complex queries', () => {
    const engine = new AdaptiveThresholdEngine({ maxComplexity: 10 });
    // Create a plan with complexity >= 10
    const plan: QueryPlan = {
      filter: { field: 'x', operator: 'regex', value: '.*' }, // +5
      sort: [
        { field: 'a', direction: 'asc' },
        { field: 'b', direction: 'desc' },
      ], // +4
      projection: { include: ['x'] }, // +0.5
    };
    // complexity = 1 + 5 + 4 + 0.5 = 10.5 >= maxComplexity(10)
    const decision = engine.decide(10, plan);
    expect(decision).toBe('wasm-worker');
    engine.destroy();
  });

  it('uses workScore for medium datasets with complex queries', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      initialWorkerThreshold: 10000,
    });
    // docCount=300, plan has regex (complexity ~6), workScore=1800
    // wasmThreshold * complexity = 500 * 6 = 3000; workScore=1800 < 3000
    // But docCount(300) < wasmThreshold(500), so js-main
    const plan: QueryPlan = { filter: { field: 'x', operator: 'regex', value: '.*' } };
    expect(engine.decide(300, plan)).toBe('js-main');

    // docCount=500 >= wasmThreshold
    expect(engine.decide(500, plan)).toBe('wasm-main');
    engine.destroy();
  });

  it('forces wasm-worker when workScore >= workerThreshold * 5', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      initialWorkerThreshold: 1000,
    });
    // workScore needs to be >= 1000*5=5000
    // complexity of empty plan is 1, so docCount >= 5000
    expect(engine.decide(5000, {})).toBe('wasm-worker');
    engine.destroy();
  });
});

// ─── AdaptiveThresholdEngine — state & initialization ───────────────────────

describe('AdaptiveThresholdEngine — state', () => {
  it('has correct default initial state', () => {
    const engine = new AdaptiveThresholdEngine();
    const state = engine.state;
    expect(state.wasmThreshold).toBe(500);
    expect(state.workerThreshold).toBe(10000);
    expect(state.totalQueries).toBe(0);
    expect(state.avgJsTimeMs).toBe(0);
    expect(state.avgWasmTimeMs).toBe(0);
    expect(state.avgWorkerTimeMs).toBe(0);
    expect(state.lastDecision).toBe('js-main');
    engine.destroy();
  });

  it('respects custom initial config', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 1000,
      initialWorkerThreshold: 50000,
      learningRate: 0.2,
      minSamples: 10,
      targetLatencyMs: 32,
      maxComplexity: 20,
    });
    const state = engine.state;
    expect(state.wasmThreshold).toBe(1000);
    expect(state.workerThreshold).toBe(50000);
    engine.destroy();
  });

  it('state$ emits initial state', () => {
    return new Promise<void>((resolve) => {
      const engine = new AdaptiveThresholdEngine();
      engine.state$.subscribe({
        next(state) {
          expect(state.totalQueries).toBe(0);
          engine.destroy();
          resolve();
        },
      });
    });
  });
});

// ─── AdaptiveThresholdEngine — recordMetric ─────────────────────────────────

describe('AdaptiveThresholdEngine — recordMetric', () => {
  function makeMetric(engine: EngineDecision, execTime: number): QueryMetric {
    return {
      engine,
      documentCount: 1000,
      complexityScore: 5,
      executionTimeMs: execTime,
      timestamp: Date.now(),
    };
  }

  it('increments totalQueries', () => {
    const engine = new AdaptiveThresholdEngine();
    engine.recordMetric(makeMetric('js-main', 10));
    expect(engine.state.totalQueries).toBe(1);
    engine.recordMetric(makeMetric('js-main', 10));
    expect(engine.state.totalQueries).toBe(2);
    engine.destroy();
  });

  it('updates avgJsTimeMs via EMA', () => {
    const engine = new AdaptiveThresholdEngine({ learningRate: 0.5 });
    engine.recordMetric(makeMetric('js-main', 100));
    expect(engine.state.avgJsTimeMs).toBe(100);

    engine.recordMetric(makeMetric('js-main', 200));
    // EMA: 100 * 0.5 + 200 * 0.5 = 150
    expect(engine.state.avgJsTimeMs).toBe(150);
    engine.destroy();
  });

  it('updates avgWasmTimeMs via EMA', () => {
    const engine = new AdaptiveThresholdEngine({ learningRate: 0.5 });
    engine.recordMetric(makeMetric('wasm-main', 50));
    expect(engine.state.avgWasmTimeMs).toBe(50);

    engine.recordMetric(makeMetric('wasm-main', 100));
    expect(engine.state.avgWasmTimeMs).toBe(75); // 50*0.5 + 100*0.5
    engine.destroy();
  });

  it('updates avgWorkerTimeMs via EMA', () => {
    const engine = new AdaptiveThresholdEngine({ learningRate: 0.5 });
    engine.recordMetric(makeMetric('wasm-worker', 200));
    expect(engine.state.avgWorkerTimeMs).toBe(200);

    engine.recordMetric(makeMetric('wasm-worker', 100));
    expect(engine.state.avgWorkerTimeMs).toBe(150);
    engine.destroy();
  });

  it('tracks lastDecision', () => {
    const engine = new AdaptiveThresholdEngine();
    engine.recordMetric(makeMetric('wasm-main', 10));
    expect(engine.state.lastDecision).toBe('wasm-main');

    engine.recordMetric(makeMetric('js-main', 5));
    expect(engine.state.lastDecision).toBe('js-main');
    engine.destroy();
  });

  it('emits state updates via state$', () => {
    const engine = new AdaptiveThresholdEngine();
    const states: number[] = [];
    const sub = engine.state$.subscribe((s) => states.push(s.totalQueries));

    engine.recordMetric(makeMetric('js-main', 10));
    engine.recordMetric(makeMetric('js-main', 20));

    // Initial + 2 updates
    expect(states.length).toBeGreaterThanOrEqual(3);
    expect(states[states.length - 1]).toBe(2);

    sub.unsubscribe();
    engine.destroy();
  });
});

// ─── AdaptiveThresholdEngine — threshold adaptation ─────────────────────────

describe('AdaptiveThresholdEngine — threshold adaptation', () => {
  it('raises wasm threshold when JS is fast enough', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      minSamples: 5,
      targetLatencyMs: 100,
      learningRate: 0.5,
    });
    const initial = engine.state.wasmThreshold;

    // Record fast JS metrics
    for (let i = 0; i < 6; i++) {
      engine.recordMetric({
        engine: 'js-main',
        documentCount: 100,
        complexityScore: 1,
        executionTimeMs: 5, // well below target
        timestamp: Date.now(),
      });
    }

    expect(engine.state.wasmThreshold).toBeGreaterThan(initial);
    engine.destroy();
  });

  it('lowers wasm threshold when JS is slow', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      minSamples: 5,
      targetLatencyMs: 10,
      learningRate: 0.9,
    });
    const initial = engine.state.wasmThreshold;

    // Record slow JS metrics
    for (let i = 0; i < 6; i++) {
      engine.recordMetric({
        engine: 'js-main',
        documentCount: 1000,
        complexityScore: 5,
        executionTimeMs: 50, // well above target*2
        timestamp: Date.now(),
      });
    }

    expect(engine.state.wasmThreshold).toBeLessThan(initial);
    engine.destroy();
  });

  it('lowers worker threshold when WASM on main is blocking', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWorkerThreshold: 10000,
      minSamples: 5,
      targetLatencyMs: 10,
      learningRate: 0.9,
    });
    const initial = engine.state.workerThreshold;

    for (let i = 0; i < 6; i++) {
      engine.recordMetric({
        engine: 'wasm-main',
        documentCount: 5000,
        complexityScore: 3,
        executionTimeMs: 30, // above target
        timestamp: Date.now(),
      });
    }

    expect(engine.state.workerThreshold).toBeLessThan(initial);
    engine.destroy();
  });

  it('does not adapt before minSamples', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      minSamples: 20,
      targetLatencyMs: 10,
      learningRate: 0.5,
    });
    const initial = engine.state.wasmThreshold;

    for (let i = 0; i < 19; i++) {
      engine.recordMetric({
        engine: 'js-main',
        documentCount: 1000,
        complexityScore: 5,
        executionTimeMs: 100,
        timestamp: Date.now(),
      });
    }

    expect(engine.state.wasmThreshold).toBe(initial);
    engine.destroy();
  });

  it('caps thresholds within bounds', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 200,
      minSamples: 3,
      targetLatencyMs: 10,
      learningRate: 0.99,
    });

    // Record extremely slow JS to push threshold down
    for (let i = 0; i < 50; i++) {
      engine.recordMetric({
        engine: 'js-main',
        documentCount: 10,
        complexityScore: 1,
        executionTimeMs: 1000,
        timestamp: Date.now(),
      });
    }

    // wasmThreshold should not go below 100
    expect(engine.state.wasmThreshold).toBeGreaterThanOrEqual(100);
    engine.destroy();
  });

  it('sliding window trims metrics beyond 500', () => {
    const engine = new AdaptiveThresholdEngine({ minSamples: 5 });
    for (let i = 0; i < 600; i++) {
      engine.recordMetric({
        engine: 'js-main',
        documentCount: 100,
        complexityScore: 1,
        executionTimeMs: 5,
        timestamp: Date.now(),
      });
    }
    // Should not crash; totalQueries = 600
    expect(engine.state.totalQueries).toBe(600);
    engine.destroy();
  });
});

// ─── reset ──────────────────────────────────────────────────────────────────

describe('AdaptiveThresholdEngine — reset', () => {
  it('restores initial state', () => {
    const engine = new AdaptiveThresholdEngine({
      initialWasmThreshold: 500,
      initialWorkerThreshold: 10000,
    });

    engine.recordMetric({
      engine: 'js-main',
      documentCount: 100,
      complexityScore: 1,
      executionTimeMs: 50,
      timestamp: Date.now(),
    });

    engine.reset();
    const state = engine.state;
    expect(state.totalQueries).toBe(0);
    expect(state.wasmThreshold).toBe(500);
    expect(state.workerThreshold).toBe(10000);
    expect(state.avgJsTimeMs).toBe(0);
    expect(state.avgWasmTimeMs).toBe(0);
    expect(state.avgWorkerTimeMs).toBe(0);
    expect(state.lastDecision).toBe('js-main');
    engine.destroy();
  });

  it('can record metrics after reset', () => {
    const engine = new AdaptiveThresholdEngine();
    engine.recordMetric({
      engine: 'js-main',
      documentCount: 100,
      complexityScore: 1,
      executionTimeMs: 10,
      timestamp: Date.now(),
    });
    engine.reset();
    engine.recordMetric({
      engine: 'wasm-main',
      documentCount: 200,
      complexityScore: 2,
      executionTimeMs: 20,
      timestamp: Date.now(),
    });
    expect(engine.state.totalQueries).toBe(1);
    expect(engine.state.lastDecision).toBe('wasm-main');
    engine.destroy();
  });
});

// ─── destroy ────────────────────────────────────────────────────────────────

describe('AdaptiveThresholdEngine — destroy', () => {
  it('completes state$ observable', () => {
    const engine = new AdaptiveThresholdEngine();
    let completed = false;
    engine.state$.subscribe({
      complete: () => {
        completed = true;
      },
    });
    engine.destroy();
    expect(completed).toBe(true);
  });
});

// ─── createAdaptiveThresholdEngine factory ──────────────────────────────────

describe('createAdaptiveThresholdEngine', () => {
  it('creates instance with defaults', () => {
    const engine = createAdaptiveThresholdEngine();
    expect(engine).toBeInstanceOf(AdaptiveThresholdEngine);
    expect(engine.state.wasmThreshold).toBe(500);
    engine.destroy();
  });

  it('creates instance with custom config', () => {
    const engine = createAdaptiveThresholdEngine({ initialWasmThreshold: 1000 });
    expect(engine.state.wasmThreshold).toBe(1000);
    engine.destroy();
  });
});

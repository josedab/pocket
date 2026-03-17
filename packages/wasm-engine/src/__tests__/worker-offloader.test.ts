/**
 * Tests for WorkerOffloader.
 *
 * Since Web Workers are unavailable in Node test environment,
 * we test: fallback to main-thread engine, threshold gating,
 * events observable, destroy behaviour, and Worker init with mocking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsQueryEngine } from '../js-engine.js';
import type { QueryPlan, WorkerResponse } from '../types.js';
import {
  WorkerOffloader,
  createWorkerOffloader,
  generateWorkerScript,
} from '../worker-offloader.js';

const DOCS = [
  { _id: '1', name: 'Alice', age: 30, role: 'admin', score: 95 },
  { _id: '2', name: 'Bob', age: 25, role: 'user', score: 80 },
  { _id: '3', name: 'Charlie', age: 35, role: 'admin', score: 88 },
];

// ─── Without Worker (Node environment) ──────────────────────────────────────

describe('WorkerOffloader — no Worker available', () => {
  let jsEngine: JsQueryEngine;
  let offloader: WorkerOffloader;

  beforeEach(() => {
    jsEngine = new JsQueryEngine();
    offloader = new WorkerOffloader(jsEngine, 2);
  });

  afterEach(() => {
    offloader.destroy();
  });

  it('isWorkerActive is false without init', () => {
    expect(offloader.isWorkerActive).toBe(false);
  });

  it('initWorker silently fails when Worker is undefined', () => {
    expect(() => offloader.initWorker('some script')).not.toThrow();
    expect(offloader.isWorkerActive).toBe(false);
  });

  it('falls back to main-thread engine for execute', async () => {
    const plan: QueryPlan = { filter: { field: 'role', operator: 'eq', value: 'admin' } };
    const result = await offloader.execute(DOCS, plan);
    expect(result.documents).toHaveLength(2);
    expect(result.engine).toBe('js');
  });

  it('falls back to main-thread engine for aggregate', async () => {
    const result = await offloader.aggregate(DOCS, {
      fields: ['role'],
      aggregates: [{ function: 'count', alias: 'n' }],
    });
    expect(result.groups).toHaveLength(2);
    expect(result.engine).toBe('js');
  });

  it('emits main-thread event on execute fallback', async () => {
    const events: { type: string; durationMs: number }[] = [];
    offloader.events.subscribe((e) => events.push(e));

    await offloader.execute(DOCS, {});
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('main-thread');
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('execute below threshold stays on main thread even with no worker', async () => {
    // threshold=2, dataset=1
    const offloaderHigh = new WorkerOffloader(jsEngine, 100);
    const result = await offloaderHigh.execute(DOCS, {});
    expect(result.documents).toHaveLength(3);
    offloaderHigh.destroy();
  });
});

// ─── With Mocked Worker ─────────────────────────────────────────────────────

describe('WorkerOffloader — with mocked Worker', () => {
  let originalWorker: typeof globalThis.Worker | undefined;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
  });

  afterEach(() => {
    if (originalWorker !== undefined) {
      globalThis.Worker = originalWorker;
    } else {
      // @ts-expect-error - intentional cleanup
      delete globalThis.Worker;
    }
  });

  it('initializes worker when Worker is available', () => {
    const mockTerminate = vi.fn();
    let onmessageHandler: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
    let onerrorHandler: (() => void) | null = null;

    globalThis.Worker = vi.fn().mockImplementation(() => ({
      terminate: mockTerminate,
      set onmessage(handler: (e: MessageEvent<WorkerResponse>) => void) {
        onmessageHandler = handler;
      },
      get onmessage() {
        return onmessageHandler;
      },
      set onerror(handler: () => void) {
        onerrorHandler = handler;
      },
      get onerror() {
        return onerrorHandler;
      },
      postMessage: vi.fn(),
    })) as unknown as typeof Worker;

    // Mock URL.createObjectURL
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');

    const jsEngine = new JsQueryEngine();
    const offloader = new WorkerOffloader(jsEngine, 2);
    offloader.initWorker('test script');

    expect(offloader.isWorkerActive).toBe(true);

    offloader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('posts to worker when above threshold', async () => {
    const postMessageMock = vi.fn();
    let onmessageHandler: ((e: MessageEvent) => void) | null = null;

    globalThis.Worker = vi.fn().mockImplementation(() => ({
      terminate: vi.fn(),
      set onmessage(handler: (e: MessageEvent) => void) {
        onmessageHandler = handler;
      },
      get onmessage() {
        return onmessageHandler;
      },
      set onerror(_h: () => void) {
        /* noop */
      },
      get onerror() {
        return null;
      },
      postMessage(data: unknown) {
        postMessageMock(data);
        // Simulate async response
        setTimeout(() => {
          const req = data as { id: string };
          onmessageHandler?.({
            data: {
              id: req.id,
              type: 'result',
              result: {
                documents: [{ _id: '1', name: 'Alice', age: 30, role: 'admin', score: 95 }],
                totalMatched: 1,
                executionTimeMs: 1,
                engine: 'js',
              },
            },
          } as MessageEvent);
        }, 10);
      },
    })) as unknown as typeof Worker;

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');

    const jsEngine = new JsQueryEngine();
    const offloader = new WorkerOffloader(jsEngine, 2);
    offloader.initWorker('test script');

    const plan: QueryPlan = { filter: { field: 'role', operator: 'eq', value: 'admin' } };
    const resultPromise = offloader.execute(DOCS, plan);
    const result = await resultPromise;

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(result.documents).toHaveLength(1);

    offloader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('handles worker error response', async () => {
    let onmessageHandler: ((e: MessageEvent) => void) | null = null;

    globalThis.Worker = vi.fn().mockImplementation(() => ({
      terminate: vi.fn(),
      set onmessage(handler: (e: MessageEvent) => void) {
        onmessageHandler = handler;
      },
      get onmessage() {
        return onmessageHandler;
      },
      set onerror(_h: () => void) {
        /* noop */
      },
      get onerror() {
        return null;
      },
      postMessage(data: unknown) {
        setTimeout(() => {
          const req = data as { id: string };
          onmessageHandler?.({
            data: {
              id: req.id,
              type: 'error',
              error: 'Something went wrong',
            },
          } as MessageEvent);
        }, 10);
      },
    })) as unknown as typeof Worker;

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');

    const jsEngine = new JsQueryEngine();
    const offloader = new WorkerOffloader(jsEngine, 2);
    offloader.initWorker('test script');

    await expect(offloader.execute(DOCS, {})).rejects.toThrow('Something went wrong');

    offloader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('terminates worker on onerror', () => {
    let onerrorHandler: (() => void) | null = null;
    const mockTerminate = vi.fn();

    globalThis.Worker = vi.fn().mockImplementation(() => ({
      terminate: mockTerminate,
      set onmessage(_h: (e: MessageEvent) => void) {
        /* noop */
      },
      get onmessage() {
        return null;
      },
      set onerror(handler: () => void) {
        onerrorHandler = handler;
      },
      get onerror() {
        return onerrorHandler;
      },
      postMessage: vi.fn(),
    })) as unknown as typeof Worker;

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');

    const jsEngine = new JsQueryEngine();
    const offloader = new WorkerOffloader(jsEngine, 2);
    offloader.initWorker('test script');

    expect(offloader.isWorkerActive).toBe(true);

    // Simulate worker error
    onerrorHandler?.();
    expect(offloader.isWorkerActive).toBe(false);
    expect(mockTerminate).toHaveBeenCalled();

    offloader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('destroy rejects pending requests', async () => {
    let _onmessageHandler: ((e: MessageEvent) => void) | null = null;

    globalThis.Worker = vi.fn().mockImplementation(() => ({
      terminate: vi.fn(),
      set onmessage(handler: (e: MessageEvent) => void) {
        _onmessageHandler = handler;
      },
      get onmessage() {
        return _onmessageHandler;
      },
      set onerror(_h: () => void) {
        /* noop */
      },
      get onerror() {
        return null;
      },
      postMessage: vi.fn(), // Don't respond — simulating pending
    })) as unknown as typeof Worker;

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');

    const jsEngine = new JsQueryEngine();
    const offloader = new WorkerOffloader(jsEngine, 2);
    offloader.initWorker('test script');

    const promise = offloader.execute(DOCS, {});
    offloader.destroy();

    await expect(promise).rejects.toThrow('Worker destroyed');

    URL.createObjectURL = originalCreateObjectURL;
  });
});

// ─── generateWorkerScript ───────────────────────────────────────────────────

describe('generateWorkerScript', () => {
  it('returns a non-empty string', () => {
    const script = generateWorkerScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('contains self.onmessage handler', () => {
    const script = generateWorkerScript();
    expect(script).toContain('self.onmessage');
  });

  it('contains core engine functions', () => {
    const script = generateWorkerScript();
    expect(script).toContain('getField');
    expect(script).toContain('evaluateCondition');
    expect(script).toContain('evaluateFilter');
    expect(script).toContain('executeQuery');
    expect(script).toContain('executeAggregate');
  });

  it('handles all message types', () => {
    const script = generateWorkerScript();
    expect(script).toContain("req.type === 'execute'");
    expect(script).toContain("req.type === 'aggregate'");
    expect(script).toContain("req.type === 'ping'");
  });
});

// ─── createWorkerOffloader factory ──────────────────────────────────────────

describe('createWorkerOffloader', () => {
  it('creates an offloader instance', () => {
    const jsEngine = new JsQueryEngine();
    const offloader = createWorkerOffloader(jsEngine);
    expect(offloader).toBeInstanceOf(WorkerOffloader);
    expect(offloader.isWorkerActive).toBe(false);
    offloader.destroy();
  });

  it('accepts custom threshold', () => {
    const jsEngine = new JsQueryEngine();
    const offloader = createWorkerOffloader(jsEngine, 500);
    expect(offloader).toBeInstanceOf(WorkerOffloader);
    offloader.destroy();
  });
});

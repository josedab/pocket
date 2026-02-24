/**
 * Web Worker offloading for query execution.
 *
 * Transparently moves heavy query evaluation off the main thread by
 * posting work to a dedicated Worker and returning a Promise.
 */

import { Subject } from 'rxjs';
import type {
  AggregateResult,
  FilterCondition,
  FilterGroup,
  GroupByClause,
  QueryEngine,
  QueryPlan,
  QueryResult,
  WorkerRequest,
  WorkerResponse,
} from './types.js';

let requestCounter = 0;

function nextId(): string {
  return `wq-${++requestCounter}-${Date.now()}`;
}

/**
 * Wraps a QueryEngine and offloads execution to a Web Worker when the
 * document count exceeds `threshold`.
 *
 * Falls back to main-thread execution for small datasets or when
 * Workers are unavailable.
 */
export class WorkerOffloader {
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private worker: Worker | null = null;
  private readonly events$ = new Subject<{
    type: 'offloaded' | 'main-thread';
    durationMs: number;
  }>();

  constructor(
    private readonly engine: QueryEngine,
    private readonly threshold = 10_000
  ) {}

  /** Observable of offloading decisions for monitoring. */
  get events() {
    return this.events$.asObservable();
  }

  /** Initialize the worker from a blob URL. */
  initWorker(workerScript: string): void {
    if (typeof Worker === 'undefined') return;
    try {
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const handler = this.pending.get(response.id);
        if (!handler) return;
        this.pending.delete(response.id);

        if (response.type === 'error') {
          handler.reject(new Error(response.error ?? 'Worker query failed'));
        } else {
          handler.resolve(response.result);
        }
      };
      this.worker.onerror = () => {
        this.terminateWorker();
      };
    } catch {
      this.worker = null;
    }
  }

  /** Execute query, offloading to worker if above threshold. */
  async execute<T extends Record<string, unknown>>(
    documents: readonly T[],
    plan: QueryPlan
  ): Promise<QueryResult<T>> {
    if (this.worker && documents.length >= this.threshold) {
      return this.postToWorker<QueryResult<T>>({
        id: nextId(),
        type: 'execute',
        documents: documents as readonly Record<string, unknown>[],
        plan,
      });
    }

    const start = performance.now();
    const result = this.engine.execute(documents, plan);
    this.events$.next({
      type: 'main-thread',
      durationMs: performance.now() - start,
    });
    return result;
  }

  /** Aggregate query, offloading to worker if above threshold. */
  async aggregate(
    documents: readonly Record<string, unknown>[],
    groupBy: GroupByClause,
    filter?: FilterCondition | FilterGroup
  ): Promise<AggregateResult> {
    if (this.worker && documents.length >= this.threshold) {
      return this.postToWorker<AggregateResult>({
        id: nextId(),
        type: 'aggregate',
        documents,
        groupBy,
        filter,
      });
    }

    return this.engine.aggregate(documents, groupBy, filter);
  }

  /** Whether the worker is active. */
  get isWorkerActive(): boolean {
    return this.worker !== null;
  }

  /** Terminate the worker and clean up. */
  destroy(): void {
    this.terminateWorker();
    this.events$.complete();
    for (const [, handler] of this.pending) {
      handler.reject(new Error('Worker destroyed'));
    }
    this.pending.clear();
  }

  private postToWorker<R>(request: WorkerRequest): Promise<R> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.worker!.postMessage(request);

      const start = performance.now();
      const originalResolve = resolve;
      // Wrap to emit event
      this.pending.set(request.id, {
        resolve: (v: unknown) => {
          this.events$.next({
            type: 'offloaded',
            durationMs: performance.now() - start,
          });
          (originalResolve as (v: unknown) => void)(v);
        },
        reject,
      });
    });
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/**
 * Generate the inline worker script that runs the JS engine in a Worker.
 *
 * The worker receives `WorkerRequest` messages and responds with
 * `WorkerResponse` messages, using a self-contained copy of the
 * JS query engine logic.
 */
export function generateWorkerScript(): string {
  // The worker script is self-contained with the core evaluation logic
  return `
'use strict';

function getField(doc, path) {
  const parts = path.split('.');
  let current = doc;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateCondition(doc, cond) {
  const v = getField(doc, cond.field);
  const t = cond.value;
  switch (cond.operator) {
    case 'eq': return v === t;
    case 'ne': return v !== t;
    case 'gt': return v > t;
    case 'gte': return v >= t;
    case 'lt': return v < t;
    case 'lte': return v <= t;
    case 'in': return Array.isArray(t) && t.includes(v);
    case 'nin': return Array.isArray(t) && !t.includes(v);
    case 'contains': return typeof v === 'string' && v.includes(t);
    case 'startsWith': return typeof v === 'string' && v.startsWith(t);
    case 'endsWith': return typeof v === 'string' && v.endsWith(t);
    case 'exists': return t ? v !== undefined : v === undefined;
    case 'regex': return typeof v === 'string' && new RegExp(t).test(v);
    default: return false;
  }
}

function evaluateFilter(doc, filter) {
  if ('logic' in filter) {
    return filter.logic === 'and'
      ? filter.conditions.every(c => evaluateFilter(doc, c))
      : filter.conditions.some(c => evaluateFilter(doc, c));
  }
  return evaluateCondition(doc, filter);
}

function compareValues(a, b, dir) {
  if (a === b) return 0;
  if (a == null) return dir === 'asc' ? -1 : 1;
  if (b == null) return dir === 'asc' ? 1 : -1;
  const r = typeof a === 'string' ? a.localeCompare(b) : (a < b ? -1 : 1);
  return dir === 'desc' ? -r : r;
}

function executeQuery(documents, plan) {
  const start = performance.now();
  let results = plan.filter
    ? documents.filter(d => evaluateFilter(d, plan.filter))
    : [...documents];
  const totalMatched = results.length;
  if (plan.sort && plan.sort.length) {
    results.sort((a, b) => {
      for (const s of plan.sort) {
        const c = compareValues(getField(a, s.field), getField(b, s.field), s.direction);
        if (c !== 0) return c;
      }
      return 0;
    });
  }
  if (plan.skip > 0) results = results.slice(plan.skip);
  if (plan.limit >= 0) results = results.slice(0, plan.limit);
  return { documents: results, totalMatched, executionTimeMs: performance.now() - start, engine: 'js' };
}

function executeAggregate(documents, groupBy, filter) {
  const start = performance.now();
  const filtered = filter ? documents.filter(d => evaluateFilter(d, filter)) : documents;
  const groups = new Map();
  for (const doc of filtered) {
    const key = groupBy.fields.map(f => JSON.stringify(getField(doc, f))).join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  const result = [];
  for (const [, docs] of groups) {
    const row = {};
    for (const f of groupBy.fields) row[f] = getField(docs[0], f);
    for (const agg of groupBy.aggregates) {
      const vals = agg.field ? docs.map(d => getField(d, agg.field)) : docs;
      const nums = vals.filter(v => typeof v === 'number');
      switch (agg.function) {
        case 'count': row[agg.alias] = vals.length; break;
        case 'sum': row[agg.alias] = nums.reduce((s, n) => s + n, 0); break;
        case 'avg': row[agg.alias] = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0; break;
        case 'min': row[agg.alias] = nums.length ? Math.min(...nums) : null; break;
        case 'max': row[agg.alias] = nums.length ? Math.max(...nums) : null; break;
      }
    }
    result.push(row);
  }
  return { groups: result, executionTimeMs: performance.now() - start, engine: 'js' };
}

self.onmessage = function(e) {
  const req = e.data;
  try {
    if (req.type === 'execute') {
      const result = executeQuery(req.documents, req.plan);
      self.postMessage({ id: req.id, type: 'result', result });
    } else if (req.type === 'aggregate') {
      const result = executeAggregate(req.documents, req.groupBy, req.filter);
      self.postMessage({ id: req.id, type: 'result', result });
    } else if (req.type === 'ping') {
      self.postMessage({ id: req.id, type: 'result', result: { ok: true } });
    }
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', error: String(err) });
  }
};
`;
}

export function createWorkerOffloader(engine: QueryEngine, threshold?: number): WorkerOffloader {
  return new WorkerOffloader(engine, threshold);
}

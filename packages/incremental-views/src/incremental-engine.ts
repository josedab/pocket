/**
 * Incremental compute engine with delta propagation for materialized views.
 */
import { BehaviorSubject, Subject, type Observable, type Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import type { DslViewAggregation, ViewDefinitionConfig, ViewFilter } from './view-dsl.js';

export interface DeltaChange<T = Record<string, unknown>> {
  type: 'insert' | 'update' | 'delete';
  collection: string;
  documentId: string;
  before?: T;
  after?: T;
  timestamp: number;
}

export interface IncrementalViewResult<R = Record<string, unknown>> {
  rows: R[];
  metadata: {
    viewName: string;
    lastUpdated: number;
    rowCount: number;
    computeTimeMs: number;
  };
}

export interface IncrementalEngineConfig {
  maxCacheSize?: number;
}

/**
 * Engine that incrementally recomputes materialized views on delta changes.
 */
export class IncrementalEngine {
  private readonly views = new Map<
    string,
    {
      definition: ViewDefinitionConfig;
      data: Map<string, Record<string, unknown>>;
      aggregateCache: Map<string, Record<string, unknown>>;
      result$: BehaviorSubject<IncrementalViewResult>;
    }
  >();
  private readonly changes$ = new Subject<DeltaChange>();
  private readonly subscriptions = new Map<string, Subscription>();

  /* config reserved for future use */

  /** Register a view definition */
  registerView(definition: ViewDefinitionConfig): void {
    if (this.views.has(definition.name)) {
      throw new Error(`View "${definition.name}" is already registered`);
    }

    const result$ = new BehaviorSubject<IncrementalViewResult>({
      rows: [],
      metadata: {
        viewName: definition.name,
        lastUpdated: Date.now(),
        rowCount: 0,
        computeTimeMs: 0,
      },
    });

    this.views.set(definition.name, {
      definition,
      data: new Map(),
      aggregateCache: new Map(),
      result$,
    });

    // Set up change listener based on refresh strategy
    const changeSource$ = this.changes$
      .pipe
      // Only process changes relevant to this view's source
      ();

    let sub: Subscription;
    switch (definition.refreshStrategy) {
      case 'debounced':
        sub = changeSource$
          .pipe(debounceTime(definition.debounceMs ?? 100))
          .subscribe((change) => this.processChange(definition.name, change));
        break;
      case 'immediate':
        sub = changeSource$.subscribe((change) => this.processChange(definition.name, change));
        break;
      case 'interval':
        // For interval, we process immediately but debounce the recompute
        sub = changeSource$
          .pipe(debounceTime(definition.refreshInterval ?? 5000))
          .subscribe((change) => this.processChange(definition.name, change));
        break;
      case 'manual':
        // No auto-processing
        sub = changeSource$.subscribe(() => {
          /* stored for manual refresh */
        });
        break;
      default:
        sub = changeSource$.subscribe((change) => this.processChange(definition.name, change));
    }

    this.subscriptions.set(definition.name, sub);
  }

  /** Push a change event into the engine */
  pushChange(change: DeltaChange): void {
    this.changes$.next(change);
    // For immediate views, process directly
    for (const [name, view] of this.views) {
      if (
        view.definition.refreshStrategy === 'immediate' &&
        change.collection === view.definition.source
      ) {
        this.processChange(name, change);
      }
    }
  }

  /** Process a single change against a view */
  private processChange(viewName: string, change: DeltaChange): void {
    const view = this.views.get(viewName);
    if (!view) return;
    if (change.collection !== view.definition.source) return;

    const start = Date.now();
    const { definition, data } = view;

    switch (change.type) {
      case 'insert':
        if (change.after && this.matchesFilters(change.after, definition.filters)) {
          data.set(change.documentId, change.after);
        }
        break;
      case 'update':
        if (change.after && this.matchesFilters(change.after, definition.filters)) {
          data.set(change.documentId, change.after);
        } else {
          data.delete(change.documentId);
        }
        break;
      case 'delete':
        data.delete(change.documentId);
        break;
    }

    this.recomputeResult(viewName, Date.now() - start);
  }

  /** Full recompute of a view's result */
  private recomputeResult(viewName: string, computeTimeMs: number): void {
    const view = this.views.get(viewName);
    if (!view) return;

    const { definition, data } = view;
    let rows = Array.from(data.values());

    // Apply column selection
    if (definition.columns.length > 0) {
      rows = rows.map((row) => {
        const selected: Record<string, unknown> = {};
        for (const col of definition.columns) {
          const key = col.alias ?? col.name;
          selected[key] = row[col.name];
        }
        return selected;
      });
    }

    // Apply aggregations and groupBy
    if (definition.aggregations.length > 0) {
      rows = this.computeAggregations(rows, definition.aggregations, definition.groupBy);
    }

    // Apply sort
    if (definition.sort.length > 0) {
      rows.sort((a, b) => {
        for (const sort of definition.sort) {
          const aVal = a[sort.field] as string | number;
          const bVal = b[sort.field] as string | number;
          if (aVal === bVal) continue;
          const cmp = aVal < bVal ? -1 : 1;
          return sort.direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    // Apply limit
    if (definition.limit) {
      rows = rows.slice(0, definition.limit);
    }

    view.result$.next({
      rows,
      metadata: {
        viewName,
        lastUpdated: Date.now(),
        rowCount: rows.length,
        computeTimeMs,
      },
    });
  }

  /** Compute aggregations over rows */
  private computeAggregations(
    rows: Record<string, unknown>[],
    aggregations: DslViewAggregation[],
    groupBy: { fields: string[] } | null
  ): Record<string, unknown>[] {
    if (!groupBy || groupBy.fields.length === 0) {
      // Single aggregate over all rows
      const result: Record<string, unknown> = {};
      for (const agg of aggregations) {
        result[agg.alias] = this.computeSingleAggregate(rows, agg);
      }
      return [result];
    }

    // Group rows
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = groupBy.fields.map((f) => String(row[f] ?? '')).join('::');
      const group = groups.get(key);
      if (!group) {
        groups.set(key, [row]);
      } else {
        group.push(row);
      }
    }

    // Compute aggregates per group
    const results: Record<string, unknown>[] = [];
    for (const [, groupRows] of groups) {
      const result: Record<string, unknown> = {};
      // Include group-by fields
      if (groupRows.length > 0) {
        const firstRow = groupRows[0]!;
        for (const field of groupBy.fields) {
          result[field] = firstRow[field];
        }
      }
      // Compute aggregates
      for (const agg of aggregations) {
        result[agg.alias] = this.computeSingleAggregate(groupRows, agg);
      }
      results.push(result);
    }

    return results;
  }

  private computeSingleAggregate(
    rows: Record<string, unknown>[],
    agg: DslViewAggregation
  ): unknown {
    if (agg.op === 'count') return rows.length;

    const values = rows.map((r) => r[agg.field]).filter((v): v is number => typeof v === 'number');

    if (values.length === 0) return null;

    switch (agg.op) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      default:
        return null;
    }
  }

  /** Check if a document matches view filters */
  private matchesFilters(doc: Record<string, unknown>, filters: ViewFilter[]): boolean {
    for (const f of filters) {
      const val = doc[f.field];
      switch (f.operator) {
        case '$eq':
          if (val !== f.value) return false;
          break;
        case '$ne':
          if (val === f.value) return false;
          break;
        case '$gt':
          if (typeof val !== 'number' || val <= (f.value as number)) return false;
          break;
        case '$gte':
          if (typeof val !== 'number' || val < (f.value as number)) return false;
          break;
        case '$lt':
          if (typeof val !== 'number' || val >= (f.value as number)) return false;
          break;
        case '$lte':
          if (typeof val !== 'number' || val > (f.value as number)) return false;
          break;
        case '$in':
          if (!Array.isArray(f.value) || !f.value.includes(val)) return false;
          break;
        case '$nin':
          if (Array.isArray(f.value) && f.value.includes(val)) return false;
          break;
        case '$regex':
          if (typeof val !== 'string' || !new RegExp(f.value as string).test(val)) return false;
          break;
      }
    }
    return true;
  }

  /** Get the reactive result observable for a view */
  view$<R = Record<string, unknown>>(viewName: string): Observable<IncrementalViewResult<R>> {
    const view = this.views.get(viewName);
    if (!view) throw new Error(`View "${viewName}" not found`);
    return view.result$.asObservable() as Observable<IncrementalViewResult<R>>;
  }

  /** Get current view result */
  getView<R = Record<string, unknown>>(viewName: string): IncrementalViewResult<R> | null {
    const view = this.views.get(viewName);
    return view ? (view.result$.value as IncrementalViewResult<R>) : null;
  }

  /** Manually refresh a view (full recompute) */
  refresh(viewName: string): void {
    this.recomputeResult(viewName, 0);
  }

  /** Remove a view */
  removeView(viewName: string): void {
    const sub = this.subscriptions.get(viewName);
    sub?.unsubscribe();
    this.subscriptions.delete(viewName);

    const view = this.views.get(viewName);
    view?.result$.complete();
    this.views.delete(viewName);
  }

  /** Get all registered view names */
  getViewNames(): string[] {
    return Array.from(this.views.keys());
  }

  /** Destroy the engine */
  destroy(): void {
    for (const name of Array.from(this.views.keys())) {
      this.removeView(name);
    }
    this.changes$.complete();
  }
}

export function createIncrementalEngine(_config?: IncrementalEngineConfig): IncrementalEngine {
  return new IncrementalEngine();
}

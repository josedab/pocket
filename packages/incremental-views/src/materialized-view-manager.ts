/**
 * @module @pocket/incremental-views/materialized-view-manager
 *
 * High-level manager for named materialized views with incremental
 * aggregation support. Views automatically update when source documents
 * change and expose subscribable Observable streams.
 *
 * @example
 * ```typescript
 * const manager = createMaterializedViewManager({ maxViews: 10 });
 * manager.createView('order-stats', {
 *   collection: 'orders',
 *   aggregation: { function: 'sum', field: 'amount' },
 * });
 * manager.handleChange('orders', '1', 'create', { amount: 100 });
 * ```
 */
import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewManagerConfig {
  maxViews?: number;
  cacheSize?: number;
  enablePersistence?: boolean;
}

export interface ViewAggregation {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;
}

export interface ViewDefinition {
  collection: string;
  filter?: (doc: Record<string, unknown>) => boolean;
  aggregation?: ViewAggregation;
  sort?: { field: string; order: 'asc' | 'desc' };
  groupBy?: string;
}

export interface ViewResult {
  rows: Record<string, unknown>[];
  aggregation?: number | Record<string, number>;
  updatedAt: number;
}

export interface ViewManagerStats {
  totalViews: number;
  totalChangesProcessed: number;
  totalRefreshes: number;
}

export interface ManagedView {
  readonly name: string;
  readonly result$: Observable<ViewResult>;
  refresh(): void;
  getSnapshot(): ViewResult;
}

// ---------------------------------------------------------------------------
// Internal entry
// ---------------------------------------------------------------------------

interface ViewEntry {
  definition: ViewDefinition;
  documents: Map<string, Record<string, unknown>>;
  subject: BehaviorSubject<ViewResult>;
  changeCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeAggregation(
  docs: Record<string, unknown>[],
  aggregation: ViewAggregation,
  groupBy?: string,
): number | Record<string, number> {
  if (groupBy) {
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const doc of docs) {
      const key = String(doc[groupBy] ?? '_ungrouped');
      (groups[key] ??= []).push(doc);
    }
    const result: Record<string, number> = {};
    for (const [key, groupDocs] of Object.entries(groups)) {
      result[key] = computeScalar(groupDocs, aggregation);
    }
    return result;
  }
  return computeScalar(docs, aggregation);
}

function computeScalar(
  docs: Record<string, unknown>[],
  agg: ViewAggregation,
): number {
  if (agg.function === 'count') return docs.length;

  const field = agg.field;
  if (!field) return 0;
  const values = docs
    .map((d) => d[field])
    .filter((v): v is number => typeof v === 'number');

  switch (agg.function) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'min':
      return values.length > 0 ? Math.min(...values) : 0;
    case 'max':
      return values.length > 0 ? Math.max(...values) : 0;
  }
}

function recompute(entry: ViewEntry): ViewResult {
  let docs = Array.from(entry.documents.values());

  if (entry.definition.filter) {
    docs = docs.filter(entry.definition.filter);
  }

  if (entry.definition.sort) {
    const { field, order } = entry.definition.sort;
    docs.sort((a, b) => {
      const aVal = a[field] as number | string;
      const bVal = b[field] as number | string;
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const result: ViewResult = {
    rows: docs,
    updatedAt: Date.now(),
  };

  if (entry.definition.aggregation) {
    result.aggregation = computeAggregation(
      docs,
      entry.definition.aggregation,
      entry.definition.groupBy,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface MaterializedViewManager {
  createView(name: string, definition: ViewDefinition): ManagedView;
  dropView(name: string): void;
  getView(name: string): ManagedView | undefined;
  getViewNames(): string[];
  handleChange(
    collection: string,
    docId: string,
    changeType: 'create' | 'update' | 'delete',
    data?: Record<string, unknown>,
  ): void;
  refreshAll(): void;
  getStats(): ViewManagerStats;
  destroy(): void;
}

/** Creates a high-level manager for named materialized views */
export function createMaterializedViewManager(
  config: ViewManagerConfig = {},
): MaterializedViewManager {
  const views = new Map<string, ViewEntry>();
  let totalChanges = 0;
  let totalRefreshes = 0;

  function emptyResult(): ViewResult {
    return { rows: [], updatedAt: Date.now() };
  }

  function createManagedView(name: string, entry: ViewEntry): ManagedView {
    return {
      name,
      result$: entry.subject.asObservable(),
      refresh() {
        const result = recompute(entry);
        entry.subject.next(result);
        totalRefreshes++;
      },
      getSnapshot() {
        return entry.subject.getValue();
      },
    };
  }

  function createView(name: string, definition: ViewDefinition): ManagedView {
    if (views.has(name)) {
      throw new Error(`View "${name}" already exists`);
    }
    if (config.maxViews && views.size >= config.maxViews) {
      throw new Error(`Maximum number of views (${config.maxViews}) reached`);
    }

    const subject = new BehaviorSubject<ViewResult>(emptyResult());
    const entry: ViewEntry = {
      definition,
      documents: new Map(),
      subject,
      changeCount: 0,
    };
    views.set(name, entry);
    return createManagedView(name, entry);
  }

  function dropView(name: string): void {
    const entry = views.get(name);
    if (entry) {
      entry.subject.complete();
      views.delete(name);
    }
  }

  function getView(name: string): ManagedView | undefined {
    const entry = views.get(name);
    if (!entry) return undefined;
    return createManagedView(name, entry);
  }

  function getViewNames(): string[] {
    return Array.from(views.keys());
  }

  function handleChange(
    collection: string,
    docId: string,
    changeType: 'create' | 'update' | 'delete',
    data?: Record<string, unknown>,
  ): void {
    for (const [, entry] of views) {
      if (entry.definition.collection !== collection) continue;

      switch (changeType) {
        case 'create':
        case 'update':
          if (data) {
            entry.documents.set(docId, data);
          }
          break;
        case 'delete':
          entry.documents.delete(docId);
          break;
      }

      entry.changeCount++;
      totalChanges++;

      const result = recompute(entry);
      entry.subject.next(result);
    }
  }

  function refreshAll(): void {
    for (const [, entry] of views) {
      const result = recompute(entry);
      entry.subject.next(result);
      totalRefreshes++;
    }
  }

  function getStats(): ViewManagerStats {
    return {
      totalViews: views.size,
      totalChangesProcessed: totalChanges,
      totalRefreshes,
    };
  }

  function destroy(): void {
    for (const [, entry] of views) {
      entry.subject.complete();
    }
    views.clear();
    totalChanges = 0;
    totalRefreshes = 0;
  }

  return {
    createView,
    dropView,
    getView,
    getViewNames,
    handleChange,
    refreshAll,
    getStats,
    destroy,
  };
}

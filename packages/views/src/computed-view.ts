/**
 * ComputedView — Declarative derived views with aggregation transforms.
 *
 * Extends MaterializedView with transform pipelines: group-by, aggregation,
 * and custom reduce functions. Auto-updates incrementally when source data changes.
 *
 * @example
 * ```typescript
 * import { ComputedView } from '@pocket/views';
 *
 * // Aggregate orders by status
 * const statusView = new ComputedView({
 *   name: 'order-status-summary',
 *   collection: 'orders',
 *   groupBy: 'status',
 *   aggregations: {
 *     count: { type: 'count' },
 *     totalAmount: { type: 'sum', field: 'amount' },
 *     avgAmount: { type: 'avg', field: 'amount' },
 *   },
 * });
 *
 * statusView.initialize(allOrders);
 * // Result: [{ _key: 'pending', count: 15, totalAmount: 450, avgAmount: 30 }, ...]
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface ComputedViewDefinition {
  /** Unique name */
  name: string;
  /** Source collection */
  collection: string;
  /** Optional pre-filter applied before aggregation */
  filter?: Record<string, unknown>;
  /** Field to group by (null for full-collection aggregation) */
  groupBy?: string;
  /** Aggregation definitions */
  aggregations: Record<string, AggregationSpec>;
}

export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last';

export interface AggregationSpec {
  type: AggregationType;
  /** Field to aggregate (not required for 'count') */
  field?: string;
}

export interface ComputedRow {
  _key: unknown;
  [field: string]: unknown;
}

export interface ComputedViewStats {
  name: string;
  collection: string;
  groupCount: number;
  sourceDocCount: number;
  lastComputedAt: number;
  computeTimeMs: number;
}

// ── Implementation ────────────────────────────────────────

export class ComputedView {
  private readonly definition: ComputedViewDefinition;
  private readonly resultsSubject: BehaviorSubject<ComputedRow[]>;
  private readonly destroy$ = new Subject<void>();

  private sourceDocCount = 0;
  private lastComputeTimeMs = 0;
  private lastComputedAt = 0;

  // Raw grouped data for incremental updates
  private groups = new Map<unknown, Record<string, unknown>[]>();

  /** Observable of computed results. */
  readonly results$: Observable<ComputedRow[]>;

  constructor(definition: ComputedViewDefinition) {
    this.definition = definition;
    this.resultsSubject = new BehaviorSubject<ComputedRow[]>([]);
    this.results$ = this.resultsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Get current computed results. */
  get results(): ComputedRow[] {
    return this.resultsSubject.getValue();
  }

  /** Get view definition. */
  getDefinition(): ComputedViewDefinition {
    return this.definition;
  }

  /**
   * Initialize from a full collection of documents.
   */
  initialize(docs: Record<string, unknown>[]): void {
    const start = performance.now();

    const filtered = this.definition.filter
      ? docs.filter((doc) => this.matchesFilter(doc, this.definition.filter!))
      : docs;

    this.sourceDocCount = filtered.length;
    this.groups.clear();

    // Group documents
    const groupField = this.definition.groupBy;
    if (groupField) {
      for (const doc of filtered) {
        const key = doc[groupField];
        const group = this.groups.get(key);
        if (group) {
          group.push(doc);
        } else {
          this.groups.set(key, [doc]);
        }
      }
    } else {
      this.groups.set('__all__', filtered);
    }

    // Compute aggregations
    this.recompute();
    this.lastComputeTimeMs = performance.now() - start;
    this.lastComputedAt = Date.now();
  }

  /**
   * Apply an incremental change.
   * Returns true if the computed results changed.
   */
  applyChange(change: {
    operation: 'insert' | 'update' | 'delete';
    document: Record<string, unknown> | null;
    previousDocument?: Record<string, unknown>;
    documentId: string;
  }): boolean {
    const { operation, document, previousDocument } = change;
    const groupField = this.definition.groupBy;

    let changed = false;

    // Handle removal from old group
    if ((operation === 'delete' || operation === 'update') && previousDocument) {
      const matchesOld =
        !this.definition.filter || this.matchesFilter(previousDocument, this.definition.filter);
      if (matchesOld) {
        const oldKey = groupField ? previousDocument[groupField] : '__all__';
        const group = this.groups.get(oldKey);
        if (group) {
          const idx = group.findIndex((d) => d._id === change.documentId);
          if (idx !== -1) {
            group.splice(idx, 1);
            if (group.length === 0) {
              this.groups.delete(oldKey);
            }
            changed = true;
          }
        }
      }
    }

    // Handle addition to new group
    if ((operation === 'insert' || operation === 'update') && document) {
      const matchesNew =
        !this.definition.filter || this.matchesFilter(document, this.definition.filter);
      if (matchesNew) {
        const newKey = groupField ? document[groupField] : '__all__';
        const group = this.groups.get(newKey);
        if (group) {
          group.push(document);
        } else {
          this.groups.set(newKey, [document]);
        }
        changed = true;
      }
    }

    if (changed) {
      this.sourceDocCount = Array.from(this.groups.values()).reduce((sum, g) => sum + g.length, 0);
      this.recompute();
    }

    return changed;
  }

  /**
   * Get view statistics.
   */
  getStats(): ComputedViewStats {
    return {
      name: this.definition.name,
      collection: this.definition.collection,
      groupCount: this.groups.size,
      sourceDocCount: this.sourceDocCount,
      lastComputedAt: this.lastComputedAt,
      computeTimeMs: this.lastComputeTimeMs,
    };
  }

  /**
   * Dispose the view and release resources.
   */
  dispose(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resultsSubject.complete();
    this.groups.clear();
  }

  // ── Private ────────────────────────────────────────────

  private recompute(): void {
    const rows: ComputedRow[] = [];

    for (const [key, docs] of this.groups) {
      const row: ComputedRow = { _key: key === '__all__' ? null : key };

      for (const [aggName, spec] of Object.entries(this.definition.aggregations)) {
        row[aggName] = this.computeAggregation(docs, spec);
      }

      rows.push(row);
    }

    this.resultsSubject.next(rows);
  }

  private computeAggregation(docs: Record<string, unknown>[], spec: AggregationSpec): unknown {
    switch (spec.type) {
      case 'count':
        return docs.length;

      case 'sum': {
        if (!spec.field) return 0;
        let sum = 0;
        for (const doc of docs) {
          const val = doc[spec.field];
          if (typeof val === 'number') sum += val;
        }
        return sum;
      }

      case 'avg': {
        if (!spec.field) return 0;
        let sum = 0;
        let count = 0;
        for (const doc of docs) {
          const val = doc[spec.field];
          if (typeof val === 'number') {
            sum += val;
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      }

      case 'min': {
        if (!spec.field) return null;
        let min: number | null = null;
        for (const doc of docs) {
          const val = doc[spec.field];
          if (typeof val === 'number' && (min === null || val < min)) {
            min = val;
          }
        }
        return min;
      }

      case 'max': {
        if (!spec.field) return null;
        let max: number | null = null;
        for (const doc of docs) {
          const val = doc[spec.field];
          if (typeof val === 'number' && (max === null || val > max)) {
            max = val;
          }
        }
        return max;
      }

      case 'first':
        if (!spec.field || docs.length === 0) return null;
        return docs[0]![spec.field] ?? null;

      case 'last':
        if (!spec.field || docs.length === 0) return null;
        return docs[docs.length - 1]![spec.field] ?? null;

      default:
        return null;
    }
  }

  private matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (doc[key] !== value) return false;
    }
    return true;
  }
}

/**
 * Create a computed view.
 */
export function createComputedView(definition: ComputedViewDefinition): ComputedView {
  return new ComputedView(definition);
}

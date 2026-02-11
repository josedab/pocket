/**
 * @module @pocket/incremental-views/live-view
 *
 * Live materialized views that integrate with RxJS observables.
 * Views automatically update when source data changes and expose
 * subscribable Observable streams.
 *
 * @example
 * ```typescript
 * const live = createLiveView<Todo, TodoStats>({
 *   name: 'todo-stats',
 *   sourceCollection: 'todos',
 *   aggregate: { count: true, sum: 'priority', avg: 'priority' },
 *   groupBy: 'status',
 * });
 *
 * live.value$.subscribe(stats => console.log(stats));
 * live.processChange({ type: 'insert', document: todo, collection: 'todos' });
 * ```
 */
import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import type { AggregateOp, ChangeEvent } from './types.js';

export interface LiveViewConfig {
  name: string;
  sourceCollection: string;
  aggregate: Record<string, AggregateOp | true>;
  groupBy?: string;
  filter?: (doc: Record<string, unknown>) => boolean;
}

export type GroupedResult = Record<string, AggregateResult>;

export interface AggregateResult {
  count: number;
  [field: string]: number;
}

export interface LiveView {
  readonly name: string;
  readonly value$: Observable<AggregateResult | GroupedResult>;
  getValue(): AggregateResult | GroupedResult;
  processChange(event: ChangeEvent<Record<string, unknown>>): void;
  refresh(): void;
  destroy(): void;
}

export function createLiveView(config: LiveViewConfig): LiveView {
  const documents = new Map<string, Record<string, unknown>>();
  const subject = new BehaviorSubject<AggregateResult | GroupedResult>(
    config.groupBy ? {} : { count: 0 }
  );

  function getDocId(doc: Record<string, unknown>): string {
    return (doc._id as string) ?? (doc.id as string) ?? String(Date.now());
  }

  function computeAggregate(docs: Record<string, unknown>[]): AggregateResult {
    const result: AggregateResult = { count: docs.length };

    for (const [key, op] of Object.entries(config.aggregate)) {
      const operation = op === true ? 'count' : op;
      if (operation === 'count') {
        result[key === 'count' ? 'count' : `${key}_count`] = docs.length;
        continue;
      }

      const values = docs.map((d) => d[key]).filter((v): v is number => typeof v === 'number');

      switch (operation) {
        case 'sum':
          result[`${key}_sum`] = values.reduce((a, b) => a + b, 0);
          break;
        case 'avg':
          result[`${key}_avg`] =
            values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          break;
        case 'min':
          result[`${key}_min`] = values.length > 0 ? Math.min(...values) : 0;
          break;
        case 'max':
          result[`${key}_max`] = values.length > 0 ? Math.max(...values) : 0;
          break;
        case 'distinct_count':
          result[`${key}_distinct`] = new Set(values).size;
          break;
      }
    }

    return result;
  }

  function recompute(): void {
    let docs = Array.from(documents.values());

    if (config.filter) {
      docs = docs.filter(config.filter);
    }

    if (config.groupBy) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const doc of docs) {
        const groupValue = String(doc[config.groupBy] ?? '_ungrouped');
        const group = groups.get(groupValue) ?? [];
        group.push(doc);
        groups.set(groupValue, group);
      }

      const result: GroupedResult = {};
      for (const [key, groupDocs] of groups) {
        result[key] = computeAggregate(groupDocs);
      }
      subject.next(result);
    } else {
      subject.next(computeAggregate(docs));
    }
  }

  function processChange(event: ChangeEvent<Record<string, unknown>>): void {
    if (event.collection !== config.sourceCollection) return;

    const docId = getDocId(event.document);

    switch (event.type) {
      case 'insert':
        documents.set(docId, event.document);
        break;
      case 'update':
        documents.set(docId, event.document);
        break;
      case 'delete':
        documents.delete(docId);
        break;
    }

    recompute();
  }

  function destroy(): void {
    documents.clear();
    subject.complete();
  }

  return {
    name: config.name,
    value$: subject.asObservable(),
    getValue: () => subject.getValue(),
    processChange,
    refresh: recompute,
    destroy,
  };
}

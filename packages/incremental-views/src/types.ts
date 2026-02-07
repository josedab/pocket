import type { Observable } from 'rxjs';

/** Supported aggregate operations */
export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct_count';

/** Defines how a materialized view is computed from source data */
export interface ViewDefinition<T, R> {
  name: string;
  sourceCollection: string;
  mapFn: (documents: T[]) => R;
  reduceFn?: (accumulated: R, current: R) => R;
  filter?: (document: T) => boolean;
  groupBy?: keyof T & string;
}

/** A materialized view with reactive value access */
export interface MaterializedView<R> {
  name: string;
  value$: Observable<R>;
  getValue(): R;
  refresh(): void;
  destroy(): void;
}

/** An incremental aggregation with reactive value access */
export interface IncrementalAggregation<_T> {
  field: string;
  operation: AggregateOp;
  value$: Observable<number>;
}

/** Describes a change to source data */
export interface ChangeEvent<T> {
  type: 'insert' | 'update' | 'delete';
  document: T;
  previousDocument?: T;
  collection: string;
}

/** Snapshot of a view's current state */
export interface ViewState<R> {
  value: R;
  lastUpdatedAt: number;
  changeCount: number;
  isStale: boolean;
}

/** Configuration for the view manager */
export interface ViewManagerConfig {
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
  maxViews?: number;
  persistState?: boolean;
}

/** Tracks dependencies between views and source collections */
export interface DependencyGraph {
  nodes: Map<string, string[]>;
  hasCycle(): boolean;
}

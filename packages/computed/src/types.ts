/**
 * @pocket/computed — Types for reactive computed collections.
 *
 * @module @pocket/computed
 */

import type { Observable } from 'rxjs';

// ── Core Types ────────────────────────────────────────────

export type DocumentMap = Map<string, Record<string, unknown>>;

export interface SourceCollection {
  name: string;
  documents$: Observable<Record<string, unknown>[]>;
  getAll(): Record<string, unknown>[];
}

export interface ComputedCollectionConfig<T = Record<string, unknown>> {
  /** Unique name for this computed collection */
  name: string;
  /** Source collection names this depends on */
  sources: string[];
  /** Compute function that derives the output */
  compute: ComputeFunction<T>;
  /** Enable incremental recomputation (default: true) */
  incremental?: boolean;
  /** Debounce source changes (ms, default: 0) */
  debounceMs?: number;
  /** Cache the output (default: true) */
  cacheEnabled?: boolean;
  /** Equality check for deduplication */
  equals?: (a: T[], b: T[]) => boolean;
}

export type ComputeFunction<T = Record<string, unknown>> = (
  sources: Record<string, Record<string, unknown>[]>,
  context: ComputeContext,
) => T[];

export interface ComputeContext {
  /** Previous output (for incremental) */
  previousOutput?: Record<string, unknown>[];
  /** Change events that triggered recomputation */
  changes?: SourceChange[];
  /** Whether this is the initial computation */
  isInitial: boolean;
}

export interface SourceChange {
  source: string;
  type: 'insert' | 'update' | 'delete';
  documentId: string;
  document?: Record<string, unknown>;
  previousDocument?: Record<string, unknown>;
}

export interface ComputedCollectionState {
  name: string;
  status: 'idle' | 'computing' | 'error' | 'stale';
  documentCount: number;
  lastComputedAt: number | null;
  computeTimeMs: number;
  recomputeCount: number;
  errorMessage?: string;
}

export type ComputedEvent =
  | { type: 'computed'; name: string; documentCount: number; timeMs: number }
  | { type: 'invalidated'; name: string; reason: string }
  | { type: 'error'; name: string; error: string }
  | { type: 'disposed'; name: string };

export interface JoinConfig {
  leftSource: string;
  rightSource: string;
  leftKey: string;
  rightKey: string;
  type: 'inner' | 'left' | 'right' | 'full';
  select?: (left: Record<string, unknown>, right: Record<string, unknown> | null) => Record<string, unknown>;
}

export interface AggregationConfig {
  source: string;
  groupBy?: string | string[];
  aggregations: AggregationField[];
}

export interface AggregationField {
  field: string;
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'collect';
  alias?: string;
}

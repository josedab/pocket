/**
 * Query playground engine for executing queries and tracking history.
 *
 * @module @pocket/studio-pro
 *
 * @example
 * ```typescript
 * import { createProQueryPlayground } from '@pocket/studio-pro';
 *
 * const playground = createProQueryPlayground({ maxHistoryEntries: 50 });
 * const result = playground.execute({
 *   collection: 'users',
 *   filter: { age: { $gt: 21 } },
 * }, [{ _id: '1', name: 'Alice', age: 30 }]);
 * console.log(result.resultCount);
 * ```
 */

import { BehaviorSubject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  QueryPlaygroundState,
  QueryHistoryEntry,
  QueryExplanation,
  StudioConfig,
} from './types.js';

/** A query descriptor for the playground. */
export interface PlaygroundQuery {
  /** Target collection name */
  collection: string;
  /** Filter criteria (key-value matching) */
  filter?: Record<string, unknown>;
  /** Maximum results to return */
  limit?: number;
}

/** Result of a playground query execution. */
export interface PlaygroundResult {
  /** Matching documents */
  results: unknown[];
  /** Time taken in milliseconds */
  executionTimeMs: number;
  /** Number of results */
  resultCount: number;
}

/**
 * Query playground API.
 */
export interface QueryPlayground {
  /** Execute a query against provided documents. */
  execute(query: PlaygroundQuery, documents: Record<string, unknown>[]): PlaygroundResult;
  /** Get query execution history. */
  getHistory(): QueryHistoryEntry[];
  /** Clear all history entries. */
  clearHistory(): void;
  /** Get an execution plan explanation for a query. */
  explain(query: PlaygroundQuery): QueryExplanation;
  /** Get reactive state observable. */
  getState$(): Observable<QueryPlaygroundState>;
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      const docVal = doc[key];
      for (const [op, operand] of Object.entries(ops)) {
        if (op === '$gt' && !(typeof docVal === 'number' && typeof operand === 'number' && docVal > operand)) return false;
        if (op === '$lt' && !(typeof docVal === 'number' && typeof operand === 'number' && docVal < operand)) return false;
        if (op === '$gte' && !(typeof docVal === 'number' && typeof operand === 'number' && docVal >= operand)) return false;
        if (op === '$lte' && !(typeof docVal === 'number' && typeof operand === 'number' && docVal <= operand)) return false;
        if (op === '$ne' && docVal === operand) return false;
      }
    } else {
      if (doc[key] !== value) return false;
    }
  }
  return true;
}

/**
 * Create a query playground instance.
 *
 * @example
 * ```typescript
 * const playground = createProQueryPlayground({ maxHistoryEntries: 100 });
 * const result = playground.execute(
 *   { collection: 'users', filter: { active: true } },
 *   documents,
 * );
 * ```
 */
export function createProQueryPlayground(
  config: Partial<StudioConfig> = {},
): QueryPlayground {
  const maxHistory = config.maxHistoryEntries ?? 100;
  const history: QueryHistoryEntry[] = [];
  let entryCounter = 0;

  const state$ = new BehaviorSubject<QueryPlaygroundState>({
    query: '',
    results: [],
    executionTime: 0,
    error: null,
    history: [],
  });

  function execute(query: PlaygroundQuery, documents: Record<string, unknown>[]): PlaygroundResult {
    const start = performance.now();
    let filtered = documents;

    if (query.filter) {
      const f = query.filter;
      filtered = documents.filter((doc) => matchesFilter(doc, f));
    }

    if (query.limit !== undefined && query.limit > 0) {
      filtered = filtered.slice(0, query.limit);
    }

    const executionTimeMs = Math.round((performance.now() - start) * 100) / 100;

    const entry: QueryHistoryEntry = {
      id: `qh-${++entryCounter}`,
      query: JSON.stringify(query),
      executedAt: new Date().toISOString(),
      resultCount: filtered.length,
      executionMs: executionTimeMs,
    };

    history.unshift(entry);
    if (history.length > maxHistory) {
      history.pop();
    }

    state$.next({
      query: JSON.stringify(query),
      results: filtered,
      executionTime: executionTimeMs,
      error: null,
      history: [...history],
    });

    return { results: filtered, executionTimeMs, resultCount: filtered.length };
  }

  function getHistory(): QueryHistoryEntry[] {
    return [...history];
  }

  function clearHistory(): void {
    history.length = 0;
    const current = state$.getValue();
    state$.next({ ...current, history: [] });
  }

  function explain(query: PlaygroundQuery): QueryExplanation {
    const hasFilter = query.filter && Object.keys(query.filter).length > 0;
    const notes: string[] = [];

    if (!hasFilter) {
      notes.push('No filter specified, full collection scan required');
    } else {
      notes.push(`Filtering on fields: ${Object.keys(query.filter!).join(', ')}`);
    }

    if (query.limit) {
      notes.push(`Results limited to ${query.limit}`);
    }

    return {
      query: JSON.stringify(query),
      strategy: hasFilter ? 'full-scan' : 'full-scan',
      estimatedCost: hasFilter ? 50 : 100,
      indexUsed: null,
      notes,
    };
  }

  function getState$(): Observable<QueryPlaygroundState> {
    return state$.asObservable();
  }

  return { execute, getHistory, clearHistory, explain, getState$ };
}

/**
 * Query federation engine for cross-database polyglot queries
 */

import type {
  DatabaseAdapter,
  FederationConfig,
  PolyglotQuery,
  PolyglotResult,
  QueryPlan,
  QueryStep,
} from './types.js';
import { DEFAULT_FEDERATION_CONFIG } from './types.js';

/**
 * Federates queries across multiple database adapters.
 * Supports cross-adapter joins, query planning, and health checks.
 */
export class QueryFederation {
  private readonly config: FederationConfig;
  private readonly adapters = new Map<string, DatabaseAdapter>();

  constructor(config: FederationConfig) {
    this.config = config;
  }

  /** Register a database adapter */
  registerAdapter(adapter: DatabaseAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /** Remove a registered adapter */
  removeAdapter(name: string): void {
    this.adapters.delete(name);
  }

  /** Get a registered adapter by name */
  getAdapter(name: string): DatabaseAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Execute a polyglot query against the appropriate adapter(s) */
  async execute<T = Record<string, unknown>>(query: PolyglotQuery): Promise<PolyglotResult<T>> {
    if (query.join) {
      return this.executeJoin<T>(query);
    }

    const adapter = this.resolveAdapter(query);
    return this.executeWithTimeout<T>(adapter, query);
  }

  /** Execute a cross-adapter join query */
  async executeJoin<T = Record<string, unknown>>(query: PolyglotQuery): Promise<PolyglotResult<T>> {
    const join = query.join;
    if (!join) {
      throw new Error('Query does not contain a join specification');
    }

    const sourceAdapter = this.resolveAdapter(query);
    const targetAdapter = this.adapters.get(join.targetAdapter);
    if (!targetAdapter) {
      throw new Error(`Target adapter "${join.targetAdapter}" not found`);
    }

    const start = performance.now();

    // Fetch source data
    const sourceQuery: PolyglotQuery = {
      source: query.source,
      operation: 'select',
      filter: query.filter,
    };
    const sourceResult = await this.executeWithTimeout<Record<string, unknown>>(sourceAdapter, sourceQuery);

    // Fetch target data
    const targetQuery: PolyglotQuery = {
      source: join.targetCollection,
      operation: 'select',
    };
    const targetResult = await this.executeWithTimeout<Record<string, unknown>>(targetAdapter, targetQuery);

    // Perform join in memory
    const joined = this.performJoin(
      sourceResult.data,
      targetResult.data,
      join.localField,
      join.foreignField,
      join.type,
    );

    let results = joined;

    if (query.sort) {
      results = this.applySort(results, query.sort);
    }

    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    const executionTimeMs = performance.now() - start;

    return {
      data: results as T[],
      totalCount: results.length,
      executionTimeMs,
      sources: [sourceAdapter.name, targetAdapter.name],
    };
  }

  /** Generate a query execution plan */
  plan(query: PolyglotQuery): QueryPlan {
    const steps: QueryStep[] = [];
    let estimatedCost = 1;

    if (query.join) {
      const sourceAdapterName = this.config.defaultAdapter ?? this.getFirstAdapterName();
      steps.push({
        adapter: sourceAdapterName,
        operation: 'select',
        filter: query.filter,
        projection: query.projection,
      });
      steps.push({
        adapter: query.join.targetAdapter,
        operation: 'select',
      });
      steps.push({
        adapter: 'federation',
        operation: `${query.join.type}-join`,
      });
      estimatedCost = 3;
    } else {
      const adapterName = this.config.defaultAdapter ?? this.getFirstAdapterName();
      steps.push({
        adapter: adapterName,
        operation: query.operation,
        filter: query.filter,
        projection: query.projection,
      });
    }

    return { steps, estimatedCost };
  }

  /** Check health of all registered adapters */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, adapter] of this.adapters) {
      try {
        results[name] = await adapter.healthCheck();
      } catch {
        results[name] = false;
      }
    }

    return results;
  }

  private resolveAdapter(_query: PolyglotQuery): DatabaseAdapter {
    // Try default adapter first, then fall back to the first registered adapter
    const name = this.config.defaultAdapter ?? this.getFirstAdapterName();
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(
        `No adapter found. ${name ? `Adapter "${name}" is not registered.` : 'No adapters registered.'}`,
      );
    }
    return adapter;
  }

  private getFirstAdapterName(): string {
    const first = this.adapters.keys().next();
    return first.done ? '' : first.value;
  }

  private async executeWithTimeout<T>(
    adapter: DatabaseAdapter,
    query: PolyglotQuery,
  ): Promise<PolyglotResult<T>> {
    const timeout = this.config.queryTimeout;

    return new Promise<PolyglotResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Query timed out after ${timeout}ms`));
      }, timeout);

      adapter
        .execute<T>(query)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private performJoin(
    sourceData: Record<string, unknown>[],
    targetData: Record<string, unknown>[],
    localField: string,
    foreignField: string,
    type: 'inner' | 'left' | 'right',
  ): Record<string, unknown>[] {
    // Build lookup index on target data
    const targetIndex = new Map<unknown, Record<string, unknown>[]>();
    for (const row of targetData) {
      const key = row[foreignField];
      const existing = targetIndex.get(key) ?? [];
      existing.push(row);
      targetIndex.set(key, existing);
    }

    const results: Record<string, unknown>[] = [];

    if (type === 'inner' || type === 'left') {
      for (const sourceRow of sourceData) {
        const key = sourceRow[localField];
        const matches = targetIndex.get(key);

        if (matches) {
          for (const targetRow of matches) {
            results.push({ ...sourceRow, ...targetRow });
          }
        } else if (type === 'left') {
          results.push({ ...sourceRow });
        }
      }
    }

    if (type === 'right') {
      // Build source index
      const sourceIndex = new Map<unknown, Record<string, unknown>[]>();
      for (const row of sourceData) {
        const key = row[localField];
        const existing = sourceIndex.get(key) ?? [];
        existing.push(row);
        sourceIndex.set(key, existing);
      }

      for (const targetRow of targetData) {
        const key = targetRow[foreignField];
        const matches = sourceIndex.get(key);

        if (matches) {
          for (const sourceRow of matches) {
            results.push({ ...sourceRow, ...targetRow });
          }
        } else {
          results.push({ ...targetRow });
        }
      }
    }

    return results;
  }

  private applySort(
    docs: Record<string, unknown>[],
    sort: Record<string, 1 | -1>,
  ): Record<string, unknown>[] {
    const entries = Object.entries(sort);
    return [...docs].sort((a, b) => {
      for (const [field, direction] of entries) {
        const aVal = a[field];
        const bVal = b[field];
        if (aVal === bVal) continue;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;
        const cmp = (aVal as number) < (bVal as number) ? -1 : 1;
        return cmp * direction;
      }
      return 0;
    });
  }
}

/**
 * Create a query federation engine
 */
export function createQueryFederation(config?: Partial<FederationConfig>): QueryFederation {
  return new QueryFederation({ ...DEFAULT_FEDERATION_CONFIG, ...config });
}

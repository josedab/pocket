/**
 * View Definition DSL for declarative materialized view definitions.
 */
import type { AggregateOp } from './types.js';

export interface ViewColumn {
  name: string;
  source: string;
  expression?: string;
  alias?: string;
}

export interface ViewJoin {
  collection: string;
  alias: string;
  on: { left: string; right: string };
  type: 'inner' | 'left' | 'right';
}

export interface DslViewAggregation {
  field: string;
  op: AggregateOp;
  alias: string;
}

export interface ViewGroupBy {
  fields: string[];
}

export interface ViewFilter {
  field: string;
  operator: '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin' | '$regex';
  value: unknown;
}

export interface ViewSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ViewDefinitionConfig {
  name: string;
  source: string;
  columns: ViewColumn[];
  filters: ViewFilter[];
  joins: ViewJoin[];
  aggregations: DslViewAggregation[];
  groupBy: ViewGroupBy | null;
  sort: ViewSort[];
  limit?: number;
  refreshStrategy: 'immediate' | 'debounced' | 'manual' | 'interval';
  refreshInterval?: number;
  debounceMs?: number;
}

/**
 * Fluent builder for constructing view definitions.
 */
export class ViewDefinitionBuilder {
  private config: ViewDefinitionConfig;

  constructor(name: string, source: string) {
    this.config = {
      name,
      source,
      columns: [],
      filters: [],
      joins: [],
      aggregations: [],
      groupBy: null,
      sort: [],
      refreshStrategy: 'debounced',
      debounceMs: 100,
    };
  }

  select(...columns: (string | ViewColumn)[]): this {
    for (const col of columns) {
      if (typeof col === 'string') {
        this.config.columns.push({ name: col, source: this.config.source });
      } else {
        this.config.columns.push(col);
      }
    }
    return this;
  }

  where(field: string, operator: ViewFilter['operator'], value: unknown): this {
    this.config.filters.push({ field, operator, value });
    return this;
  }

  join(
    collection: string,
    alias: string,
    on: { left: string; right: string },
    type: ViewJoin['type'] = 'inner'
  ): this {
    this.config.joins.push({ collection, alias, on, type });
    return this;
  }

  leftJoin(collection: string, alias: string, on: { left: string; right: string }): this {
    return this.join(collection, alias, on, 'left');
  }

  aggregate(field: string, op: AggregateOp, alias: string): this {
    this.config.aggregations.push({ field, op, alias });
    return this;
  }

  count(alias = 'count'): this {
    return this.aggregate('*', 'count', alias);
  }

  sum(field: string, alias?: string): this {
    return this.aggregate(field, 'sum', alias ?? `sum_${field}`);
  }

  avg(field: string, alias?: string): this {
    return this.aggregate(field, 'avg', alias ?? `avg_${field}`);
  }

  min(field: string, alias?: string): this {
    return this.aggregate(field, 'min', alias ?? `min_${field}`);
  }

  max(field: string, alias?: string): this {
    return this.aggregate(field, 'max', alias ?? `max_${field}`);
  }

  groupByFields(...fields: string[]): this {
    this.config.groupBy = { fields };
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.config.sort.push({ field, direction });
    return this;
  }

  withLimit(limit: number): this {
    this.config.limit = limit;
    return this;
  }

  refreshOn(
    strategy: ViewDefinitionConfig['refreshStrategy'],
    options?: { interval?: number; debounceMs?: number }
  ): this {
    this.config.refreshStrategy = strategy;
    if (options?.interval) this.config.refreshInterval = options.interval;
    if (options?.debounceMs) this.config.debounceMs = options.debounceMs;
    return this;
  }

  build(): ViewDefinitionConfig {
    if (!this.config.name) throw new Error('View name is required');
    if (!this.config.source) throw new Error('View source collection is required');
    return { ...this.config };
  }
}

export function defineView(name: string, source: string): ViewDefinitionBuilder {
  return new ViewDefinitionBuilder(name, source);
}

/**
 * Query Builder - Fluent API for building queries
 */

import type {
  AggregationType,
  Condition,
  FieldCondition,
  JoinSpec,
  LogicalCondition,
  QueryDefinition,
  QueryOperator,
  SortDirection,
} from './types.js';

/**
 * Fluent query builder
 */
export class QueryBuilder {
  private query: QueryDefinition;

  constructor(collection: string) {
    this.query = {
      collection,
      live: false,
    };
  }

  /**
   * Add a where condition
   */
  where(field: string, operator: QueryOperator, value: unknown): this {
    const condition: FieldCondition = { field, operator, value };

    if (!this.query.where) {
      this.query.where = condition;
    } else if (isLogicalCondition(this.query.where) && this.query.where.operator === 'and') {
      this.query.where.conditions.push(condition);
    } else {
      this.query.where = {
        operator: 'and',
        conditions: [this.query.where, condition],
      };
    }

    return this;
  }

  /**
   * Shorthand for equals condition
   */
  eq(field: string, value: unknown): this {
    return this.where(field, 'eq', value);
  }

  /**
   * Shorthand for not equals condition
   */
  neq(field: string, value: unknown): this {
    return this.where(field, 'neq', value);
  }

  /**
   * Shorthand for greater than condition
   */
  gt(field: string, value: unknown): this {
    return this.where(field, 'gt', value);
  }

  /**
   * Shorthand for greater than or equal condition
   */
  gte(field: string, value: unknown): this {
    return this.where(field, 'gte', value);
  }

  /**
   * Shorthand for less than condition
   */
  lt(field: string, value: unknown): this {
    return this.where(field, 'lt', value);
  }

  /**
   * Shorthand for less than or equal condition
   */
  lte(field: string, value: unknown): this {
    return this.where(field, 'lte', value);
  }

  /**
   * Shorthand for in array condition
   */
  in(field: string, values: unknown[]): this {
    return this.where(field, 'in', values);
  }

  /**
   * Shorthand for not in array condition
   */
  notIn(field: string, values: unknown[]): this {
    return this.where(field, 'nin', values);
  }

  /**
   * Shorthand for contains condition
   */
  contains(field: string, value: string): this {
    return this.where(field, 'contains', value);
  }

  /**
   * Shorthand for starts with condition
   */
  startsWith(field: string, value: string): this {
    return this.where(field, 'startsWith', value);
  }

  /**
   * Shorthand for ends with condition
   */
  endsWith(field: string, value: string): this {
    return this.where(field, 'endsWith', value);
  }

  /**
   * Shorthand for regex condition
   */
  regex(field: string, pattern: string | RegExp): this {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    return this.where(field, 'regex', patternStr);
  }

  /**
   * Shorthand for between condition
   */
  between(field: string, min: unknown, max: unknown): this {
    return this.where(field, 'between', [min, max]);
  }

  /**
   * Shorthand for exists condition
   */
  exists(field: string, shouldExist = true): this {
    return this.where(field, 'exists', shouldExist);
  }

  /**
   * Add OR conditions
   */
  or(builder: (q: QueryBuilder) => QueryBuilder): this {
    const subQuery = builder(new QueryBuilder(this.query.collection));
    const subCondition = subQuery.build().where;

    if (!subCondition) return this;

    if (!this.query.where) {
      this.query.where = subCondition;
    } else {
      this.query.where = {
        operator: 'or',
        conditions: [this.query.where, subCondition],
      };
    }

    return this;
  }

  /**
   * Add AND conditions
   */
  and(builder: (q: QueryBuilder) => QueryBuilder): this {
    const subQuery = builder(new QueryBuilder(this.query.collection));
    const subCondition = subQuery.build().where;

    if (!subCondition) return this;

    if (!this.query.where) {
      this.query.where = subCondition;
    } else if (isLogicalCondition(this.query.where) && this.query.where.operator === 'and') {
      this.query.where.conditions.push(subCondition);
    } else {
      this.query.where = {
        operator: 'and',
        conditions: [this.query.where, subCondition],
      };
    }

    return this;
  }

  /**
   * Negate a condition
   */
  not(builder: (q: QueryBuilder) => QueryBuilder): this {
    const subQuery = builder(new QueryBuilder(this.query.collection));
    const subCondition = subQuery.build().where;

    if (!subCondition) return this;

    const notCondition: LogicalCondition = {
      operator: 'not',
      conditions: [subCondition],
    };

    if (!this.query.where) {
      this.query.where = notCondition;
    } else {
      this.query.where = {
        operator: 'and',
        conditions: [this.query.where, notCondition],
      };
    }

    return this;
  }

  /**
   * Add sort specification
   */
  orderBy(field: string, direction: SortDirection = 'asc'): this {
    this.query.orderBy ??= [];
    this.query.orderBy.push({ field, direction });
    return this;
  }

  /**
   * Shorthand for ascending sort
   */
  asc(field: string): this {
    return this.orderBy(field, 'asc');
  }

  /**
   * Shorthand for descending sort
   */
  desc(field: string): this {
    return this.orderBy(field, 'desc');
  }

  /**
   * Set limit
   */
  limit(count: number): this {
    this.query.pagination ??= {};
    this.query.pagination.limit = count;
    return this;
  }

  /**
   * Set offset
   */
  offset(count: number): this {
    this.query.pagination ??= {};
    this.query.pagination.offset = count;
    return this;
  }

  /**
   * Set cursor for pagination
   */
  cursor(value: string): this {
    this.query.pagination ??= {};
    this.query.pagination.cursor = value;
    return this;
  }

  /**
   * Paginate results
   */
  paginate(page: number, pageSize: number): this {
    this.query.pagination ??= {};
    this.query.pagination.offset = (page - 1) * pageSize;
    this.query.pagination.limit = pageSize;
    return this;
  }

  /**
   * Select specific fields
   */
  select(...fields: string[]): this {
    this.query.select ??= {};
    this.query.select.include = fields;
    return this;
  }

  /**
   * Exclude specific fields
   */
  exclude(...fields: string[]): this {
    this.query.select ??= {};
    this.query.select.exclude = fields;
    return this;
  }

  /**
   * Add aggregation
   */
  aggregate(type: AggregationType, field?: string, alias?: string): this {
    this.query.aggregate ??= [];
    this.query.aggregate.push({ type, field, alias });
    return this;
  }

  /**
   * Count aggregation
   */
  count(alias = 'count'): this {
    return this.aggregate('count', undefined, alias);
  }

  /**
   * Sum aggregation
   */
  sum(field: string, alias?: string): this {
    return this.aggregate('sum', field, alias ?? `sum_${field}`);
  }

  /**
   * Average aggregation
   */
  avg(field: string, alias?: string): this {
    return this.aggregate('avg', field, alias ?? `avg_${field}`);
  }

  /**
   * Min aggregation
   */
  min(field: string, alias?: string): this {
    return this.aggregate('min', field, alias ?? `min_${field}`);
  }

  /**
   * Max aggregation
   */
  max(field: string, alias?: string): this {
    return this.aggregate('max', field, alias ?? `max_${field}`);
  }

  /**
   * Group by fields
   */
  groupBy(...fields: string[]): this {
    this.query.aggregate ??= [];
    this.query.aggregate.push({ type: 'group', groupBy: fields });
    return this;
  }

  /**
   * Distinct values
   */
  distinct(field: string): this {
    return this.aggregate('distinct', field, `distinct_${field}`);
  }

  /**
   * Add computed field
   */
  computed(name: string, expression: string, dependencies: string[]): this {
    this.query.computed ??= [];
    this.query.computed.push({ name, expression, dependencies });
    return this;
  }

  /**
   * Join another collection
   */
  join(
    collection: string,
    localField: string,
    foreignField: string,
    as: string,
    where?: (q: QueryBuilder) => QueryBuilder
  ): this {
    this.query.join ??= [];

    const joinSpec: JoinSpec = {
      collection,
      localField,
      foreignField,
      as,
    };

    if (where) {
      const subQuery = where(new QueryBuilder(collection));
      joinSpec.where = subQuery.build().where;
    }

    this.query.join.push(joinSpec);
    return this;
  }

  /**
   * Enable live updates
   */
  live(enabled = true): this {
    this.query.live = enabled;
    return this;
  }

  /**
   * Build the query definition
   */
  build(): QueryDefinition {
    return { ...this.query };
  }

  /**
   * Clone the builder
   */
  clone(): QueryBuilder {
    const cloned = new QueryBuilder(this.query.collection);
    cloned.query = JSON.parse(JSON.stringify(this.query));
    return cloned;
  }
}

/**
 * Type guard for logical condition
 */
function isLogicalCondition(condition: Condition): condition is LogicalCondition {
  return 'operator' in condition && 'conditions' in condition;
}

/**
 * Create a new query builder
 */
export function query(collection: string): QueryBuilder {
  return new QueryBuilder(collection);
}

/**
 * Parse a query from JSON
 */
export function parseQuery(json: string | object): QueryDefinition {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return parsed as QueryDefinition;
}

/**
 * Serialize a query to JSON
 */
export function serializeQuery(query: QueryDefinition): string {
  return JSON.stringify(query);
}

/**
 * Generate a hash for a query (for caching)
 */
export function hashQuery(query: QueryDefinition): string {
  const str = JSON.stringify(query);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `q_${Math.abs(hash).toString(36)}`;
}

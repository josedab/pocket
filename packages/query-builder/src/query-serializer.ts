/**
 * QuerySerializer - Serialization and code generation for query plans.
 *
 * Provides multiple output formats for query plans including JSON,
 * SQL-like syntax, TypeScript code, and human-readable descriptions.
 *
 * @module query-serializer
 *
 * @example
 * ```typescript
 * import { QuerySerializer } from '@pocket/query-builder';
 *
 * const serializer = new QuerySerializer();
 * const plan = createQueryBuilder('users')
 *   .where('status', 'eq', 'active')
 *   .build();
 *
 * console.log(serializer.toSQL(plan));
 * // SELECT * FROM users WHERE status = 'active'
 *
 * console.log(serializer.toReadable(plan));
 * // Find all documents in "users" where status equals "active"
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryBuilder}
 */

import type {
  AggregateClause,
  FilterCondition,
  LogicalGroup,
  QueryPlan,
} from './types.js';

/**
 * Serializes query plans into multiple output formats.
 *
 * The `QuerySerializer` converts {@link QueryPlan} objects into
 * JSON, SQL, TypeScript code, and human-readable formats for
 * debugging, logging, and code generation.
 *
 * @example
 * ```typescript
 * const serializer = new QuerySerializer();
 *
 * // Serialize to JSON for storage
 * const json = serializer.serialize(plan);
 * const restored = serializer.deserialize(json);
 *
 * // Generate SQL for debugging
 * console.log(serializer.toSQL(plan));
 *
 * // Generate TypeScript code
 * console.log(serializer.toCode(plan));
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryBuilder}
 */
export class QuerySerializer {
  /**
   * Serializes a query plan to a JSON string.
   *
   * @param plan - The query plan to serialize
   * @returns A JSON string representation
   *
   * @example
   * ```typescript
   * const json = serializer.serialize(plan);
   * localStorage.setItem('savedQuery', json);
   * ```
   */
  serialize(plan: QueryPlan): string {
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Deserializes a query plan from a JSON string.
   *
   * @param json - The JSON string to deserialize
   * @returns The deserialized query plan
   * @throws Error if the JSON is invalid or missing required fields
   *
   * @example
   * ```typescript
   * const json = localStorage.getItem('savedQuery');
   * if (json) {
   *   const plan = serializer.deserialize(json);
   * }
   * ```
   */
  deserialize(json: string): QueryPlan {
    const parsed = JSON.parse(json) as QueryPlan;
    if (!parsed.collection) {
      throw new Error('Invalid query plan: missing collection field');
    }
    return parsed;
  }

  /**
   * Converts a query plan to an SQL-like string for debugging.
   *
   * The output is not intended for execution against a real SQL database,
   * but provides a familiar syntax for understanding the query.
   *
   * @param plan - The query plan to convert
   * @returns An SQL-like string representation
   *
   * @example
   * ```typescript
   * const sql = serializer.toSQL(plan);
   * console.log(sql);
   * // SELECT name, email FROM users WHERE status = 'active' ORDER BY name ASC LIMIT 10
   * ```
   */
  toSQL(plan: QueryPlan): string {
    const parts: string[] = [];

    // SELECT clause
    if (plan.aggregates && plan.aggregates.length > 0) {
      const aggParts = plan.aggregates.map((a) => this._aggregateToSQL(a));
      parts.push(`SELECT ${aggParts.join(', ')}`);
    } else if (plan.select) {
      parts.push(`SELECT ${plan.select.fields.join(', ')}`);
    } else {
      parts.push('SELECT *');
    }

    // FROM clause
    parts.push(`FROM ${plan.collection}`);

    // WHERE clause
    if (plan.where && plan.where.conditions.length > 0) {
      parts.push(`WHERE ${this._groupToSQL(plan.where)}`);
    }

    // ORDER BY clause
    if (plan.sort && plan.sort.length > 0) {
      const sortParts = plan.sort.map(
        (s) => `${s.field} ${s.direction.toUpperCase()}`
      );
      parts.push(`ORDER BY ${sortParts.join(', ')}`);
    }

    // LIMIT clause
    if (plan.pagination?.limit !== undefined) {
      parts.push(`LIMIT ${plan.pagination.limit}`);
    }

    // OFFSET clause
    if (plan.pagination?.skip !== undefined) {
      parts.push(`OFFSET ${plan.pagination.skip}`);
    }

    return parts.join(' ');
  }

  /**
   * Generates TypeScript code that reproduces the query.
   *
   * @param plan - The query plan to convert
   * @returns A TypeScript code string using the fluent API
   *
   * @example
   * ```typescript
   * const code = serializer.toCode(plan);
   * console.log(code);
   * // createQueryBuilder('users')
   * //   .select('name', 'email')
   * //   .where('status', 'eq', 'active')
   * //   .orderBy('name', 'asc')
   * //   .limit(10)
   * //   .build()
   * ```
   */
  toCode(plan: QueryPlan): string {
    const lines: string[] = [];

    lines.push(`createQueryBuilder('${plan.collection}')`);

    // Select
    if (plan.select) {
      const fields = plan.select.fields
        .map((f) => `'${f}'`)
        .join(', ');
      lines.push(`  .select(${fields})`);
    }

    // Where conditions
    if (plan.where) {
      this._groupToCode(plan.where, lines, true);
    }

    // Sort
    if (plan.sort) {
      for (const s of plan.sort) {
        lines.push(`  .orderBy('${s.field}', '${s.direction}')`);
      }
    }

    // Pagination
    if (plan.pagination?.skip !== undefined) {
      lines.push(`  .skip(${plan.pagination.skip})`);
    }
    if (plan.pagination?.limit !== undefined) {
      lines.push(`  .limit(${plan.pagination.limit})`);
    }

    // Aggregates
    if (plan.aggregates) {
      for (const agg of plan.aggregates) {
        const alias = agg.alias ? `, '${agg.alias}'` : '';
        lines.push(`  .${agg.function}('${agg.field}'${alias})`);
      }
    }

    lines.push('  .build()');

    return lines.join('\n');
  }

  /**
   * Generates a human-readable description of the query.
   *
   * @param plan - The query plan to describe
   * @returns A natural language description
   *
   * @example
   * ```typescript
   * const description = serializer.toReadable(plan);
   * console.log(description);
   * // Find documents in "users" where status equals "active", ordered by name ascending, limit 10
   * ```
   */
  toReadable(plan: QueryPlan): string {
    const parts: string[] = [];

    // Collection
    if (plan.aggregates && plan.aggregates.length > 0) {
      const aggDescs = plan.aggregates.map((a) => this._aggregateToReadable(a));
      parts.push(
        `Compute ${aggDescs.join(', ')} from "${plan.collection}"`
      );
    } else if (plan.select) {
      parts.push(
        `Find ${plan.select.fields.join(', ')} in "${plan.collection}"`
      );
    } else {
      parts.push(`Find all documents in "${plan.collection}"`);
    }

    // Where
    if (plan.where && plan.where.conditions.length > 0) {
      parts.push(`where ${this._groupToReadable(plan.where)}`);
    }

    // Sort
    if (plan.sort && plan.sort.length > 0) {
      const sortDescs = plan.sort.map(
        (s) => `${s.field} ${s.direction === 'asc' ? 'ascending' : 'descending'}`
      );
      parts.push(`ordered by ${sortDescs.join(', ')}`);
    }

    // Pagination
    if (plan.pagination?.limit !== undefined) {
      parts.push(`limit ${plan.pagination.limit}`);
    }
    if (plan.pagination?.skip !== undefined) {
      parts.push(`skip ${plan.pagination.skip}`);
    }

    return parts.join(', ');
  }

  /**
   * Converts a logical group to SQL syntax.
   * @internal
   */
  private _groupToSQL(group: LogicalGroup): string {
    const parts = group.conditions.map((c) => {
      if ('field' in c) {
        return this._conditionToSQL(c);
      }
      return `(${this._groupToSQL(c)})`;
    });

    const joiner = ` ${group.operator.toUpperCase()} `;
    return parts.join(joiner);
  }

  /**
   * Converts a filter condition to SQL syntax.
   * @internal
   */
  private _conditionToSQL(condition: FilterCondition): string {
    const { field, operator, value } = condition;
    const sqlValue = this._valueToSQL(value);

    switch (operator) {
      case 'eq': return `${field} = ${sqlValue}`;
      case 'neq': return `${field} != ${sqlValue}`;
      case 'gt': return `${field} > ${sqlValue}`;
      case 'gte': return `${field} >= ${sqlValue}`;
      case 'lt': return `${field} < ${sqlValue}`;
      case 'lte': return `${field} <= ${sqlValue}`;
      case 'in': return `${field} IN (${Array.isArray(value) ? value.map((v: unknown) => this._valueToSQL(v)).join(', ') : sqlValue})`;
      case 'nin': return `${field} NOT IN (${Array.isArray(value) ? value.map((v: unknown) => this._valueToSQL(v)).join(', ') : sqlValue})`;
      case 'contains': return `${field} LIKE '%${value}%'`;
      case 'startsWith': return `${field} LIKE '${value}%'`;
      case 'endsWith': return `${field} LIKE '%${value}'`;
      case 'exists': return `${field} IS ${value ? 'NOT NULL' : 'NULL'}`;
      case 'regex': return `${field} REGEXP ${sqlValue}`;
      case 'between': return `${field} BETWEEN ${Array.isArray(value) ? this._valueToSQL(value[0]) : sqlValue} AND ${Array.isArray(value) ? this._valueToSQL(value[1]) : sqlValue}`;
      default: return `${field} ${operator} ${sqlValue}`;
    }
  }

  /**
   * Converts a value to SQL representation.
   * @internal
   */
  private _valueToSQL(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `(${value.map((v) => this._valueToSQL(v)).join(', ')})`;
    return String(value);
  }

  /**
   * Converts a logical group to code lines.
   * @internal
   */
  private _groupToCode(group: LogicalGroup, lines: string[], _isRoot: boolean): void {
    for (const condition of group.conditions) {
      if ('field' in condition) {
        const fc = condition;
        const val = typeof fc.value === 'string' ? `'${fc.value}'` : JSON.stringify(fc.value);
        lines.push(`  .where('${fc.field}', '${fc.operator}', ${val})`);
      } else {
        const nested = condition;
        lines.push(`  .${nested.operator}()`);
        this._groupToCode(nested, lines, false);
        lines.push('  .endGroup()');
      }
    }
  }

  /**
   * Converts a logical group to human-readable text.
   * @internal
   */
  private _groupToReadable(group: LogicalGroup): string {
    const parts = group.conditions.map((c) => {
      if ('field' in c) {
        return this._conditionToReadable(c);
      }
      const nested = c;
      return `(${this._groupToReadable(nested)})`;
    });

    const joiner = group.operator === 'or' ? ' or ' : ' and ';
    return parts.join(joiner);
  }

  /**
   * Converts a filter condition to human-readable text.
   * @internal
   */
  private _conditionToReadable(condition: FilterCondition): string {
    const { field, operator, value } = condition;
    const readableValue = JSON.stringify(value);

    switch (operator) {
      case 'eq': return `${field} equals ${readableValue}`;
      case 'neq': return `${field} does not equal ${readableValue}`;
      case 'gt': return `${field} is greater than ${readableValue}`;
      case 'gte': return `${field} is at least ${readableValue}`;
      case 'lt': return `${field} is less than ${readableValue}`;
      case 'lte': return `${field} is at most ${readableValue}`;
      case 'in': return `${field} is one of ${readableValue}`;
      case 'nin': return `${field} is not one of ${readableValue}`;
      case 'contains': return `${field} contains ${readableValue}`;
      case 'startsWith': return `${field} starts with ${readableValue}`;
      case 'endsWith': return `${field} ends with ${readableValue}`;
      case 'exists': return `${field} ${value ? 'exists' : 'does not exist'}`;
      case 'regex': return `${field} matches pattern ${readableValue}`;
      case 'between': return `${field} is between ${Array.isArray(value) ? `${value[0]} and ${value[1]}` : readableValue}`;
      default: return `${field} ${operator} ${readableValue}`;
    }
  }

  /**
   * Converts an aggregate clause to SQL syntax.
   * @internal
   */
  private _aggregateToSQL(agg: AggregateClause): string {
    const fn = agg.function.toUpperCase();
    const alias = agg.alias ? ` AS ${agg.alias}` : '';
    return `${fn}(${agg.field})${alias}`;
  }

  /**
   * Converts an aggregate clause to human-readable text.
   * @internal
   */
  private _aggregateToReadable(agg: AggregateClause): string {
    const alias = agg.alias ? ` as "${agg.alias}"` : '';
    switch (agg.function) {
      case 'count': return `count of ${agg.field}${alias}`;
      case 'sum': return `sum of ${agg.field}${alias}`;
      case 'avg': return `average of ${agg.field}${alias}`;
      case 'min': return `minimum ${agg.field}${alias}`;
      case 'max': return `maximum ${agg.field}${alias}`;
      default: return `${agg.function}(${agg.field})${alias}`;
    }
  }
}

/**
 * Creates a new {@link QuerySerializer} instance.
 *
 * @returns A new QuerySerializer
 *
 * @example
 * ```typescript
 * import { createQuerySerializer } from '@pocket/query-builder';
 *
 * const serializer = createQuerySerializer();
 * const sql = serializer.toSQL(plan);
 * ```
 */
export function createQuerySerializer(): QuerySerializer {
  return new QuerySerializer();
}

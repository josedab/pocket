/**
 * QueryCodeGenerator - Code generation from visual query models.
 *
 * Generates TypeScript, SQL, JSON, and Pocket native query representations
 * from a {@link VisualQueryModel}.
 *
 * @module code-generator
 *
 * @example
 * ```typescript
 * import { createQueryCodeGenerator, createVisualQueryModel } from '@pocket/query-builder';
 *
 * const model = createVisualQueryModel('users');
 * model.addFilter('status', 'eq', 'active');
 * model.addSort('name', 'asc');
 * model.setLimit(10);
 *
 * const generator = createQueryCodeGenerator();
 * console.log(generator.generateTypeScript(model));
 * console.log(generator.generateSQL(model));
 * ```
 *
 * @see {@link VisualQueryModel}
 * @see {@link QueryPlan}
 */

import type { AggregateClause, FilterCondition, QueryPlan } from './types.js';
import { type VisualQueryModel } from './visual-query-model.js';

/**
 * Options for the code generator.
 */
export interface CodeGeneratorOptions {
  /** Code style: 'fluent' for chained API, 'object' for literal plan */
  style: 'fluent' | 'object';
  /** Import style: 'named' for named imports, 'namespace' for namespace import */
  importStyle: 'named' | 'namespace';
}

/**
 * Generates code from a {@link VisualQueryModel} in multiple formats.
 *
 * @example
 * ```typescript
 * const generator = new QueryCodeGenerator({ style: 'fluent', importStyle: 'named' });
 * const ts = generator.generateTypeScript(model);
 * const sql = generator.generateSQL(model);
 * ```
 *
 * @see {@link createQueryCodeGenerator}
 */
export class QueryCodeGenerator {
  /** @internal */
  private _options: CodeGeneratorOptions;

  /**
   * Creates a new QueryCodeGenerator.
   *
   * @param options - Code generation options
   */
  constructor(options?: Partial<CodeGeneratorOptions>) {
    this._options = {
      style: options?.style ?? 'fluent',
      importStyle: options?.importStyle ?? 'named',
    };
  }

  /**
   * Generates TypeScript code that builds the query using Pocket's API.
   *
   * @param model - The visual query model
   * @returns TypeScript source code string
   */
  generateTypeScript(model: VisualQueryModel): string {
    const plan = model.toQueryPlan();

    if (this._options.style === 'object') {
      return this._generateObjectStyle(plan);
    }

    return this._generateFluentStyle(plan);
  }

  /**
   * Generates an SQL string representing the query.
   *
   * @param model - The visual query model
   * @returns An SQL string
   */
  generateSQL(model: VisualQueryModel): string {
    const plan = model.toQueryPlan();
    const parts: string[] = [];

    // SELECT
    if (plan.aggregates && plan.aggregates.length > 0) {
      const aggParts = plan.aggregates.map((a) => this._aggregateToSQL(a));
      parts.push(`SELECT ${aggParts.join(', ')}`);
    } else if (plan.select) {
      parts.push(`SELECT ${plan.select.fields.join(', ')}`);
    } else {
      parts.push('SELECT *');
    }

    // FROM
    parts.push(`FROM ${plan.collection}`);

    // WHERE
    if (plan.where && plan.where.conditions.length > 0) {
      const conditions = plan.where.conditions
        .map((c) => this._conditionToSQL(c as FilterCondition))
        .join(` ${plan.where.operator.toUpperCase()} `);
      parts.push(`WHERE ${conditions}`);
    }

    // ORDER BY
    if (plan.sort && plan.sort.length > 0) {
      const sortParts = plan.sort.map(
        (s) => `${s.field} ${s.direction.toUpperCase()}`
      );
      parts.push(`ORDER BY ${sortParts.join(', ')}`);
    }

    // LIMIT
    if (plan.pagination?.limit !== undefined) {
      parts.push(`LIMIT ${plan.pagination.limit}`);
    }

    // OFFSET
    if (plan.pagination?.skip !== undefined) {
      parts.push(`OFFSET ${plan.pagination.skip}`);
    }

    return parts.join(' ');
  }

  /**
   * Generates a JSON representation of the query.
   *
   * @param model - The visual query model
   * @returns A formatted JSON string
   */
  generateJSON(model: VisualQueryModel): string {
    const plan = model.toQueryPlan();
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Generates a Pocket native query object.
   *
   * @param model - The visual query model
   * @returns The query plan object
   */
  generatePocketQuery(model: VisualQueryModel): QueryPlan {
    return model.toQueryPlan();
  }

  /** @internal */
  private _generateFluentStyle(plan: QueryPlan): string {
    const lines: string[] = [];

    // Import
    if (this._options.importStyle === 'namespace') {
      lines.push("import * as qb from '@pocket/query-builder';");
      lines.push('');
      lines.push(`const query = qb.createQueryBuilder('${plan.collection}')`);
    } else {
      lines.push("import { createQueryBuilder } from '@pocket/query-builder';");
      lines.push('');
      lines.push(`const query = createQueryBuilder('${plan.collection}')`);
    }

    // Select
    if (plan.select) {
      const fields = plan.select.fields.map((f) => `'${f}'`).join(', ');
      lines.push(`  .select(${fields})`);
    }

    // Where
    if (plan.where) {
      for (const condition of plan.where.conditions) {
        if ('field' in condition) {
          const fc = condition;
          const val = typeof fc.value === 'string' ? `'${fc.value}'` : JSON.stringify(fc.value);
          lines.push(`  .where('${fc.field}', '${fc.operator}', ${val})`);
        }
      }
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

    lines.push('  .build();');

    return lines.join('\n');
  }

  /** @internal */
  private _generateObjectStyle(plan: QueryPlan): string {
    const lines: string[] = [];

    lines.push("import type { QueryPlan } from '@pocket/query-builder';");
    lines.push('');
    lines.push(`const query: QueryPlan = ${JSON.stringify(plan, null, 2)};`);

    return lines.join('\n');
  }

  /** @internal */
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

  /** @internal */
  private _valueToSQL(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `(${value.map((v) => this._valueToSQL(v)).join(', ')})`;
    return String(value);
  }

  /** @internal */
  private _aggregateToSQL(agg: AggregateClause): string {
    const fn = agg.function.toUpperCase();
    const alias = agg.alias ? ` AS ${agg.alias}` : '';
    return `${fn}(${agg.field})${alias}`;
  }
}

/**
 * Creates a new {@link QueryCodeGenerator} instance.
 *
 * @param options - Code generation options
 * @returns A new QueryCodeGenerator
 *
 * @example
 * ```typescript
 * import { createQueryCodeGenerator } from '@pocket/query-builder';
 *
 * const generator = createQueryCodeGenerator({ style: 'fluent' });
 * ```
 */
export function createQueryCodeGenerator(options?: Partial<CodeGeneratorOptions>): QueryCodeGenerator {
  return new QueryCodeGenerator(options);
}

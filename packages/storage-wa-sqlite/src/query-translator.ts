import type { Document, QueryFilter, QuerySpec, SortSpec } from '@pocket/core';
import type { QueryTranslation } from './types.js';

/**
 * Translates Pocket QuerySpec objects into SQL WHERE clauses with parameter binding.
 *
 * This translator handles the full range of Pocket query operators and maps them
 * to SQLite-compatible SQL expressions. Document fields are accessed via
 * `json_extract(_data, '$.field')` for user-defined fields, while internal
 * fields (_id, _rev, etc.) are accessed directly as columns.
 *
 * All user-supplied values are parameterized to prevent SQL injection.
 *
 * @example
 * ```typescript
 * const translator = new QueryTranslator();
 * const result = translator.translate({
 *   filter: { status: { $eq: 'active' }, count: { $gt: 5 } },
 *   sort: [{ field: 'count', direction: 'desc' }],
 *   limit: 10,
 *   skip: 20,
 * });
 * // result.whereClause => "json_extract(_data, '$.status') = ? AND json_extract(_data, '$.count') > ?"
 * // result.params => ['active', 5]
 * ```
 */
export class QueryTranslator {
  /**
   * Internal fields stored as direct columns (not in _data JSON).
   */
  private static readonly INTERNAL_FIELDS = new Set([
    '_id',
    '_rev',
    '_deleted',
    '_updatedAt',
    '_vclock',
  ]);

  /**
   * Translate a full QuerySpec into SQL components.
   *
   * @param spec - The Pocket query specification to translate
   * @returns A QueryTranslation containing WHERE, ORDER BY, params, limit, and offset
   */
  translate<T extends Document>(spec: QuerySpec<T>): QueryTranslation {
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    // Build WHERE clause from filter
    if (spec.filter) {
      const filterClauses = this.translateFilter(spec.filter, params);
      if (filterClauses) {
        whereClauses.push(filterClauses);
      }
    }

    // Build ORDER BY clause
    const orderByClause = this.translateSort(spec.sort);

    return {
      whereClause: whereClauses.join(' AND '),
      orderByClause,
      params,
      limit: spec.limit,
      offset: spec.skip,
    };
  }

  /**
   * Translate a query filter into a SQL WHERE clause fragment.
   *
   * Handles top-level logical operators ($and, $or, $not, $nor) as well as
   * per-field comparison and string operators.
   */
  private translateFilter<T extends Document>(
    filter: QueryFilter<T>,
    params: unknown[]
  ): string {
    const clauses: string[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;

      // Handle logical operators
      if (key === '$and') {
        const subClauses = (value as QueryFilter<T>[]).map((f) =>
          this.translateFilter(f, params)
        );
        const validClauses = subClauses.filter(Boolean);
        if (validClauses.length > 0) {
          clauses.push(`(${validClauses.join(' AND ')})`);
        }
        continue;
      }

      if (key === '$or') {
        const subClauses = (value as QueryFilter<T>[]).map((f) =>
          this.translateFilter(f, params)
        );
        const validClauses = subClauses.filter(Boolean);
        if (validClauses.length > 0) {
          clauses.push(`(${validClauses.join(' OR ')})`);
        }
        continue;
      }

      if (key === '$not') {
        const subClause = this.translateFilter(value as QueryFilter<T>, params);
        if (subClause) {
          clauses.push(`NOT (${subClause})`);
        }
        continue;
      }

      if (key === '$nor') {
        const subClauses = (value as QueryFilter<T>[]).map((f) =>
          this.translateFilter(f, params)
        );
        const validClauses = subClauses.filter(Boolean);
        if (validClauses.length > 0) {
          clauses.push(`NOT (${validClauses.join(' OR ')})`);
        }
        continue;
      }

      // Handle field conditions
      const fieldClauses = this.translateFieldCondition(key, value, params);
      if (fieldClauses) {
        clauses.push(fieldClauses);
      }
    }

    return clauses.join(' AND ');
  }

  /**
   * Translate a single field condition into SQL.
   *
   * If the value is a primitive, it is treated as an implicit $eq.
   * If the value is an object with operator keys ($gt, $in, etc.), each
   * operator is translated individually.
   */
  private translateFieldCondition(
    field: string,
    condition: unknown,
    params: unknown[]
  ): string {
    const sqlField = this.fieldToSql(field);

    // Direct value comparison (implicit $eq)
    if (condition === null || typeof condition !== 'object' || condition instanceof RegExp) {
      if (condition instanceof RegExp) {
        return this.translateRegex(sqlField, condition, params);
      }
      if (condition === null) {
        return `${sqlField} IS NULL`;
      }
      params.push(condition);
      return `${sqlField} = ?`;
    }

    // Object with operators
    const ops = condition as Record<string, unknown>;
    const clauses: string[] = [];

    for (const [op, opValue] of Object.entries(ops)) {
      const clause = this.translateOperator(sqlField, op, opValue, params);
      if (clause) {
        clauses.push(clause);
      }
    }

    if (clauses.length === 0) {
      // Plain object equality (no operators) - treat as implicit $eq
      params.push(JSON.stringify(condition));
      return `${sqlField} = ?`;
    }

    return clauses.join(' AND ');
  }

  /**
   * Translate a single query operator to a SQL expression.
   */
  private translateOperator(
    sqlField: string,
    operator: string,
    value: unknown,
    params: unknown[]
  ): string | null {
    switch (operator) {
      case '$eq':
        if (value === null) {
          return `${sqlField} IS NULL`;
        }
        params.push(value);
        return `${sqlField} = ?`;

      case '$ne':
        if (value === null) {
          return `${sqlField} IS NOT NULL`;
        }
        params.push(value);
        return `${sqlField} != ?`;

      case '$gt':
        params.push(value);
        return `${sqlField} > ?`;

      case '$gte':
        params.push(value);
        return `${sqlField} >= ?`;

      case '$lt':
        params.push(value);
        return `${sqlField} < ?`;

      case '$lte':
        params.push(value);
        return `${sqlField} <= ?`;

      case '$in': {
        const arr = value as unknown[];
        if (arr.length === 0) {
          return '0 = 1'; // Always false - no match possible
        }
        const placeholders = arr.map(() => '?').join(', ');
        params.push(...arr);
        return `${sqlField} IN (${placeholders})`;
      }

      case '$nin': {
        const arr = value as unknown[];
        if (arr.length === 0) {
          return '1 = 1'; // Always true - nothing to exclude
        }
        const placeholders = arr.map(() => '?').join(', ');
        params.push(...arr);
        return `${sqlField} NOT IN (${placeholders})`;
      }

      case '$exists':
        if (value) {
          return `${sqlField} IS NOT NULL`;
        }
        return `${sqlField} IS NULL`;

      case '$regex':
        return this.translateRegex(sqlField, value, params);

      case '$startsWith':
        params.push(`${value}%`);
        return `${sqlField} LIKE ?`;

      case '$endsWith':
        params.push(`%${value}`);
        return `${sqlField} LIKE ?`;

      case '$contains':
        params.push(`%${value}%`);
        return `${sqlField} LIKE ?`;

      default:
        // Unknown operator - skip
        return null;
    }
  }

  /**
   * Translate a regex value into a SQL LIKE or GLOB expression.
   *
   * Simple regex patterns (e.g., /^prefix/, /suffix$/, /contains/) are
   * converted to LIKE patterns. Complex patterns fall back to string comparison.
   */
  private translateRegex(
    sqlField: string,
    value: unknown,
    params: unknown[]
  ): string {
    let pattern: string;

    if (value instanceof RegExp) {
      pattern = value.source;
    } else if (typeof value === 'string') {
      pattern = value;
    } else {
      return '1 = 1';
    }

    // Convert simple regex patterns to LIKE
    // ^prefix -> 'prefix%'
    if (pattern.startsWith('^') && !this.hasRegexSpecialChars(pattern.slice(1))) {
      params.push(`${pattern.slice(1)}%`);
      return `${sqlField} LIKE ?`;
    }

    // suffix$ -> '%suffix'
    if (pattern.endsWith('$') && !this.hasRegexSpecialChars(pattern.slice(0, -1))) {
      params.push(`%${pattern.slice(0, -1)}`);
      return `${sqlField} LIKE ?`;
    }

    // Simple substring match (no special chars)
    if (!this.hasRegexSpecialChars(pattern)) {
      params.push(`%${pattern}%`);
      return `${sqlField} LIKE ?`;
    }

    // Complex regex - fall back to LIKE with the raw pattern as substring
    // SQLite does not natively support regex; this is a best-effort approach
    params.push(`%${this.stripRegexChars(pattern)}%`);
    return `${sqlField} LIKE ?`;
  }

  /**
   * Check if a string contains regex special characters beyond ^ and $.
   */
  private hasRegexSpecialChars(str: string): boolean {
    return /[.*+?()[\]{}|\\]/.test(str);
  }

  /**
   * Strip common regex metacharacters for fallback LIKE matching.
   */
  private stripRegexChars(str: string): string {
    return str.replace(/[.*+?^$()[\]{}|\\]/g, '');
  }

  /**
   * Translate sort specifications into a SQL ORDER BY clause.
   */
  private translateSort<T extends Document>(
    sort?: SortSpec<T>[]
  ): string {
    if (!sort || sort.length === 0) {
      return '';
    }

    const sortClauses = sort.map((s) => {
      const sqlField = this.fieldToSql(s.field);
      const direction = s.direction === 'desc' ? 'DESC' : 'ASC';
      return `${sqlField} ${direction}`;
    });

    return sortClauses.join(', ');
  }

  /**
   * Convert a Pocket field name to a SQL column reference.
   *
   * Internal fields (_id, _rev, etc.) are accessed directly as columns.
   * User-defined fields are accessed via json_extract(_data, '$.field').
   * Nested fields (e.g., 'user.name') use json_extract with dot path notation.
   */
  private fieldToSql(field: string): string {
    // Internal fields are stored as direct columns
    if (QueryTranslator.INTERNAL_FIELDS.has(field)) {
      return field;
    }

    // User-defined fields are in the _data JSON column
    return `json_extract(_data, '$.${field}')`;
  }
}

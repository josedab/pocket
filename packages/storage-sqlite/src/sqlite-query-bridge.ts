/**
 * SQLiteQueryBridge — SQL pass-through API for Pocket databases.
 *
 * Provides a `db.sql()` interface that translates between Pocket's document
 * model and SQL queries, usable with any SQLite-backed storage adapter.
 *
 * @example
 * ```typescript
 * const bridge = new SQLiteQueryBridge();
 * bridge.registerCollection('users', [
 *   { name: 'name', type: 'string' },
 *   { name: 'age', type: 'number' },
 * ]);
 *
 * const sql = bridge.toSQL('users', { age: { $gte: 18 } }, { age: 'desc' }, 10);
 * // SELECT _id, json(_data) as _data FROM users WHERE json_extract(_data, '$.age') >= 18 ORDER BY json_extract(_data, '$.age') DESC LIMIT 10
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface SQLiteFieldDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
}

export interface SQLQuery {
  sql: string;
  params: unknown[];
  collection: string;
}

export interface SQLResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

export interface SQLiteBridgeConfig {
  /** Use json_extract for field access (default: true) */
  useJsonExtract?: boolean;
  /** Table naming strategy */
  tablePrefix?: string;
}

// ── Implementation ────────────────────────────────────────

export class SQLiteQueryBridge {
  private readonly config: Required<SQLiteBridgeConfig>;
  private readonly collections = new Map<string, SQLiteFieldDef[]>();

  constructor(config: SQLiteBridgeConfig = {}) {
    this.config = {
      useJsonExtract: config.useJsonExtract ?? true,
      tablePrefix: config.tablePrefix ?? '',
    };
  }

  /**
   * Register a collection schema for SQL generation.
   */
  registerCollection(name: string, fields: SQLiteFieldDef[]): void {
    this.collections.set(name, fields);
  }

  /**
   * Generate a CREATE TABLE statement for a collection.
   */
  toCreateTable(collection: string): string {
    const table = this.tableName(collection);
    return `CREATE TABLE IF NOT EXISTS "${table}" (_id TEXT PRIMARY KEY, _data JSON NOT NULL, _rev TEXT, _updatedAt INTEGER)`;
  }

  /**
   * Generate a SELECT SQL query from a Pocket filter.
   */
  toSQL(
    collection: string,
    filter?: Record<string, unknown>,
    sort?: Record<string, 'asc' | 'desc'>,
    limit?: number,
    skip?: number
  ): SQLQuery {
    const table = this.tableName(collection);
    const params: unknown[] = [];
    const parts: string[] = [`SELECT _id, _data FROM "${table}"`];

    // WHERE clause
    if (filter && Object.keys(filter).length > 0) {
      const conditions = this.buildWhere(filter, params);
      if (conditions) parts.push(`WHERE ${conditions}`);
    }

    // ORDER BY
    if (sort && Object.keys(sort).length > 0) {
      const orderClauses = Object.entries(sort)
        .map(([field, dir]) => `${this.fieldRef(field)} ${dir.toUpperCase()}`)
        .join(', ');
      parts.push(`ORDER BY ${orderClauses}`);
    }

    // LIMIT / OFFSET
    if (limit !== undefined) {
      parts.push(`LIMIT ?`);
      params.push(limit);
    }
    if (skip !== undefined) {
      parts.push(`OFFSET ?`);
      params.push(skip);
    }

    return { sql: parts.join(' '), params, collection };
  }

  /**
   * Generate an INSERT OR REPLACE statement.
   */
  toInsert(collection: string, doc: Record<string, unknown>): SQLQuery {
    const table = this.tableName(collection);
    const id = String(doc._id ?? '');
    const data = JSON.stringify(doc);
    return {
      sql: `INSERT OR REPLACE INTO "${table}" (_id, _data, _updatedAt) VALUES (?, ?, ?)`,
      params: [id, data, Date.now()],
      collection,
    };
  }

  /**
   * Generate a DELETE statement.
   */
  toDelete(collection: string, documentId: string): SQLQuery {
    const table = this.tableName(collection);
    return {
      sql: `DELETE FROM "${table}" WHERE _id = ?`,
      params: [documentId],
      collection,
    };
  }

  /**
   * Generate a COUNT query.
   */
  toCount(collection: string, filter?: Record<string, unknown>): SQLQuery {
    const table = this.tableName(collection);
    const params: unknown[] = [];
    let sql = `SELECT COUNT(*) as count FROM "${table}"`;

    if (filter && Object.keys(filter).length > 0) {
      const conditions = this.buildWhere(filter, params);
      if (conditions) sql += ` WHERE ${conditions}`;
    }

    return { sql, params, collection };
  }

  /**
   * Get all registered collections.
   */
  getCollections(): string[] {
    return [...this.collections.keys()];
  }

  // ── Private ────────────────────────────────────────────

  private tableName(collection: string): string {
    return `${this.config.tablePrefix}${collection}`;
  }

  private fieldRef(field: string): string {
    if (field === '_id') return '_id';
    if (this.config.useJsonExtract) {
      return `json_extract(_data, '$.${field}')`;
    }
    return field;
  }

  private buildWhere(filter: Record<string, unknown>, params: unknown[]): string | null {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and' && Array.isArray(value)) {
        const subConditions = value
          .map((sub) => this.buildWhere(sub as Record<string, unknown>, params))
          .filter(Boolean);
        if (subConditions.length > 0) conditions.push(`(${subConditions.join(' AND ')})`);
      } else if (key === '$or' && Array.isArray(value)) {
        const subConditions = value
          .map((sub) => this.buildWhere(sub as Record<string, unknown>, params))
          .filter(Boolean);
        if (subConditions.length > 0) conditions.push(`(${subConditions.join(' OR ')})`);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          const ref = this.fieldRef(key);
          switch (op) {
            case '$eq':
              conditions.push(`${ref} = ?`);
              params.push(opVal);
              break;
            case '$ne':
              conditions.push(`${ref} != ?`);
              params.push(opVal);
              break;
            case '$gt':
              conditions.push(`${ref} > ?`);
              params.push(opVal);
              break;
            case '$gte':
              conditions.push(`${ref} >= ?`);
              params.push(opVal);
              break;
            case '$lt':
              conditions.push(`${ref} < ?`);
              params.push(opVal);
              break;
            case '$lte':
              conditions.push(`${ref} <= ?`);
              params.push(opVal);
              break;
            case '$in': {
              const arr = opVal as unknown[];
              const placeholders = arr.map(() => '?').join(',');
              conditions.push(`${ref} IN (${placeholders})`);
              params.push(...arr);
              break;
            }
            case '$contains':
              conditions.push(`${ref} LIKE ?`);
              params.push(`%${String(opVal)}%`);
              break;
            case '$startsWith':
              conditions.push(`${ref} LIKE ?`);
              params.push(`${String(opVal)}%`);
              break;
          }
        }
      } else {
        conditions.push(`${this.fieldRef(key)} = ?`);
        params.push(value);
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }
}

export function createSQLiteQueryBridge(config?: SQLiteBridgeConfig): SQLiteQueryBridge {
  return new SQLiteQueryBridge(config);
}

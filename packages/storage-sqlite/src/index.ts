/**
 * @pocket/storage-sqlite - SQLite Storage Adapter for Pocket
 *
 * This package provides SQL-based storage using SQLite. It supports
 * multiple SQLite implementations for cross-platform compatibility.
 *
 * ## Features
 *
 * - **Full SQL Power**: Complex queries with JOIN, GROUP BY, etc.
 * - **ACID Transactions**: Atomic operations with BEGIN/COMMIT/ROLLBACK
 * - **JSON Indexing**: Create indexes on JSON document fields
 * - **Cross-Platform**: Works in browser (WASM) and Node.js (native)
 * - **Exportable**: Database can be serialized to Uint8Array
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createSQLiteStorage } from '@pocket/storage-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createSQLiteStorage()
 * });
 *
 * const todos = db.collection<Todo>('todos');
 * await todos.insert({ title: 'Learn SQLite' });
 * ```
 *
 * ## Driver Backends
 *
 * | Driver | Environment | Performance | Bundle Size |
 * |--------|-------------|-------------|-------------|
 * | sql.js | Browser/Node | Good | ~1MB |
 * | better-sqlite3 | Node.js | Excellent | Native |
 * | wa-sqlite | Browser | Good | ~400KB |
 *
 * ## Browser Setup (sql.js)
 *
 * ```typescript
 * import initSqlJs from 'sql.js';
 *
 * const SQL = await initSqlJs({
 *   locateFile: file => `https://sql.js.org/dist/${file}`
 * });
 *
 * const storage = createSQLiteStorage({
 *   driver: 'sqljs',
 *   sqlJsFactory: () => new SQL.Database()
 * });
 * ```
 *
 * ## Node.js Setup (better-sqlite3)
 *
 * ```typescript
 * const storage = createSQLiteStorage({
 *   driver: 'better-sqlite3',
 *   filename: './data.db'
 * });
 * ```
 *
 * @packageDocumentation
 * @module @pocket/storage-sqlite
 *
 * @see {@link createSQLiteStorage} for the main factory function
 * @see {@link SQLiteStorageAdapter} for the adapter class
 */

export * from './adapter.js';
export * from './driver.js';
export type * from './types.js';

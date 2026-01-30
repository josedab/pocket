/**
 * @packageDocumentation
 *
 * WebAssembly SQLite storage adapter for Pocket.
 *
 * This package provides SQL-based storage using sql.js, which compiles
 * SQLite to WebAssembly for high-performance database operations in
 * the browser. It implements the full Pocket StorageAdapter interface
 * with ACID transactions, JSON document storage, and SQL-powered queries.
 *
 * ## Installation
 *
 * ```bash
 * npm install @pocket/storage-wa-sqlite sql.js
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createWaSQLiteStorage } from '@pocket/storage-wa-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createWaSQLiteStorage(),
 * });
 *
 * const todos = db.collection<Todo>('todos');
 * await todos.insert({ title: 'Learn SQLite WASM' });
 * ```
 *
 * ## Features
 *
 * - **SQL Power**: Full SQLite engine compiled to WebAssembly
 * - **ACID Transactions**: Real BEGIN/COMMIT/ROLLBACK semantics
 * - **JSON Indexing**: Create indexes on JSON document fields via json_extract
 * - **Browser Compatible**: Runs entirely in the browser via WASM
 * - **Exportable**: Serialize the entire database to a Uint8Array for backup
 * - **Query Translation**: Pocket query operators automatically translated to SQL
 *
 * ## Browser Setup
 *
 * ```typescript
 * import initSqlJs from 'sql.js';
 *
 * const storage = createWaSQLiteStorage({
 *   name: 'my-app',
 *   sqlJsFactory: () => initSqlJs({
 *     locateFile: file => `https://sql.js.org/dist/${file}`
 *   }),
 * });
 * ```
 *
 * @module @pocket/storage-wa-sqlite
 *
 * @see {@link WaSQLiteAdapter} for the main adapter class
 * @see {@link createWaSQLiteStorage} for the factory function
 */

export { WaSQLiteAdapter, createWaSQLiteStorage } from './wa-sqlite-adapter.js';
export { SQLiteDocumentStore } from './sqlite-store.js';
export { QueryTranslator } from './query-translator.js';
export type {
  WaSQLiteConfig,
  SqlJsStatic,
  SqlJsDatabase,
  SqlJsExecResult,
  SqlJsStatement,
  SQLiteIndex,
  QueryTranslation,
  SerializedDocument,
} from './types.js';

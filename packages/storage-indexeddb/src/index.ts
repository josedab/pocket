/**
 * @pocket/storage-indexeddb - IndexedDB Storage Adapter for Pocket
 *
 * This package provides persistent browser storage using the IndexedDB API.
 * It's the recommended storage adapter for web applications.
 *
 * ## Features
 *
 * - **Persistent Storage**: Data survives browser restarts
 * - **Large Capacity**: Typically 50%+ of available disk space
 * - **Index Support**: Create indexes for efficient queries
 * - **Automatic Versioning**: Schema migrations handled automatically
 * - **Structured Cloning**: Native support for complex JavaScript objects
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage()
 * });
 *
 * // Your data is now persisted in IndexedDB
 * const todos = db.collection<Todo>('todos');
 * await todos.insert({ title: 'Learn Pocket' });
 * ```
 *
 * ## Browser Support
 *
 * IndexedDB is supported in all modern browsers:
 * - Chrome 24+
 * - Firefox 16+
 * - Safari 10+
 * - Edge 12+
 *
 * ## Testing
 *
 * For testing, use fake-indexeddb:
 *
 * ```typescript
 * import 'fake-indexeddb/auto';
 * import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
 *
 * const storage = createIndexedDBStorage({
 *   indexedDB: indexedDB // Injected by fake-indexeddb
 * });
 * ```
 *
 * @packageDocumentation
 * @module @pocket/storage-indexeddb
 *
 * @see {@link createIndexedDBStorage} for the main factory function
 * @see {@link IndexedDBAdapter} for the adapter class
 */

export * from './adapter.js';
export * from './serialization.js';
export * from './transaction.js';

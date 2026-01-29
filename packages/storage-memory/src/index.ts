/**
 * @packageDocumentation
 *
 * In-memory storage adapter for Pocket.
 *
 * This package provides a non-persistent storage implementation that keeps
 * all data in JavaScript memory. It's ideal for testing, development, and
 * server-side rendering where browser storage APIs aren't available.
 *
 * ## Installation
 *
 * ```bash
 * npm install @pocket/storage-memory
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createMemoryStorage } from '@pocket/storage-memory';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createMemoryStorage(),
 * });
 *
 * const users = db.collection<User>('users');
 * await users.insert({ name: 'Alice' });
 * ```
 *
 * ## Features
 *
 * - **Always Available**: Works in any JavaScript environment (Node.js, browsers, workers)
 * - **Fast**: No I/O overhead, all operations are synchronous in-memory
 * - **Isolated**: Each adapter instance has its own data, perfect for parallel tests
 * - **Full API Support**: Indexes, queries, and change streams all work as expected
 *
 * ## Use Cases
 *
 * - **Unit Testing**: Fast, isolated tests without external dependencies
 * - **Integration Testing**: Test database interactions without real storage
 * - **Development**: Quick prototyping without setting up persistent storage
 * - **SSR**: Server-side rendering where IndexedDB isn't available
 * - **Temporary Data**: Session or cache data that doesn't need persistence
 *
 * ## Limitations
 *
 * - Data is not persisted - lost when the process ends or adapter closes
 * - No true transaction support (operations are not atomic)
 * - Cannot measure storage size accurately
 *
 * @module @pocket/storage-memory
 *
 * @see {@link MemoryStorageAdapter} for the main adapter class
 * @see {@link createMemoryStorage} for the factory function
 */
export * from './adapter.js';

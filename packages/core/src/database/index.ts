/**
 * Database and Collection module.
 *
 * This module provides the core data management classes:
 *
 * - {@link Database}: Main entry point for creating and managing databases
 * - {@link Collection}: Interface for working with document collections
 * - Document utilities: Functions for preparing and comparing documents
 *
 * @example Creating a database
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 *   collections: [
 *     { name: 'users', schema: userSchema },
 *     { name: 'todos' }
 *   ]
 * });
 * ```
 *
 * @example Working with collections
 * ```typescript
 * const users = db.collection<User>('users');
 *
 * // CRUD operations
 * await users.insert({ name: 'Alice' });
 * await users.update('id', { name: 'Alice Smith' });
 * await users.delete('id');
 *
 * // Queries
 * const admins = await users.find({ role: 'admin' }).exec();
 * ```
 *
 * @module database
 */
export * from './collection.js';
export * from './database.js';
export * from './document.js';

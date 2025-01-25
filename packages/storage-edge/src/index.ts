/**
 * @pocket/storage-edge - Edge Runtime Storage Adapters
 *
 * Provides storage adapters for edge runtime environments like Cloudflare Workers.
 *
 * @example D1 (Edge SQLite)
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createD1Storage } from '@pocket/storage-edge';
 *
 * export default {
 *   async fetch(request, env) {
 *     const db = await Database.create({
 *       name: 'my-app',
 *       storage: createD1Storage({ database: env.DB }),
 *     });
 *
 *     const users = db.collection('users');
 *     return new Response(JSON.stringify(await users.find().exec()));
 *   },
 * };
 * ```
 *
 * @example Durable Objects
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createDurableObjectStorage } from '@pocket/storage-edge';
 *
 * export class MyDurableObject {
 *   private db: Database;
 *
 *   constructor(state, env) {
 *     this.db = Database.create({
 *       name: 'my-do',
 *       storage: createDurableObjectStorage({ storage: state.storage }),
 *     });
 *   }
 *
 *   async fetch(request) {
 *     const users = this.db.collection('users');
 *     return new Response(JSON.stringify(await users.find().exec()));
 *   }
 * }
 * ```
 *
 * @module @pocket/storage-edge
 */

// D1 adapter
export { createD1Storage, type D1StorageConfig } from './d1-adapter.js';

// Durable Objects adapter
export {
  createDurableObjectStorage,
  type DurableObjectStorageConfig,
} from './durable-objects-adapter.js';

// Re-export core types
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';

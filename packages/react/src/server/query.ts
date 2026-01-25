/**
 * Server-side query utilities for React Server Components
 *
 * These utilities allow fetching Pocket data in RSC without client-side hydration.
 *
 * @module @pocket/react/server/query
 */

import type { Database, Document, StorageAdapter } from '@pocket/core';

/**
 * Server database instance cache (per-request in RSC)
 */
let serverDbInstance: Database | null = null;
let serverDbConfig: ServerDatabaseConfig | null = null;

/**
 * Server database configuration
 */
export interface ServerDatabaseConfig {
  /** Database name */
  name: string;
  /** Storage adapter (usually memory for SSR) */
  storage: StorageAdapter;
  /** Optional: Seed data for SSR */
  seedData?: Record<string, unknown[]>;
}

/**
 * Server query options
 */
export interface ServerQueryOptions<T> {
  /** Filter documents */
  filter?: Partial<T>;
  /** Sort field */
  orderBy?: keyof T | string;
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Skip results */
  offset?: number;
  /** Select specific fields */
  select?: (keyof T)[];
}

/**
 * Create a server-side database instance for RSC.
 *
 * This creates an in-memory database that can be used in Server Components.
 * The data should be seeded from your backend or static data.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { createServerDatabase } from '@pocket/react/server';
 * import { createMemoryStorage } from '@pocket/storage-memory';
 *
 * export async function initServerDb() {
 *   return createServerDatabase({
 *     name: 'my-app-server',
 *     storage: createMemoryStorage(),
 *     seedData: {
 *       users: await fetchUsersFromBackend(),
 *     },
 *   });
 * }
 * ```
 */
export async function createServerDatabase(config: ServerDatabaseConfig): Promise<Database> {
  // Avoid re-creating if config is the same
  if (serverDbInstance && serverDbConfig === config) {
    return serverDbInstance;
  }

  // Dynamically import Database to avoid bundling issues
  const { Database } = await import('@pocket/core');

  const db = await Database.create({
    name: config.name,
    storage: config.storage,
  });

  // Seed initial data if provided
  if (config.seedData) {
    for (const [collectionName, documents] of Object.entries(config.seedData)) {
      const collection = db.collection(collectionName);
      for (const doc of documents) {
        await collection.insert(doc as Document);
      }
    }
  }

  serverDbInstance = db;
  serverDbConfig = config;

  return db;
}

/**
 * Query data from a server-side database in a Server Component.
 *
 * This function is designed to be called in React Server Components.
 * It returns a Promise that resolves to the query results.
 *
 * @example
 * ```tsx
 * // app/users/page.tsx (Server Component)
 * import { createServerQuery } from '@pocket/react/server';
 *
 * export default async function UsersPage() {
 *   const users = await createServerQuery<User>(
 *     db,
 *     'users',
 *     { filter: { active: true }, orderBy: 'name', limit: 10 }
 *   );
 *
 *   return (
 *     <ul>
 *       {users.map(user => <li key={user._id}>{user.name}</li>)}
 *     </ul>
 *   );
 * }
 * ```
 */
export async function createServerQuery<T extends Document>(
  db: Database,
  collectionName: string,
  options: ServerQueryOptions<T> = {}
): Promise<T[]> {
  const collection = db.collection<T>(collectionName);

  let query = collection.find(options.filter);

  if (options.orderBy) {
    query = query.sort(options.orderBy as keyof T & string, options.orderDirection ?? 'asc');
  }

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  if (options.offset !== undefined) {
    query = query.skip(options.offset);
  }

  if (options.select) {
    // Convert string[] to projection object
    const projection: Partial<Record<keyof T, 0 | 1>> = {};
    for (const field of options.select) {
      projection[field] = 1;
    }
    query = query.select(projection);
  }

  return query.exec();
}

/**
 * Get a single document by ID in a Server Component.
 *
 * @example
 * ```tsx
 * // app/users/[id]/page.tsx (Server Component)
 * import { getServerDocument } from '@pocket/react/server';
 *
 * export default async function UserPage({ params }: { params: { id: string } }) {
 *   const user = await getServerDocument<User>(db, 'users', params.id);
 *
 *   if (!user) {
 *     notFound();
 *   }
 *
 *   return <UserProfile user={user} />;
 * }
 * ```
 */
export async function getServerDocument<T extends Document>(
  db: Database,
  collectionName: string,
  id: string
): Promise<T | null> {
  const collection = db.collection<T>(collectionName);
  return collection.get(id);
}

/**
 * Count documents in a Server Component.
 *
 * @example
 * ```tsx
 * const totalUsers = await countServerDocuments(db, 'users');
 * const activeUsers = await countServerDocuments<User>(db, 'users', { active: true });
 * ```
 */
export async function countServerDocuments<T extends Document>(
  db: Database,
  collectionName: string,
  filter?: Partial<T>
): Promise<number> {
  const collection = db.collection<T>(collectionName);
  return collection.count(filter);
}

/**
 * Helper to serialize Pocket documents for client components.
 *
 * Server Components can pass data to Client Components, but the data
 * must be serializable. This helper ensures proper serialization.
 *
 * @example
 * ```tsx
 * // Server Component
 * const users = await createServerQuery<User>(db, 'users');
 * return <ClientUserList users={serializeForClient(users)} />;
 * ```
 */
export function serializeForClient<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

import type { Collection, Database, Document } from '@pocket/core';
import { getContext, setContext } from 'svelte';
import { writable, type Readable, type Writable } from 'svelte/store';

/**
 * Pocket context key
 */
const POCKET_CONTEXT_KEY = Symbol('pocket');

/**
 * Pocket context value
 */
export interface PocketContextValue {
  database: Writable<Database | null>;
  isReady: Writable<boolean>;
  error: Writable<Error | null>;
}

/**
 * Set up the Pocket context.
 *
 * Call this in your root component to make the database available
 * to all child components via stores.
 *
 * @param databaseOrPromise - The database instance or a promise that resolves to one
 *
 * @example
 * ```svelte
 * <script>
 * import { setPocketContext } from '@pocket/svelte';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 * setPocketContext(db);
 * </script>
 *
 * <slot />
 * ```
 */
export function setPocketContext(
  databaseOrPromise: Database | Promise<Database>
): PocketContextValue {
  const database = writable<Database | null>(
    databaseOrPromise instanceof Promise ? null : databaseOrPromise
  );
  const isReady = writable(!(databaseOrPromise instanceof Promise));
  const error = writable<Error | null>(null);

  if (databaseOrPromise instanceof Promise) {
    databaseOrPromise
      .then((db) => {
        database.set(db);
        isReady.set(true);
      })
      .catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isReady.set(false);
      });
  }

  const context: PocketContextValue = {
    database,
    isReady,
    error,
  };

  setContext(POCKET_CONTEXT_KEY, context);

  return context;
}

/**
 * Get the Pocket context.
 *
 * @throws Error if used outside of a component tree with setPocketContext
 */
export function getPocketContext(): PocketContextValue {
  const context = getContext<PocketContextValue>(POCKET_CONTEXT_KEY);

  if (!context) {
    throw new Error(
      'getPocketContext must be used within a component tree that has called setPocketContext'
    );
  }

  return context;
}

/**
 * Get the database instance.
 *
 * Returns the database synchronously if available, or waits for it to be ready.
 *
 * @throws Error if database is not ready when called synchronously
 *
 * @example
 * ```svelte
 * <script>
 * import { getDatabase } from '@pocket/svelte';
 *
 * const db = getDatabase();
 * // Use db.collection(), etc.
 * </script>
 * ```
 */
export function getDatabase(): Database {
  const { database, isReady } = getPocketContext();

  let db: Database | null = null;
  let ready = false;

  database.subscribe((d) => (db = d))();
  isReady.subscribe((r) => (ready = r))();

  if (!ready || !db) {
    throw new Error('Database is not ready');
  }

  return db;
}

/**
 * Get a reactive store for the database.
 *
 * @example
 * ```svelte
 * <script>
 * import { getDatabaseStore } from '@pocket/svelte';
 *
 * const database = getDatabaseStore();
 * $: db = $database;
 * </script>
 * ```
 */
export function getDatabaseStore(): Readable<Database | null> {
  const { database } = getPocketContext();
  return database;
}

/**
 * Get the ready state store.
 *
 * @example
 * ```svelte
 * <script>
 * import { getReadyStore } from '@pocket/svelte';
 *
 * const isReady = getReadyStore();
 * </script>
 *
 * {#if !$isReady}
 *   <p>Loading...</p>
 * {:else}
 *   <App />
 * {/if}
 * ```
 */
export function getReadyStore(): Readable<boolean> {
  const { isReady } = getPocketContext();
  return isReady;
}

/**
 * Get the error store.
 */
export function getErrorStore(): Readable<Error | null> {
  const { error } = getPocketContext();
  return error;
}

/**
 * Get a collection from the database.
 *
 * @param name - The collection name
 *
 * @example
 * ```svelte
 * <script>
 * import { getCollection } from '@pocket/svelte';
 *
 * const users = getCollection('users');
 * </script>
 * ```
 */
export function getCollection<T extends Document>(name: string): Collection<T> {
  const database = getDatabase();
  return database.collection<T>(name);
}

import type { Collection, Database, Document } from '@pocket/core';
import { inject, type InjectionKey, provide, shallowRef, type ShallowRef } from 'vue';

/**
 * Pocket context value
 */
export interface PocketContextValue {
  database: ShallowRef<Database | null>;
  isReady: ShallowRef<boolean>;
  error: ShallowRef<Error | null>;
}

/**
 * Injection key for Pocket context
 */
export const PocketKey: InjectionKey<PocketContextValue> = Symbol('pocket');

/**
 * Provide Pocket database to the component tree.
 *
 * Call this in your root component's setup function to make the database
 * available to all child components via composables.
 *
 * @param databaseOrPromise - The database instance or a promise that resolves to one
 *
 * @example
 * ```vue
 * <script setup>
 * import { providePocket } from '@pocket/vue';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 * providePocket(db);
 * </script>
 * ```
 */
export function providePocket(databaseOrPromise: Database | Promise<Database>): PocketContextValue {
  const database = shallowRef<Database | null>(
    databaseOrPromise instanceof Promise ? null : databaseOrPromise
  );
  const isReady = shallowRef(!(databaseOrPromise instanceof Promise));
  const error = shallowRef<Error | null>(null);

  if (databaseOrPromise instanceof Promise) {
    databaseOrPromise
      .then((db) => {
        database.value = db;
        isReady.value = true;
      })
      .catch((err: unknown) => {
        error.value = err instanceof Error ? err : new Error(String(err));
        isReady.value = false;
      });
  }

  const context: PocketContextValue = {
    database,
    isReady,
    error,
  };

  provide(PocketKey, context);

  return context;
}

/**
 * Create a Vue plugin for Pocket.
 *
 * Use this to install Pocket globally in your Vue app.
 *
 * @param options - Plugin options including the database
 *
 * @example
 * ```typescript
 * import { createApp } from 'vue';
 * import { createPocketPlugin } from '@pocket/vue';
 * import { Database } from '@pocket/core';
 *
 * const app = createApp(App);
 *
 * const db = await Database.create({ name: 'my-app' });
 * app.use(createPocketPlugin({ database: db }));
 *
 * app.mount('#app');
 * ```
 */
export function createPocketPlugin(options: { database: Database | Promise<Database> }) {
  return {
    install(app: {
      provide: (key: InjectionKey<PocketContextValue>, value: PocketContextValue) => void;
    }) {
      const database = shallowRef<Database | null>(
        options.database instanceof Promise ? null : options.database
      );
      const isReady = shallowRef(!(options.database instanceof Promise));
      const error = shallowRef<Error | null>(null);

      if (options.database instanceof Promise) {
        options.database
          .then((db) => {
            database.value = db;
            isReady.value = true;
          })
          .catch((err: unknown) => {
            error.value = err instanceof Error ? err : new Error(String(err));
            isReady.value = false;
          });
      }

      app.provide(PocketKey, { database, isReady, error });
    },
  };
}

/**
 * Get the Pocket context.
 *
 * @throws Error if used outside of a PocketProvider
 */
export function usePocketContext(): PocketContextValue {
  const context = inject(PocketKey);

  if (!context) {
    throw new Error(
      'usePocketContext must be used within a component that has called providePocket'
    );
  }

  return context;
}

/**
 * Get the database instance.
 *
 * @throws Error if database is not ready
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDatabase } from '@pocket/vue';
 *
 * const db = useDatabase();
 * // Use db.collection(), etc.
 * </script>
 * ```
 */
export function useDatabase(): Database {
  const { database, isReady } = usePocketContext();

  if (!isReady.value || !database.value) {
    throw new Error('Database is not ready');
  }

  return database.value;
}

/**
 * Get a collection from the database.
 *
 * @param name - The collection name
 *
 * @example
 * ```vue
 * <script setup>
 * import { useCollection } from '@pocket/vue';
 *
 * interface User extends Document {
 *   name: string;
 *   email: string;
 * }
 *
 * const users = useCollection<User>('users');
 * </script>
 * ```
 */
export function useCollection<T extends Document>(name: string): Collection<T> {
  const database = useDatabase();
  return database.collection<T>(name);
}

/**
 * Check if the database is ready.
 *
 * @example
 * ```vue
 * <script setup>
 * import { usePocketReady } from '@pocket/vue';
 *
 * const { isReady, error } = usePocketReady();
 * </script>
 *
 * <template>
 *   <div v-if="!isReady">Loading...</div>
 *   <div v-else-if="error">Error: {{ error.message }}</div>
 *   <App v-else />
 * </template>
 * ```
 */
export function usePocketReady(): {
  isReady: ShallowRef<boolean>;
  error: ShallowRef<Error | null>;
} {
  const { isReady, error } = usePocketContext();
  return { isReady, error };
}

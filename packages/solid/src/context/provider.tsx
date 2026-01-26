import type { Collection, Database, Document } from '@pocket/core';
import {
  createContext,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';

/**
 * Pocket context value
 */
export interface PocketContextValue {
  database: Accessor<Database | null>;
  isReady: Accessor<boolean>;
  error: Accessor<Error | null>;
}

/**
 * Pocket context
 */
const PocketContext = createContext<PocketContextValue>();

/**
 * Provider props
 */
export interface PocketProviderProps {
  /** The Pocket database instance */
  database: Database | Promise<Database>;
  /** Children to render */
  children: JSX.Element;
  /** Loading component to show while database initializes */
  loading?: JSX.Element;
  /** Error component to show on initialization failure */
  errorComponent?: (error: Error) => JSX.Element;
}

/**
 * Pocket provider component.
 *
 * Wrap your app with this component to provide the database to all children.
 *
 * @example
 * ```tsx
 * import { PocketProvider } from '@pocket/solid';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 *
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 * ```
 */
export function PocketProvider(props: PocketProviderProps): JSX.Element {
  const [database, setDatabase] = createSignal<Database | null>(
    props.database instanceof Promise ? null : props.database
  );
  const [isReady, setIsReady] = createSignal(!(props.database instanceof Promise));
  const [error, setError] = createSignal<Error | null>(null);

  onMount(() => {
    if (props.database instanceof Promise) {
      props.database
        .then((db) => {
          setDatabase(db);
          setIsReady(true);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsReady(false);
        });
    }
  });

  const contextValue: PocketContextValue = {
    database,
    isReady,
    error,
  };

  return (
    <PocketContext.Provider value={contextValue}>
      {(() => {
        if (!isReady() && !error()) {
          return props.loading ?? null;
        }
        if (error()) {
          return props.errorComponent ? props.errorComponent(error()!) : null;
        }
        return props.children;
      })()}
    </PocketContext.Provider>
  );
}

/**
 * Get the Pocket context.
 *
 * @throws Error if used outside of a PocketProvider
 */
export function usePocketContext(): PocketContextValue {
  const context = useContext(PocketContext);

  if (!context) {
    throw new Error('usePocketContext must be used within a PocketProvider');
  }

  return context;
}

/**
 * Get the database instance.
 *
 * @throws Error if database is not ready
 *
 * @example
 * ```tsx
 * import { useDatabase } from '@pocket/solid';
 *
 * function MyComponent() {
 *   const db = useDatabase();
 *   // Use db.collection(), etc.
 * }
 * ```
 */
export function useDatabase(): Database {
  const { database, isReady } = usePocketContext();

  if (!isReady() || !database()) {
    throw new Error('Database is not ready');
  }

  return database()!;
}

/**
 * Get a collection from the database.
 *
 * @param name - The collection name
 *
 * @example
 * ```tsx
 * import { useCollection } from '@pocket/solid';
 *
 * interface User extends Document {
 *   name: string;
 *   email: string;
 * }
 *
 * function MyComponent() {
 *   const users = useCollection<User>('users');
 *   // Use users.find(), users.insert(), etc.
 * }
 * ```
 */
export function useCollection<T extends Document>(name: string): Collection<T> {
  const database = useDatabase();
  return database.collection<T>(name);
}

/**
 * Get reactive ready state.
 *
 * @example
 * ```tsx
 * import { usePocketReady } from '@pocket/solid';
 *
 * function MyComponent() {
 *   const { isReady, error } = usePocketReady();
 *
 *   return (
 *     <Show when={isReady()} fallback={<p>Loading...</p>}>
 *       <App />
 *     </Show>
 *   );
 * }
 * ```
 */
export function usePocketReady(): { isReady: Accessor<boolean>; error: Accessor<Error | null> } {
  const { isReady, error } = usePocketContext();
  return { isReady, error };
}

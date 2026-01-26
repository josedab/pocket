/**
 * React context provider for Pocket database access.
 *
 * This module provides the foundation for using Pocket in React applications:
 *
 * - {@link PocketProvider} - Context provider component
 * - {@link usePocketContext} - Low-level context access
 * - {@link useDatabase} - Get the database instance
 * - {@link useCollection} - Get a typed collection
 *
 * @module context/provider
 */

import type { Collection, Database, Document } from '@pocket/core';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * The shape of the Pocket context value.
 *
 * Most users won't need to access this directly - use the convenience
 * hooks {@link useDatabase} or {@link useCollection} instead.
 */
export interface PocketContextValue {
  /** The database instance, or null if not yet initialized */
  database: Database | null;
  /** Whether the database has finished initializing */
  isReady: boolean;
  /** Any error that occurred during initialization */
  error: Error | null;
}

/**
 * The React context for Pocket database access.
 * @internal
 */
const PocketContext = createContext<PocketContextValue | null>(null);

/**
 * Props for the {@link PocketProvider} component.
 */
export interface PocketProviderProps {
  /**
   * The Pocket database instance or a Promise that resolves to one.
   *
   * Passing a Promise enables async database initialization while
   * showing a loading state.
   *
   * @example Direct database instance
   * ```tsx
   * const db = await Database.create({ name: 'my-app' });
   * <PocketProvider database={db}>...</PocketProvider>
   * ```
   *
   * @example Promise-based (handles loading internally)
   * ```tsx
   * const dbPromise = Database.create({ name: 'my-app' });
   * <PocketProvider database={dbPromise} loading={<Spinner />}>
   *   ...
   * </PocketProvider>
   * ```
   */
  database: Database | Promise<Database>;

  /** The React children to render when the database is ready */
  children: ReactNode;

  /**
   * Optional loading component shown while database initializes.
   * Only applies when `database` is a Promise.
   */
  loading?: ReactNode;

  /**
   * Optional error component shown when initialization fails.
   * Receives the error that occurred.
   *
   * @example
   * ```tsx
   * <PocketProvider
   *   database={dbPromise}
   *   errorComponent={(err) => <ErrorScreen message={err.message} />}
   * >
   *   ...
   * </PocketProvider>
   * ```
   */
  errorComponent?: (error: Error) => ReactNode;
}

/**
 * Context provider that makes Pocket database available to child components.
 *
 * Wrap your application (or part of it) with this provider to enable
 * the use of Pocket hooks like {@link useLiveQuery} and {@link useMutation}.
 *
 * @param props - Provider configuration
 * @returns The provider component
 *
 * @example Basic usage with pre-initialized database
 * ```tsx
 * // Initialize database outside component
 * const db = await Database.create({ name: 'my-app' });
 *
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 * ```
 *
 * @example Async initialization with loading state
 * ```tsx
 * const dbPromise = Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 *
 * function App() {
 *   return (
 *     <PocketProvider
 *       database={dbPromise}
 *       loading={<LoadingScreen />}
 *       errorComponent={(err) => <ErrorScreen error={err} />}
 *     >
 *       <MainApp />
 *     </PocketProvider>
 *   );
 * }
 * ```
 *
 * @example Nested providers for separate databases
 * ```tsx
 * <PocketProvider database={mainDb}>
 *   <MainContent />
 *   <PocketProvider database={cacheDb}>
 *     <CachedContent />
 *   </PocketProvider>
 * </PocketProvider>
 * ```
 *
 * @see {@link useDatabase} for accessing the database
 * @see {@link useCollection} for accessing collections
 */
export function PocketProvider({
  database: databaseOrPromise,
  children,
  loading,
  errorComponent,
}: PocketProviderProps): React.JSX.Element {
  const [database, setDatabase] = useState<Database | null>(
    databaseOrPromise instanceof Promise ? null : databaseOrPromise
  );
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(!(databaseOrPromise instanceof Promise));

  useEffect(() => {
    if (databaseOrPromise instanceof Promise) {
      databaseOrPromise
        .then((db) => {
          setDatabase(db);
          setIsReady(true);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsReady(false);
        });
    }
  }, [databaseOrPromise]);

  const contextValue: PocketContextValue = {
    database,
    isReady,
    error,
  };

  // Show loading state
  if (!isReady && !error) {
    return <>{loading ?? null}</>;
  }

  // Show error state
  if (error) {
    return <>{errorComponent ? errorComponent(error) : null}</>;
  }

  return <PocketContext.Provider value={contextValue}>{children}</PocketContext.Provider>;
}

/**
 * Hook to access the raw Pocket context value.
 *
 * For most use cases, prefer the higher-level {@link useDatabase}
 * or {@link useCollection} hooks instead.
 *
 * @returns The context value containing database, isReady, and error
 * @throws Error if used outside of a {@link PocketProvider}
 *
 * @example Checking initialization state
 * ```tsx
 * function DatabaseStatus() {
 *   const { isReady, error } = usePocketContext();
 *
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!isReady) return <Loading />;
 *   return <Connected />;
 * }
 * ```
 */
export function usePocketContext(): PocketContextValue {
  const context = useContext(PocketContext);

  if (!context) {
    throw new Error('usePocketContext must be used within a PocketProvider');
  }

  return context;
}

/**
 * Hook to get the Pocket database instance.
 *
 * Throws an error if the database is not yet initialized. For async-safe
 * access, use {@link usePocketContext} and check `isReady` first.
 *
 * @returns The initialized Database instance
 * @throws Error if called before database is ready or outside provider
 *
 * @example Direct database access
 * ```tsx
 * function ExportButton() {
 *   const db = useDatabase();
 *
 *   const handleExport = async () => {
 *     const allData = await db.collection('todos').find().exec();
 *     downloadJSON(allData);
 *   };
 *
 *   return <button onClick={handleExport}>Export</button>;
 * }
 * ```
 *
 * @example Accessing multiple collections
 * ```tsx
 * function Dashboard() {
 *   const db = useDatabase();
 *
 *   const users = db.collection<User>('users');
 *   const posts = db.collection<Post>('posts');
 *
 *   // Now you can use these collections...
 * }
 * ```
 *
 * @see {@link useCollection} for getting a specific collection directly
 */
export function useDatabase(): Database {
  const { database, isReady } = usePocketContext();

  if (!isReady || !database) {
    throw new Error('Database is not ready');
  }

  return database;
}

/**
 * Hook to get a typed collection from the database.
 *
 * This is the most common way to access collections in React components.
 * The collection is memoized based on the collection name.
 *
 * @typeParam T - The document type for the collection
 * @param name - The name of the collection to access
 * @returns A typed Collection instance
 * @throws Error if called before database is ready or outside provider
 *
 * @example Basic usage
 * ```tsx
 * interface Todo {
 *   _id: string;
 *   title: string;
 *   completed: boolean;
 * }
 *
 * function TodoList() {
 *   const todos = useCollection<Todo>('todos');
 *
 *   // Now you can use the collection
 *   const handleAdd = async (title: string) => {
 *     await todos.insert({ title, completed: false });
 *   };
 *
 *   return <AddTodoForm onAdd={handleAdd} />;
 * }
 * ```
 *
 * @see {@link useLiveQuery} for reactive queries on collections
 * @see {@link useMutation} for collection mutations with loading state
 */
export function useCollection<T extends Document>(name: string): Collection<T> {
  const database = useDatabase();
  return database.collection<T>(name);
}

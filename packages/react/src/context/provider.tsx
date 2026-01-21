import type { Collection, Database, Document } from '@pocket/core';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Pocket context value
 */
export interface PocketContextValue {
  database: Database | null;
  isReady: boolean;
  error: Error | null;
}

/**
 * Pocket context
 */
const PocketContext = createContext<PocketContextValue | null>(null);

/**
 * Provider props
 */
export interface PocketProviderProps {
  /** The Pocket database instance */
  database: Database | Promise<Database>;
  /** Children to render */
  children: ReactNode;
  /** Loading component to show while database initializes */
  loading?: ReactNode;
  /** Error component to show on initialization failure */
  errorComponent?: (error: Error) => ReactNode;
}

/**
 * Pocket provider component
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
 * Hook to get the Pocket context
 */
export function usePocketContext(): PocketContextValue {
  const context = useContext(PocketContext);

  if (!context) {
    throw new Error('usePocketContext must be used within a PocketProvider');
  }

  return context;
}

/**
 * Hook to get the database instance
 */
export function useDatabase(): Database {
  const { database, isReady } = usePocketContext();

  if (!isReady || !database) {
    throw new Error('Database is not ready');
  }

  return database;
}

/**
 * Hook to get a collection
 */
export function useCollection<T extends Document>(name: string): Collection<T> {
  const database = useDatabase();
  return database.collection<T>(name);
}

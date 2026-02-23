import type { HydrationProps } from './types.js';

/**
 * Dependency-injection interface for React hooks, allowing this module
 * to work without a direct React import.
 */
export interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
}

export interface HydrationProvider {
  initialData: Map<string, unknown[]>;
  serverTimestamp: number;
  get<T = unknown>(collection: string): T[] | undefined;
}

export interface HydratedQueryResult<T> {
  data: T[];
  isHydrated: boolean;
  isLive: boolean;
}

/**
 * Create a hydration provider from server-rendered props.
 */
export function createHydrationProvider(props: HydrationProps): HydrationProvider {
  return {
    initialData: props.initialData,
    serverTimestamp: props.serverTimestamp,
    get<T = unknown>(collection: string): T[] | undefined {
      return props.initialData.get(collection) as T[] | undefined;
    },
  };
}

/**
 * Factory that returns a `useHydratedQuery` hook wired to the provided
 * React-like hooks interface (DI pattern).
 */
export function createUseHydratedQueryHook(React: ReactHooks) {
  /**
   * Hook that starts with server-provided data and transitions to live
   * local query results once the client is ready.
   */
  return function useHydratedQuery<T = unknown>(
    provider: HydrationProvider,
    collection: string,
    _filter?: Record<string, unknown>,
  ): HydratedQueryResult<T> {
    const serverData = provider.get<T>(collection) ?? [];

    const [data, setData] = React.useState<T[]>(serverData);
    const [isLive, setIsLive] = React.useState(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
      mountedRef.current = true;

      // Simulate transition to live data on the client side.
      // In a full implementation this would subscribe to the local Pocket DB.
      setData(serverData);
      setIsLive(true);

      return () => {
        mountedRef.current = false;
      };
    }, [collection]);

    return {
      data,
      isHydrated: data === serverData,
      isLive,
    };
  };
}

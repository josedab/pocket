/**
 * React hooks for Query Subscriptions
 */

import type { QuerySubscription, QuerySubscriptionManager } from './query-subscription.js';
import type {
  QueryDefinition,
  QueryOptions,
  QueryResult,
  QuerySubscriptionEvent,
} from './types.js';

/**
 * React hooks interface for dependency injection
 */
export interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useMemo<T>(fn: () => T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
}

/**
 * Return type for useQuery hook
 */
export interface UseQueryReturn<T extends Record<string, unknown>> {
  /** Query result data */
  data: T[];
  /** Full result with metadata */
  result: QueryResult<T>;
  /** Whether query is loading */
  loading: boolean;
  /** Query error */
  error: Error | null;
  /** Total count of matching documents */
  total: number;
  /** Whether more results are available */
  hasMore: boolean;
  /** Refresh the query */
  refresh: () => void;
  /** Load more results (pagination) */
  loadMore: () => void;
}

/**
 * Return type for useLiveQuery hook
 */
export interface UseLiveQueryReturn<T extends Record<string, unknown>> extends UseQueryReturn<T> {
  /** Query subscription events */
  events: QuerySubscriptionEvent<T>[];
  /** Clear events */
  clearEvents: () => void;
}

/**
 * Factory to create useQuery hook
 */
export function createUseQueryHook(React: ReactHooks) {
  return function useQuery<T extends Record<string, unknown>>(
    manager: QuerySubscriptionManager<T>,
    query: QueryDefinition,
    options: QueryOptions = {}
  ): UseQueryReturn<T> {
    const [result, setResult] = React.useState<QueryResult<T>>(() =>
      manager.execute(query, options)
    );
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<Error | null>(null);

    const queryRef = React.useRef(query);
    queryRef.current = query;

    React.useEffect(() => {
      setLoading(true);
      try {
        const newResult = manager.execute(queryRef.current, options);
        setResult(newResult);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Query failed'));
      } finally {
        setLoading(false);
      }
      return undefined;
    }, [manager, JSON.stringify(query), JSON.stringify(options)]);

    const refresh = React.useCallback(() => {
      setLoading(true);
      try {
        const newResult = manager.execute(queryRef.current, { ...options, skipCache: true });
        setResult(newResult);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Query failed'));
      } finally {
        setLoading(false);
      }
    }, [manager, options]) as () => void;

    const loadMore = React.useCallback(() => {
      if (!result.hasMore || !result.cursor) return;

      const paginatedQuery: QueryDefinition = {
        ...queryRef.current,
        pagination: {
          ...queryRef.current.pagination,
          cursor: result.cursor,
        },
      };

      try {
        const moreResult = manager.execute(paginatedQuery, options);
        setResult((prev) => ({
          ...moreResult,
          data: [...prev.data, ...moreResult.data],
        }));
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Load more failed'));
      }
    }, [manager, result, options]) as () => void;

    return {
      data: result.data,
      result,
      loading,
      error,
      total: result.total ?? 0,
      hasMore: result.hasMore ?? false,
      refresh,
      loadMore,
    };
  };
}

/**
 * Factory to create useLiveQuery hook
 */
export function createUseLiveQueryHook(React: ReactHooks) {
  return function useLiveQuery<T extends Record<string, unknown>>(
    manager: QuerySubscriptionManager<T>,
    query: QueryDefinition,
    options: QueryOptions = {}
  ): UseLiveQueryReturn<T> {
    const [result, setResult] = React.useState<QueryResult<T>>({
      data: [],
      total: 0,
      hasMore: false,
    });
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<Error | null>(null);
    const [events, setEvents] = React.useState<QuerySubscriptionEvent<T>[]>([]);

    const subscriptionRef = React.useRef<QuerySubscription<T> | null>(null);

    React.useEffect(() => {
      setLoading(true);

      try {
        // Create live subscription
        const liveQuery: QueryDefinition = { ...query, live: true };
        const subscription = manager.subscribe(liveQuery, options);
        subscriptionRef.current = subscription;

        // Subscribe to result changes
        const resultSub = subscription.result.subscribe((newResult: QueryResult<T>) => {
          setResult(newResult);
          setLoading(false);
        });

        // Subscribe to events
        const eventSub = subscription.events.subscribe((event: QuerySubscriptionEvent<T>) => {
          setEvents((prev) => [...prev.slice(-99), event]);
        });

        return () => {
          resultSub.unsubscribe();
          eventSub.unsubscribe();
          manager.unsubscribe(liveQuery);
        };
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Subscription failed'));
        setLoading(false);
        return undefined;
      }
    }, [manager, JSON.stringify(query), JSON.stringify(options)]);

    const refresh = React.useCallback(() => {
      subscriptionRef.current?.refresh();
    }, []) as () => void;

    const loadMore = React.useCallback(() => {
      // For live queries, we need to update the subscription's query
      // This is a simplified implementation
      console.warn('loadMore not fully implemented for live queries');
    }, []) as () => void;

    const clearEvents = React.useCallback(() => {
      setEvents([]);
    }, []) as () => void;

    return {
      data: result.data,
      result,
      loading,
      error,
      total: result.total ?? 0,
      hasMore: result.hasMore ?? false,
      refresh,
      loadMore,
      events,
      clearEvents,
    };
  };
}

/**
 * Factory to create useQuerySubscription hook
 */
export function createUseQuerySubscriptionHook(React: ReactHooks) {
  return function useQuerySubscription<T extends Record<string, unknown>>(
    subscription: QuerySubscription<T>
  ): QueryResult<T> {
    const [result, setResult] = React.useState<QueryResult<T>>(() => subscription.getResult());

    React.useEffect(() => {
      const sub = subscription.result.subscribe((newResult: QueryResult<T>) => {
        setResult(newResult);
      });

      return () => sub.unsubscribe();
    }, [subscription]);

    return result;
  };
}

/**
 * Factory to create useQueryData hook (just the data array)
 */
export function createUseQueryDataHook(React: ReactHooks) {
  return function useQueryData<T extends Record<string, unknown>>(
    subscription: QuerySubscription<T>
  ): T[] {
    const [data, setData] = React.useState<T[]>(() => subscription.getResult().data);

    React.useEffect(() => {
      const sub = subscription.data.subscribe((newData: T[]) => {
        setData(newData);
      });

      return () => sub.unsubscribe();
    }, [subscription]);

    return data;
  };
}

/**
 * Factory to create useQueryEvents hook
 */
export function createUseQueryEventsHook(React: ReactHooks) {
  return function useQueryEvents<T extends Record<string, unknown>>(
    subscription: QuerySubscription<T>,
    handlers: {
      onAdded?: (doc: T) => void;
      onModified?: (doc: T) => void;
      onRemoved?: (doc: T) => void;
      onReset?: (docs: T[]) => void;
    }
  ): void {
    React.useEffect(() => {
      const sub = subscription.events.subscribe((event: QuerySubscriptionEvent<T>) => {
        switch (event.type) {
          case 'added':
            if (event.document) handlers.onAdded?.(event.document);
            break;
          case 'modified':
            if (event.document) handlers.onModified?.(event.document);
            break;
          case 'removed':
            if (event.document) handlers.onRemoved?.(event.document);
            break;
          case 'reset':
            handlers.onReset?.(event.documents);
            break;
        }
      });

      return () => sub.unsubscribe();
    }, [subscription, handlers]);
  };
}

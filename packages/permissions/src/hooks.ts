/**
 * React hooks for Permissions
 */

import type { PermissionManager } from './permission-manager.js';
import type {
  PermissionAction,
  PermissionCheckResult,
  PermissionEvent,
  Resource,
  UserContext,
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
 * Return type for usePermission hook
 */
export interface UsePermissionReturn {
  /** Whether permission is granted */
  allowed: boolean;
  /** Full check result */
  result: PermissionCheckResult | null;
  /** Loading state */
  loading: boolean;
  /** Recheck permission */
  recheck: () => void;
}

/**
 * Return type for usePermissions hook
 */
export interface UsePermissionsReturn {
  /** Check a permission */
  can: (action: PermissionAction, resource: Resource) => boolean;
  /** Check multiple permissions */
  canAll: (checks: { action: PermissionAction; resource: Resource }[]) => boolean;
  /** Check any permission */
  canAny: (checks: { action: PermissionAction; resource: Resource }[]) => boolean;
  /** Get full check result */
  check: (action: PermissionAction, resource: Resource) => PermissionCheckResult;
  /** Filter documents */
  filter: <T extends Record<string, unknown>>(
    collection: string,
    documents: T[],
    action?: PermissionAction
  ) => T[];
}

/**
 * Return type for usePermissionEvents hook
 */
export interface UsePermissionEventsReturn {
  /** Recent events */
  events: PermissionEvent[];
  /** Clear events */
  clearEvents: () => void;
}

/**
 * Factory to create usePermission hook
 */
export function createUsePermissionHook(React: ReactHooks) {
  return function usePermission(
    manager: PermissionManager,
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource
  ): UsePermissionReturn {
    const [result, setResult] = React.useState<PermissionCheckResult | null>(null);
    const [loading, setLoading] = React.useState(true);

    const check = React.useCallback(() => {
      setLoading(true);
      const checkResult = manager.check(userContext, action, resource);
      setResult(checkResult);
      setLoading(false);
    }, [manager, userContext, action, resource]);

    React.useEffect(() => {
      check();
      return undefined;
    }, [check]);

    // Subscribe to config changes to recheck
    React.useEffect(() => {
      const subscription = manager.config$Observable.subscribe(() => {
        check();
      });

      return () => subscription.unsubscribe();
    }, [manager, check]);

    const recheck = React.useCallback(() => {
      check();
    }, [check]) as () => void;

    return {
      allowed: result?.allowed ?? false,
      result,
      loading,
      recheck,
    };
  };
}

/**
 * Factory to create usePermissions hook
 */
export function createUsePermissionsHook(React: ReactHooks) {
  return function usePermissions(
    manager: PermissionManager,
    userContext: UserContext
  ): UsePermissionsReturn {
    // Force re-render when config changes
    const [, setVersion] = React.useState(0);

    React.useEffect(() => {
      const subscription = manager.config$Observable.subscribe(() => {
        setVersion((v) => v + 1);
      });

      return () => subscription.unsubscribe();
    }, [manager]);

    const can = React.useCallback(
      (action: PermissionAction, resource: Resource) => {
        return manager.can(userContext, action, resource);
      },
      [manager, userContext]
    ) as (action: PermissionAction, resource: Resource) => boolean;

    const canAll = React.useCallback(
      (checks: { action: PermissionAction; resource: Resource }[]) => {
        return checks.every(({ action, resource }) => manager.can(userContext, action, resource));
      },
      [manager, userContext]
    ) as (checks: { action: PermissionAction; resource: Resource }[]) => boolean;

    const canAny = React.useCallback(
      (checks: { action: PermissionAction; resource: Resource }[]) => {
        return checks.some(({ action, resource }) => manager.can(userContext, action, resource));
      },
      [manager, userContext]
    ) as (checks: { action: PermissionAction; resource: Resource }[]) => boolean;

    const check = React.useCallback(
      (action: PermissionAction, resource: Resource) => {
        return manager.check(userContext, action, resource);
      },
      [manager, userContext]
    ) as (action: PermissionAction, resource: Resource) => PermissionCheckResult;

    const filter = React.useCallback(
      <T extends Record<string, unknown>>(
        collection: string,
        documents: T[],
        action: PermissionAction = 'read'
      ) => {
        return manager.filter(userContext, collection, documents, action);
      },
      [manager, userContext]
    ) as <T extends Record<string, unknown>>(
      collection: string,
      documents: T[],
      action?: PermissionAction
    ) => T[];

    return {
      can,
      canAll,
      canAny,
      check,
      filter,
    };
  };
}

/**
 * Factory to create usePermissionEvents hook
 */
export function createUsePermissionEventsHook(React: ReactHooks) {
  return function usePermissionEvents(
    manager: PermissionManager,
    maxEvents = 100
  ): UsePermissionEventsReturn {
    const [events, setEvents] = React.useState<PermissionEvent[]>([]);

    React.useEffect(() => {
      const subscription = manager.events.subscribe((event: PermissionEvent) => {
        setEvents((prev) => [...prev.slice(-(maxEvents - 1)), event]);
      });

      return () => subscription.unsubscribe();
    }, [manager, maxEvents]);

    const clearEvents = React.useCallback(() => {
      setEvents([]);
    }, []) as () => void;

    return {
      events,
      clearEvents,
    };
  };
}

/**
 * Factory to create Can component
 */
export function createCanComponent(
  _React: ReactHooks,
  usePermission: ReturnType<typeof createUsePermissionHook>
) {
  return function Can({
    manager,
    userContext,
    action,
    resource,
    children,
    fallback = null,
  }: {
    manager: PermissionManager;
    userContext: UserContext;
    action: PermissionAction;
    resource: Resource;
    children: unknown;
    fallback?: unknown;
  }): unknown {
    const { allowed, loading } = usePermission(manager, userContext, action, resource);

    if (loading) return null;
    return allowed ? children : fallback;
  };
}

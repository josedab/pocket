/**
 * React hooks for Cross-Tab Sync
 */

import type { CrossTabSync } from './cross-tab-sync.js';
import type { DistributedLockManager } from './distributed-lock.js';
import type { LeaderElection } from './leader-election.js';
import type { TabManager } from './tab-manager.js';
import type {
  CollectionSyncState,
  CrossTabEvent,
  CrossTabMessage,
  DistributedLock,
  LeaderState,
  TabInfo,
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
 * Return type for useTabs hook
 */
export interface UseTabsReturn {
  /** This tab's ID */
  tabId: string;
  /** All known tabs */
  tabs: TabInfo[];
  /** This tab's info */
  thisTab: TabInfo;
  /** Update this tab's metadata */
  updateMetadata: (metadata: Record<string, unknown>) => void;
}

/**
 * Return type for useLeader hook
 */
export interface UseLeaderReturn {
  /** Whether this tab is the leader */
  isLeader: boolean;
  /** Current leader tab ID */
  leaderId: string | null;
  /** Leader state */
  state: LeaderState;
  /** Request leadership */
  requestLeadership: () => void;
  /** Abdicate leadership */
  abdicate: () => void;
}

/**
 * Return type for useCrossTabSync hook
 */
export interface UseCrossTabSyncReturn {
  /** Broadcast a change */
  broadcastChange: (collection: string, id: string, data: Record<string, unknown>) => void;
  /** Broadcast a delete */
  broadcastDelete: (collection: string, id: string) => void;
  /** Broadcast a clear */
  broadcastClear: (collection: string) => void;
  /** Request sync */
  requestSync: (collection: string, since?: number) => void;
  /** Get sync state */
  getSyncState: (collection: string) => CollectionSyncState | undefined;
}

/**
 * Return type for useDistributedLock hook
 */
export interface UseDistributedLockReturn {
  /** Whether the lock is held */
  isLocked: boolean;
  /** Whether this tab holds the lock */
  isHeldByMe: boolean;
  /** Lock info */
  lock: DistributedLock | undefined;
  /** Acquire the lock */
  acquire: () => Promise<boolean>;
  /** Release the lock */
  release: () => void;
}

/**
 * Factory to create useTabs hook
 */
export function createUseTabsHook(React: ReactHooks) {
  return function useTabs(tabManager: TabManager): UseTabsReturn {
    const [tabs, setTabs] = React.useState<TabInfo[]>(() => tabManager.getTabs());

    React.useEffect(() => {
      const subscription = tabManager.tabs.subscribe((tabMap: Map<string, TabInfo>) => {
        setTabs(Array.from(tabMap.values()));
      });

      return () => subscription.unsubscribe();
    }, [tabManager]);

    const tabId = React.useMemo(() => tabManager.getTabId(), [tabManager]);

    const thisTab = React.useMemo(() => tabManager.getThisTabInfo(), [tabManager]);

    const updateMetadata = React.useCallback(
      (metadata: Record<string, unknown>) => {
        tabManager.updateMetadata(metadata);
      },
      [tabManager]
    ) as (metadata: Record<string, unknown>) => void;

    return {
      tabId,
      tabs,
      thisTab,
      updateMetadata,
    };
  };
}

/**
 * Factory to create useLeader hook
 */
export function createUseLeaderHook(React: ReactHooks) {
  return function useLeader(leaderElection: LeaderElection): UseLeaderReturn {
    const [state, setState] = React.useState<LeaderState>(() => leaderElection.getState());

    React.useEffect(() => {
      const subscription = leaderElection.state.subscribe((newState: LeaderState) => {
        setState(newState);
      });

      return () => subscription.unsubscribe();
    }, [leaderElection]);

    const requestLeadership = React.useCallback(() => {
      leaderElection.requestLeadership();
    }, [leaderElection]) as () => void;

    const abdicate = React.useCallback(() => {
      leaderElection.abdicate();
    }, [leaderElection]) as () => void;

    return {
      isLeader: state.isLeader,
      leaderId: state.leaderId,
      state,
      requestLeadership,
      abdicate,
    };
  };
}

/**
 * Factory to create useCrossTabEvents hook
 */
export function createUseCrossTabEventsHook(React: ReactHooks) {
  return function useCrossTabEvents(
    tabManager: TabManager,
    handlers: {
      onTabJoined?: (tabId: string, info: TabInfo) => void;
      onTabLeft?: (tabId: string) => void;
      onLeaderChanged?: (leaderId: string) => void;
      onMessage?: (event: CrossTabEvent) => void;
    }
  ): void {
    React.useEffect(() => {
      const subscription = tabManager.events.subscribe((event: CrossTabEvent) => {
        switch (event.type) {
          case 'tab-joined':
            handlers.onTabJoined?.(event.tabId!, event.data as TabInfo);
            break;
          case 'tab-left':
            handlers.onTabLeft?.(event.tabId!);
            break;
          case 'leader-changed':
            handlers.onLeaderChanged?.(event.tabId!);
            break;
          default:
            handlers.onMessage?.(event);
        }
      });

      return () => subscription.unsubscribe();
    }, [tabManager, handlers]);
  };
}

/**
 * Factory to create useCrossTabSync hook
 */
export function createUseCrossTabSyncHook(React: ReactHooks) {
  return function useCrossTabSync(
    crossTabSync: CrossTabSync,
    collection: string,
    onMessage?: (message: CrossTabMessage) => void
  ): UseCrossTabSyncReturn {
    const [syncState, setSyncState] = React.useState<CollectionSyncState | undefined>(() =>
      crossTabSync.getCollectionSyncState(collection)
    );

    React.useEffect(() => {
      const unsubscribe = crossTabSync.subscribe(collection, (message: CrossTabMessage) => {
        onMessage?.(message);
      });

      const stateSubscription = crossTabSync.syncState.subscribe(
        (state: Map<string, CollectionSyncState>) => {
          setSyncState(state.get(collection));
        }
      );

      return () => {
        unsubscribe();
        stateSubscription.unsubscribe();
      };
    }, [crossTabSync, collection, onMessage]);

    const broadcastChange = React.useCallback(
      (col: string, id: string, data: Record<string, unknown>) => {
        crossTabSync.broadcastChange(col, id, data);
      },
      [crossTabSync]
    ) as (col: string, id: string, data: Record<string, unknown>) => void;

    const broadcastDelete = React.useCallback(
      (col: string, id: string) => {
        crossTabSync.broadcastDelete(col, id);
      },
      [crossTabSync]
    ) as (col: string, id: string) => void;

    const broadcastClear = React.useCallback(
      (col: string) => {
        crossTabSync.broadcastClear(col);
      },
      [crossTabSync]
    ) as (col: string) => void;

    const requestSync = React.useCallback(
      (col: string, since?: number) => {
        crossTabSync.requestSync(col, since);
      },
      [crossTabSync]
    ) as (col: string, since?: number) => void;

    const getSyncState = React.useCallback(
      (col: string) => {
        return crossTabSync.getCollectionSyncState(col);
      },
      [crossTabSync]
    ) as (col: string) => CollectionSyncState | undefined;

    // Trigger sync state update
    React.useMemo(() => syncState, [syncState]);

    return {
      broadcastChange,
      broadcastDelete,
      broadcastClear,
      requestSync,
      getSyncState,
    };
  };
}

/**
 * Factory to create useDistributedLock hook
 */
export function createUseDistributedLockHook(React: ReactHooks) {
  return function useDistributedLock(
    lockManager: DistributedLockManager,
    resource: string
  ): UseDistributedLockReturn {
    const [locks, setLocks] = React.useState<Map<string, DistributedLock>>(() => new Map());

    React.useEffect(() => {
      const subscription = lockManager.locks.subscribe((newLocks: Map<string, DistributedLock>) => {
        setLocks(newLocks);
      });

      return () => subscription.unsubscribe();
    }, [lockManager]);

    const lock = React.useMemo(() => locks.get(resource), [locks, resource]);

    const isLocked = React.useMemo(() => lockManager.isLocked(resource), [lockManager, resource]);

    const isHeldByMe = React.useMemo(
      () => lockManager.isHeldByMe(resource),
      [lockManager, resource]
    );

    const acquire = React.useCallback(async () => {
      return lockManager.acquire(resource);
    }, [lockManager, resource]) as () => Promise<boolean>;

    const release = React.useCallback(() => {
      lockManager.release(resource);
    }, [lockManager, resource]) as () => void;

    return {
      isLocked,
      isHeldByMe,
      lock,
      acquire,
      release,
    };
  };
}

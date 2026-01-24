/**
 * React hooks for Analytics
 */

import type { AnalyticsTracker } from './analytics-tracker.js';
import type {
  AnalyticsEvent,
  InternalAnalyticsEvent,
  MetricAggregation,
  Session,
  SyncStatus,
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
 * Return type for useAnalytics hook
 */
export interface UseAnalyticsReturn {
  /** Track an event */
  track: (name: string, properties?: Record<string, unknown>) => void;
  /** Identify a user */
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  /** Track a page view */
  page: (name?: string, properties?: Record<string, unknown>) => void;
  /** Track a screen view */
  screen: (name: string, properties?: Record<string, unknown>) => void;
  /** Track an error */
  trackError: (error: Error, properties?: Record<string, unknown>) => void;
  /** Record a metric */
  recordMetric: (name: string, value: number, unit?: string, tags?: Record<string, string>) => void;
  /** Reset user */
  reset: () => void;
  /** Flush events */
  flush: () => Promise<void>;
  /** Current user ID */
  userId: string | null;
  /** Anonymous ID */
  anonymousId: string;
  /** Current session */
  session: Session;
}

/**
 * Return type for useAnalyticsEvents hook
 */
export interface UseAnalyticsEventsReturn {
  /** Recent events */
  events: AnalyticsEvent[];
  /** Event count */
  eventCount: number;
  /** Clear events */
  clearEvents: () => void;
}

/**
 * Return type for useSyncStatus hook
 */
export interface UseSyncStatusReturn {
  /** Sync status */
  status: SyncStatus;
  /** Whether syncing */
  syncing: boolean;
  /** Pending count */
  pendingCount: number;
  /** Last sync time */
  lastSyncAt: number | null;
  /** Last error */
  lastError: string | null;
}

/**
 * Factory to create useAnalytics hook
 */
export function createUseAnalyticsHook(React: ReactHooks) {
  return function useAnalytics(tracker: AnalyticsTracker): UseAnalyticsReturn {
    const [session, setSession] = React.useState<Session>(() => tracker.getSession());

    // Update session periodically
    React.useEffect(() => {
      const interval = setInterval(() => {
        setSession(tracker.getSession());
      }, 1000);

      return () => clearInterval(interval);
    }, [tracker]);

    const track = React.useCallback(
      (name: string, properties?: Record<string, unknown>) => {
        tracker.track(name, properties);
      },
      [tracker]
    ) as (name: string, properties?: Record<string, unknown>) => void;

    const identify = React.useCallback(
      (userId: string, traits?: Record<string, unknown>) => {
        tracker.identify(userId, traits);
      },
      [tracker]
    ) as (userId: string, traits?: Record<string, unknown>) => void;

    const page = React.useCallback(
      (name?: string, properties?: Record<string, unknown>) => {
        tracker.page(name, properties);
      },
      [tracker]
    ) as (name?: string, properties?: Record<string, unknown>) => void;

    const screen = React.useCallback(
      (name: string, properties?: Record<string, unknown>) => {
        tracker.screen(name, properties);
      },
      [tracker]
    ) as (name: string, properties?: Record<string, unknown>) => void;

    const trackError = React.useCallback(
      (error: Error, properties?: Record<string, unknown>) => {
        tracker.trackError(error, properties);
      },
      [tracker]
    ) as (error: Error, properties?: Record<string, unknown>) => void;

    const recordMetric = React.useCallback(
      (name: string, value: number, unit?: string, tags?: Record<string, string>) => {
        tracker.recordMetric(name, value, unit, tags);
      },
      [tracker]
    ) as (name: string, value: number, unit?: string, tags?: Record<string, string>) => void;

    const reset = React.useCallback(() => {
      tracker.reset();
    }, [tracker]) as () => void;

    const flush = React.useCallback(async () => {
      await tracker.flush();
    }, [tracker]) as () => Promise<void>;

    return {
      track,
      identify,
      page,
      screen,
      trackError,
      recordMetric,
      reset,
      flush,
      userId: tracker.getUserId(),
      anonymousId: tracker.getAnonymousId(),
      session,
    };
  };
}

/**
 * Factory to create useAnalyticsEvents hook
 */
export function createUseAnalyticsEventsHook(React: ReactHooks) {
  return function useAnalyticsEvents(
    tracker: AnalyticsTracker,
    maxEvents = 100
  ): UseAnalyticsEventsReturn {
    const [events, setEvents] = React.useState<AnalyticsEvent[]>([]);
    const store = tracker.getStore();

    React.useEffect(() => {
      // Load initial events
      setEvents(store.getEvents().slice(-maxEvents));

      // Subscribe to new events
      const subscription = tracker.events.subscribe((internalEvent: InternalAnalyticsEvent) => {
        setEvents((prev) => [...prev.slice(-(maxEvents - 1)), internalEvent.event]);
      });

      return () => subscription.unsubscribe();
    }, [tracker, store, maxEvents]);

    const clearEvents = React.useCallback(() => {
      store.clearAllEvents();
      setEvents([]);
    }, [store]) as () => void;

    return {
      events,
      eventCount: events.length,
      clearEvents,
    };
  };
}

/**
 * Factory to create useSyncStatus hook
 */
export function createUseSyncStatusHook(React: ReactHooks) {
  return function useSyncStatus(tracker: AnalyticsTracker): UseSyncStatusReturn {
    const store = tracker.getStore();
    const [status, setStatus] = React.useState<SyncStatus>(() => store.getSyncStatus());

    React.useEffect(() => {
      const subscription = store.syncStatus.subscribe((newStatus: SyncStatus) => {
        setStatus(newStatus);
      });

      return () => subscription.unsubscribe();
    }, [store]);

    return {
      status,
      syncing: status.syncing,
      pendingCount: status.pendingCount,
      lastSyncAt: status.lastSyncAt,
      lastError: status.lastError,
    };
  };
}

/**
 * Factory to create useMetric hook
 */
export function createUseMetricHook(React: ReactHooks) {
  return function useMetric(
    tracker: AnalyticsTracker,
    metricName: string,
    startTime?: number,
    endTime?: number
  ): MetricAggregation | null {
    const [aggregation, setAggregation] = React.useState<MetricAggregation | null>(() =>
      tracker.getMetricAggregations(metricName, startTime, endTime)
    );

    // Update on new events
    React.useEffect(() => {
      const subscription = tracker.events.subscribe((event: InternalAnalyticsEvent) => {
        if (event.event.name === '$metric' && event.event.properties.metricName === metricName) {
          setAggregation(tracker.getMetricAggregations(metricName, startTime, endTime));
        }
      });

      return () => subscription.unsubscribe();
    }, [tracker, metricName, startTime, endTime]);

    return aggregation;
  };
}

/**
 * Factory to create usePageTracking hook
 */
export function createUsePageTrackingHook(React: ReactHooks) {
  return function usePageTracking(
    tracker: AnalyticsTracker,
    pageName?: string,
    properties?: Record<string, unknown>
  ): void {
    React.useEffect(() => {
      tracker.page(pageName, properties);
      return undefined;
    }, [tracker, pageName, JSON.stringify(properties)]);
  };
}

/**
 * Factory to create useEventTracking hook (for tracking on mount/unmount)
 */
export function createUseEventTrackingHook(React: ReactHooks) {
  return function useEventTracking(
    tracker: AnalyticsTracker,
    mountEvent: { name: string; properties?: Record<string, unknown> },
    unmountEvent?: { name: string; properties?: Record<string, unknown> }
  ): void {
    React.useEffect(() => {
      tracker.track(mountEvent.name, mountEvent.properties);

      return () => {
        if (unmountEvent) {
          tracker.track(unmountEvent.name, unmountEvent.properties);
        }
      };
    }, [tracker, mountEvent.name, unmountEvent?.name]);
  };
}

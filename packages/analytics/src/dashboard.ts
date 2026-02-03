/**
 * DashboardDataProvider - Analytics dashboard data providers for Pocket.
 *
 * Provides pre-computed funnel, retention, time series, and summary data
 * suitable for rendering analytics dashboards, with configurable caching.
 *
 * @packageDocumentation
 * @module @pocket/analytics/dashboard
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Date range for queries */
export interface DateRange {
  /** Start timestamp */
  start: number;
  /** End timestamp */
  end: number;
}

/** Funnel step result */
export interface DashboardFunnelStep {
  /** Step name */
  name: string;
  /** Number of users/sessions at this step */
  count: number;
  /** Conversion rate from previous step (1.0 for first step) */
  conversionRate: number;
  /** Dropoff rate from previous step (0.0 for first step) */
  dropoffRate: number;
}

/** Retention cohort data */
export interface DashboardRetentionCohort {
  /** Cohort label (date string) */
  cohortDate: string;
  /** Number of users in cohort */
  cohortSize: number;
  /** Retention per period */
  periods: {
    period: number;
    retained: number;
    retentionRate: number;
  }[];
}

/** Time series data point */
export interface TimeSeriesPoint {
  /** Timestamp for this point */
  timestamp: number;
  /** Metric value */
  value: number;
  /** Human-readable label */
  label: string;
}

/** Event summary for top events */
export interface EventSummary {
  /** Event name */
  name: string;
  /** Total count */
  count: number;
  /** Unique users */
  uniqueUsers: number;
}

/** Dashboard summary */
export interface DashboardSummary {
  /** Total number of events */
  totalEvents: number;
  /** Unique user count */
  uniqueUsers: number;
  /** Average session duration in ms */
  avgSessionDuration: number;
  /** Top events by count */
  topEvents: EventSummary[];
}

/** Interface for an analytics engine that the dashboard can query */
export interface AnalyticsDataSource {
  /** Get all events, optionally filtered by time range */
  getEvents(range?: DateRange): AnalyticsDashboardEvent[];
}

/** Minimal event shape required by the dashboard */
export interface AnalyticsDashboardEvent {
  id: string;
  name: string;
  userId?: string;
  sessionId?: string;
  timestamp: number;
  properties?: Record<string, unknown>;
}

/** Configuration for the dashboard data provider */
export interface DashboardDataProviderConfig {
  /** Cache TTL in milliseconds. @default 60000 */
  cacheTtlMs?: number;
  /** Enable debug logging. @default false */
  debug?: boolean;
}

interface CacheEntry<T> {
  data: T;
  computedAt: number;
}

/**
 * Analytics dashboard data provider with caching.
 *
 * @example
 * ```typescript
 * import { createDashboardDataProvider } from '@pocket/analytics';
 *
 * const provider = createDashboardDataProvider(dataSource);
 * const summary = provider.getSummary();
 * const funnel = provider.getFunnelData(['visit', 'signup', 'purchase']);
 * ```
 */
export class DashboardDataProvider {
  private readonly config: Required<DashboardDataProviderConfig>;
  private readonly dataSource: AnalyticsDataSource;
  private readonly destroy$ = new Subject<void>();
  private readonly data$$ = new BehaviorSubject<DashboardSummary | null>(null);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private destroyed = false;

  constructor(dataSource: AnalyticsDataSource, config: DashboardDataProviderConfig = {}) {
    this.dataSource = dataSource;
    this.config = {
      cacheTtlMs: config.cacheTtlMs ?? 60_000,
      debug: config.debug ?? false,
    };
  }

  /**
   * Compute funnel data for a sequence of event step names.
   *
   * @param steps - Ordered list of event names representing funnel steps
   * @param range - Optional date range filter
   * @returns Array of funnel step results
   */
  getFunnelData(steps: string[], range?: DateRange): DashboardFunnelStep[] {
    const cacheKey = `funnel:${steps.join(',')}:${range?.start ?? 0}:${range?.end ?? 0}`;
    const cached = this.getFromCache<DashboardFunnelStep[]>(cacheKey);
    if (cached) return cached;

    const events = this.dataSource.getEvents(range);

    // Group events by user
    const userEvents = new Map<string, AnalyticsDashboardEvent[]>();
    for (const event of events) {
      const key = event.userId ?? event.sessionId ?? 'anonymous';
      const list = userEvents.get(key) ?? [];
      list.push(event);
      userEvents.set(key, list);
    }

    const stepResults: DashboardFunnelStep[] = steps.map((stepName, index) => {
      let count = 0;

      for (const [, userEvts] of userEvents) {
        const sorted = userEvts.sort((a, b) => a.timestamp - b.timestamp);

        let completedPrevious = true;
        let lastTimestamp = 0;

        if (index > 0) {
          for (let i = 0; i < index; i++) {
            const prevStepName = steps[i]!;
            const match = sorted.find(
              (e) => e.name === prevStepName && e.timestamp > lastTimestamp,
            );
            if (!match) {
              completedPrevious = false;
              break;
            }
            lastTimestamp = match.timestamp;
          }
        }

        if (completedPrevious) {
          const match = sorted.find(
            (e) => e.name === stepName && e.timestamp > lastTimestamp,
          );
          if (match) count++;
        }
      }

      return { name: stepName, count, conversionRate: 0, dropoffRate: 0 };
    });

    // Calculate conversion/dropoff rates
    for (let i = 0; i < stepResults.length; i++) {
      const step = stepResults[i]!;
      if (i === 0) {
        step.conversionRate = 1;
        step.dropoffRate = 0;
      } else {
        const prevCount = stepResults[i - 1]!.count;
        step.conversionRate = prevCount > 0 ? step.count / prevCount : 0;
        step.dropoffRate = prevCount > 0 ? 1 - step.conversionRate : 0;
      }
    }

    this.setCache(cacheKey, stepResults);
    return stepResults;
  }

  /**
   * Compute retention cohort data.
   *
   * @param cohortSize - Cohort grouping interval
   * @param periods - Number of retention periods to compute
   * @param range - Optional date range filter
   * @returns Array of retention cohort data
   */
  getRetentionData(
    cohortSize: 'day' | 'week' | 'month',
    periods: number,
    range?: DateRange,
  ): DashboardRetentionCohort[] {
    const cacheKey = `retention:${cohortSize}:${periods}:${range?.start ?? 0}:${range?.end ?? 0}`;
    const cached = this.getFromCache<DashboardRetentionCohort[]>(cacheKey);
    if (cached) return cached;

    const events = this.dataSource.getEvents(range);
    const periodMs = this.cohortSizeToMs(cohortSize);
    const now = Date.now();

    // Group users by first seen cohort
    const userFirstSeen = new Map<string, number>();
    const userActivePeriods = new Map<string, Set<number>>();

    for (const event of events) {
      const userId = event.userId ?? event.sessionId ?? 'anonymous';

      if (!userFirstSeen.has(userId) || event.timestamp < userFirstSeen.get(userId)!) {
        userFirstSeen.set(userId, event.timestamp);
      }

      if (!userActivePeriods.has(userId)) {
        userActivePeriods.set(userId, new Set());
      }
      const bucket = Math.floor(event.timestamp / periodMs);
      userActivePeriods.get(userId)!.add(bucket);
    }

    const cohorts: DashboardRetentionCohort[] = [];

    for (let cohortIdx = periods - 1; cohortIdx >= 0; cohortIdx--) {
      const cohortStart = now - (cohortIdx + 1) * periodMs;
      const cohortEnd = now - cohortIdx * periodMs;
      const cohortBucket = Math.floor(cohortStart / periodMs);

      const cohortUsers: string[] = [];
      for (const [userId, firstSeen] of userFirstSeen) {
        if (firstSeen >= cohortStart && firstSeen < cohortEnd) {
          cohortUsers.push(userId);
        }
      }

      const retentionPeriods: DashboardRetentionCohort['periods'] = [];
      for (let p = 0; p <= Math.min(cohortIdx, periods - 1); p++) {
        const targetBucket = cohortBucket + p;
        let retained = 0;
        for (const userId of cohortUsers) {
          if (userActivePeriods.get(userId)?.has(targetBucket)) {
            retained++;
          }
        }
        retentionPeriods.push({
          period: p,
          retained,
          retentionRate: cohortUsers.length > 0 ? retained / cohortUsers.length : 0,
        });
      }

      cohorts.push({
        cohortDate: new Date(cohortStart).toISOString().slice(0, 10),
        cohortSize: cohortUsers.length,
        periods: retentionPeriods,
      });
    }

    this.setCache(cacheKey, cohorts);
    return cohorts;
  }

  /**
   * Compute a time series for a metric over an interval.
   *
   * @param metric - Event name to count
   * @param interval - Bucketing interval
   * @param range - Date range for the series
   * @returns Array of time series data points
   */
  getMetricTimeSeries(
    metric: string,
    interval: 'hour' | 'day' | 'week',
    range: DateRange,
  ): TimeSeriesPoint[] {
    const cacheKey = `timeseries:${metric}:${interval}:${range.start}:${range.end}`;
    const cached = this.getFromCache<TimeSeriesPoint[]>(cacheKey);
    if (cached) return cached;

    const events = this.dataSource.getEvents(range).filter((e) => e.name === metric);
    const intervalMs = this.intervalToMs(interval);

    const bucketStart = Math.floor(range.start / intervalMs) * intervalMs;
    const bucketEnd = Math.ceil(range.end / intervalMs) * intervalMs;
    const buckets = new Map<number, number>();

    // Initialize all buckets
    for (let t = bucketStart; t < bucketEnd; t += intervalMs) {
      buckets.set(t, 0);
    }

    // Fill in counts
    for (const event of events) {
      const bucket = Math.floor(event.timestamp / intervalMs) * intervalMs;
      if (buckets.has(bucket)) {
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }
    }

    const points: TimeSeriesPoint[] = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, value]) => ({
        timestamp,
        value,
        label: new Date(timestamp).toISOString(),
      }));

    this.setCache(cacheKey, points);
    return points;
  }

  /**
   * Get top events by count.
   *
   * @param limit - Maximum number of events to return
   * @param range - Optional date range filter
   * @returns Array of event summaries sorted by count descending
   */
  getTopEvents(limit: number, range?: DateRange): EventSummary[] {
    const cacheKey = `topevents:${limit}:${range?.start ?? 0}:${range?.end ?? 0}`;
    const cached = this.getFromCache<EventSummary[]>(cacheKey);
    if (cached) return cached;

    const events = this.dataSource.getEvents(range);
    const eventCounts = new Map<string, { count: number; users: Set<string> }>();

    for (const event of events) {
      const entry = eventCounts.get(event.name) ?? { count: 0, users: new Set<string>() };
      entry.count++;
      entry.users.add(event.userId ?? event.sessionId ?? 'anonymous');
      eventCounts.set(event.name, entry);
    }

    const summaries: EventSummary[] = Array.from(eventCounts.entries())
      .map(([name, { count, users }]) => ({
        name,
        count,
        uniqueUsers: users.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    this.setCache(cacheKey, summaries);
    return summaries;
  }

  /**
   * Get an overall dashboard summary.
   *
   * @param range - Optional date range filter
   * @returns Dashboard summary object
   */
  getSummary(range?: DateRange): DashboardSummary {
    const cacheKey = `summary:${range?.start ?? 0}:${range?.end ?? 0}`;
    const cached = this.getFromCache<DashboardSummary>(cacheKey);
    if (cached) return cached;

    const events = this.dataSource.getEvents(range);
    const uniqueUsers = new Set<string>();
    const sessions = new Map<string, { start: number; end: number }>();

    for (const event of events) {
      if (event.userId) uniqueUsers.add(event.userId);

      const sessionId = event.sessionId;
      if (sessionId) {
        const session = sessions.get(sessionId) ?? { start: event.timestamp, end: event.timestamp };
        session.start = Math.min(session.start, event.timestamp);
        session.end = Math.max(session.end, event.timestamp);
        sessions.set(sessionId, session);
      }
    }

    let avgSessionDuration = 0;
    if (sessions.size > 0) {
      const totalDuration = Array.from(sessions.values()).reduce(
        (sum, s) => sum + (s.end - s.start),
        0,
      );
      avgSessionDuration = totalDuration / sessions.size;
    }

    const topEvents = this.getTopEvents(10, range);

    const summary: DashboardSummary = {
      totalEvents: events.length,
      uniqueUsers: uniqueUsers.size,
      avgSessionDuration,
      topEvents,
    };

    this.setCache(cacheKey, summary);
    this.data$$.next(summary);
    return summary;
  }

  /**
   * Observable that emits when summary data updates.
   */
  get data$(): Observable<DashboardSummary | null> {
    return this.data$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Force recomputation by clearing the cache.
   */
  refresh(): void {
    this.cache.clear();
    this.log('Cache cleared');
  }

  /**
   * Destroy the provider and clean up resources.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.cache.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.data$$.complete();

    this.log('DashboardDataProvider destroyed');
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() - entry.computedAt > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    this.log('Cache hit:', key);
    return entry.data;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, computedAt: Date.now() });
  }

  private cohortSizeToMs(size: 'day' | 'week' | 'month'): number {
    switch (size) {
      case 'day':
        return 24 * 60 * 60 * 1000;
      case 'week':
        return 7 * 24 * 60 * 60 * 1000;
      case 'month':
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private intervalToMs(interval: 'hour' | 'day' | 'week'): number {
    switch (interval) {
      case 'hour':
        return 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
      case 'week':
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[DashboardDataProvider]', ...args);
    }
  }
}

/**
 * Create a new DashboardDataProvider instance.
 *
 * @param dataSource - Analytics data source to query
 * @param config - Optional configuration
 * @returns A new DashboardDataProvider
 *
 * @example
 * ```typescript
 * import { createDashboardDataProvider } from '@pocket/analytics';
 *
 * const provider = createDashboardDataProvider(dataSource);
 * const summary = provider.getSummary();
 * ```
 */
export function createDashboardDataProvider(
  dataSource: AnalyticsDataSource,
  config?: DashboardDataProviderConfig,
): DashboardDataProvider {
  return new DashboardDataProvider(dataSource, config);
}

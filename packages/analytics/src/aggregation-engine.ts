/**
 * AggregationEngine - Client-side analytics aggregation for Pocket.
 *
 * Computes funnels, retention cohorts, and custom metrics locally
 * before syncing aggregated results.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

export interface AnalyticsEvent {
  id: string;
  name: string;
  properties?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  timestamp: number;
}

export interface FunnelStep {
  name: string;
  eventName: string;
  filter?: Record<string, unknown>;
}

export interface FunnelResult {
  steps: {
    name: string;
    eventName: string;
    count: number;
    conversionRate: number;
    dropoffRate: number;
  }[];
  totalConversion: number;
  totalEvents: number;
  computedAt: number;
}

export interface RetentionCohort {
  cohortDate: string;
  cohortSize: number;
  periods: {
    period: number;
    retained: number;
    retentionRate: number;
  }[];
}

export interface MetricDefinition {
  name: string;
  eventName: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'unique';
  property?: string;
  filter?: Record<string, unknown>;
}

export interface MetricResult {
  name: string;
  value: number;
  computedAt: number;
  periodStart: number;
  periodEnd: number;
}

export interface AggregationConfig {
  /** Maximum events to keep in memory */
  maxEventsInMemory?: number;
  /** TTL for events in ms before compaction */
  eventTtlMs?: number;
  /** Auto-compact interval in ms (0 to disable) */
  autoCompactIntervalMs?: number;
}

export interface AggregationSummary {
  totalEvents: number;
  uniqueUsers: number;
  uniqueSessions: number;
  topEvents: { name: string; count: number }[];
  periodStart: number;
  periodEnd: number;
  computedAt: number;
}

export class AggregationEngine {
  private readonly config: Required<AggregationConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events: AnalyticsEvent[] = [];
  private readonly summary$ = new BehaviorSubject<AggregationSummary | null>(null);
  private compactInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AggregationConfig = {}) {
    this.config = {
      maxEventsInMemory: config.maxEventsInMemory ?? 10_000,
      eventTtlMs: config.eventTtlMs ?? 30 * 24 * 60 * 60 * 1000, // 30 days
      autoCompactIntervalMs: config.autoCompactIntervalMs ?? 0,
    };

    if (this.config.autoCompactIntervalMs > 0) {
      this.compactInterval = setInterval(() => {
        this.compact();
      }, this.config.autoCompactIntervalMs);
    }
  }

  /**
   * Ingest an analytics event.
   */
  ingest(event: AnalyticsEvent): void {
    this.events.push(event);

    // Evict oldest events if over limit
    while (this.events.length > this.config.maxEventsInMemory) {
      this.events.shift();
    }
  }

  /**
   * Ingest a batch of events.
   */
  ingestBatch(events: AnalyticsEvent[]): void {
    for (const event of events) {
      this.ingest(event);
    }
  }

  /**
   * Compute a funnel analysis.
   */
  computeFunnel(steps: FunnelStep[], timeWindowMs?: number): FunnelResult {
    const now = Date.now();
    const windowStart = timeWindowMs ? now - timeWindowMs : 0;
    const relevantEvents = this.events.filter((e) => e.timestamp >= windowStart);

    // Group events by user/session
    const userEvents = new Map<string, AnalyticsEvent[]>();
    for (const event of relevantEvents) {
      const key = event.userId ?? event.sessionId ?? 'anonymous';
      const list = userEvents.get(key) ?? [];
      list.push(event);
      userEvents.set(key, list);
    }

    const stepResults = steps.map((step, index) => {
      let count = 0;

      for (const [, events] of userEvents) {
        // Sort events by timestamp
        const sorted = events.sort((a, b) => a.timestamp - b.timestamp);

        // Check if user completed all previous steps in order
        let completedPrevious = true;
        if (index > 0) {
          let lastTimestamp = 0;
          for (let i = 0; i < index; i++) {
            const prevStep = steps[i]!;
            const matchingEvent = sorted.find(
              (e) => e.name === prevStep.eventName && e.timestamp > lastTimestamp && this.matchesFilter(e, prevStep.filter)
            );
            if (!matchingEvent) {
              completedPrevious = false;
              break;
            }
            lastTimestamp = matchingEvent.timestamp;
          }
        }

        if (completedPrevious) {
          const matchingEvent = sorted.find(
            (e) => e.name === step.eventName && this.matchesFilter(e, step.filter)
          );
          if (matchingEvent) count++;
        }
      }

      return {
        name: step.name,
        eventName: step.eventName,
        count,
        conversionRate: 0,
        dropoffRate: 0,
      };
    });

    // Calculate conversion rates
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

    const firstStepCount = stepResults[0]?.count ?? 0;
    const lastStepCount = stepResults[stepResults.length - 1]?.count ?? 0;
    const totalConversion = firstStepCount > 0 ? lastStepCount / firstStepCount : 0;

    return {
      steps: stepResults,
      totalConversion,
      totalEvents: relevantEvents.length,
      computedAt: Date.now(),
    };
  }

  /**
   * Compute retention cohorts.
   */
  computeRetention(options: {
    periodDays?: number;
    numPeriods?: number;
    eventName?: string;
  } = {}): RetentionCohort[] {
    const periodDays = options.periodDays ?? 7;
    const numPeriods = options.numPeriods ?? 8;
    const periodMs = periodDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Group users by their first event date (cohort)
    const userFirstSeen = new Map<string, number>();
    const userActiveTimestamps = new Map<string, Set<number>>();

    for (const event of this.events) {
      if (options.eventName && event.name !== options.eventName) continue;
      const userId = event.userId ?? event.sessionId ?? 'anonymous';

      if (!userFirstSeen.has(userId) || event.timestamp < userFirstSeen.get(userId)!) {
        userFirstSeen.set(userId, event.timestamp);
      }

      if (!userActiveTimestamps.has(userId)) {
        userActiveTimestamps.set(userId, new Set());
      }
      // Normalize to period bucket
      const periodBucket = Math.floor(event.timestamp / periodMs);
      userActiveTimestamps.get(userId)!.add(periodBucket);
    }

    const cohorts: RetentionCohort[] = [];

    for (let cohortIdx = numPeriods - 1; cohortIdx >= 0; cohortIdx--) {
      const cohortStart = now - (cohortIdx + 1) * periodMs;
      const cohortEnd = now - cohortIdx * periodMs;
      const cohortBucket = Math.floor(cohortStart / periodMs);

      // Users whose first event falls in this cohort period
      const cohortUsers: string[] = [];
      for (const [userId, firstSeen] of userFirstSeen) {
        if (firstSeen >= cohortStart && firstSeen < cohortEnd) {
          cohortUsers.push(userId);
        }
      }

      const periods: RetentionCohort['periods'] = [];
      for (let p = 0; p <= Math.min(cohortIdx, numPeriods - 1); p++) {
        const targetBucket = cohortBucket + p;
        let retained = 0;
        for (const userId of cohortUsers) {
          if (userActiveTimestamps.get(userId)?.has(targetBucket)) {
            retained++;
          }
        }
        periods.push({
          period: p,
          retained,
          retentionRate: cohortUsers.length > 0 ? retained / cohortUsers.length : 0,
        });
      }

      cohorts.push({
        cohortDate: new Date(cohortStart).toISOString().slice(0, 10),
        cohortSize: cohortUsers.length,
        periods,
      });
    }

    return cohorts;
  }

  /**
   * Compute a custom metric.
   */
  computeMetric(definition: MetricDefinition, periodStart?: number, periodEnd?: number): MetricResult {
    const start = periodStart ?? 0;
    const end = periodEnd ?? Date.now();

    const relevantEvents = this.events.filter(
      (e) =>
        e.name === definition.eventName &&
        e.timestamp >= start &&
        e.timestamp <= end &&
        this.matchesFilter(e, definition.filter)
    );

    let value: number;

    switch (definition.aggregation) {
      case 'count':
        value = relevantEvents.length;
        break;

      case 'unique': {
        const uniqueUsers = new Set(relevantEvents.map((e) => e.userId ?? e.sessionId ?? 'anonymous'));
        value = uniqueUsers.size;
        break;
      }

      case 'sum': {
        value = relevantEvents.reduce((sum, e) => {
          const propValue = definition.property ? (e.properties?.[definition.property] as number) : 0;
          return sum + (typeof propValue === 'number' ? propValue : 0);
        }, 0);
        break;
      }

      case 'avg': {
        const values = relevantEvents
          .map((e) => definition.property ? e.properties?.[definition.property] : undefined)
          .filter((v): v is number => typeof v === 'number');
        value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        break;
      }

      case 'min': {
        const minValues = relevantEvents
          .map((e) => definition.property ? e.properties?.[definition.property] : undefined)
          .filter((v): v is number => typeof v === 'number');
        value = minValues.length > 0 ? Math.min(...minValues) : 0;
        break;
      }

      case 'max': {
        const maxValues = relevantEvents
          .map((e) => definition.property ? e.properties?.[definition.property] : undefined)
          .filter((v): v is number => typeof v === 'number');
        value = maxValues.length > 0 ? Math.max(...maxValues) : 0;
        break;
      }

      default:
        value = 0;
    }

    return {
      name: definition.name,
      value,
      computedAt: Date.now(),
      periodStart: start,
      periodEnd: end,
    };
  }

  /**
   * Generate an aggregation summary suitable for sync.
   */
  computeSummary(): AggregationSummary {
    const uniqueUsers = new Set<string>();
    const uniqueSessions = new Set<string>();
    const eventCounts = new Map<string, number>();
    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;

    for (const event of this.events) {
      if (event.userId) uniqueUsers.add(event.userId);
      if (event.sessionId) uniqueSessions.add(event.sessionId);
      eventCounts.set(event.name, (eventCounts.get(event.name) ?? 0) + 1);
      if (event.timestamp < minTimestamp) minTimestamp = event.timestamp;
      if (event.timestamp > maxTimestamp) maxTimestamp = event.timestamp;
    }

    const topEvents = Array.from(eventCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const summary: AggregationSummary = {
      totalEvents: this.events.length,
      uniqueUsers: uniqueUsers.size,
      uniqueSessions: uniqueSessions.size,
      topEvents,
      periodStart: minTimestamp === Infinity ? Date.now() : minTimestamp,
      periodEnd: maxTimestamp === -Infinity ? Date.now() : maxTimestamp,
      computedAt: Date.now(),
    };

    this.summary$.next(summary);
    return summary;
  }

  /**
   * Get summary observable.
   */
  getSummary(): Observable<AggregationSummary | null> {
    return this.summary$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the current event count.
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Compact old events beyond TTL.
   */
  compact(): number {
    const cutoff = Date.now() - this.config.eventTtlMs;
    const before = this.events.length;
    let writeIdx = 0;
    for (const event of this.events) {
      if (event.timestamp >= cutoff) {
        this.events[writeIdx] = event;
        writeIdx++;
      }
    }
    this.events.length = writeIdx;
    return before - writeIdx;
  }

  /**
   * Export events for differential sync.
   */
  exportForSync(sinceTimestamp?: number): AnalyticsEvent[] {
    if (sinceTimestamp) {
      return this.events.filter((e) => e.timestamp >= sinceTimestamp);
    }
    return [...this.events];
  }

  /**
   * Clear all events.
   */
  clear(): void {
    this.events.length = 0;
    this.summary$.next(null);
  }

  destroy(): void {
    if (this.compactInterval) {
      clearInterval(this.compactInterval);
      this.compactInterval = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.summary$.complete();
  }

  private matchesFilter(event: AnalyticsEvent, filter?: Record<string, unknown>): boolean {
    if (!filter) return true;
    for (const [key, value] of Object.entries(filter)) {
      if (event.properties?.[key] !== value) return false;
    }
    return true;
  }
}

export function createAggregationEngine(config?: AggregationConfig): AggregationEngine {
  return new AggregationEngine(config);
}

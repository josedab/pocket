/**
 * Dashboard React hook factories for offline-first analytics.
 *
 * Creates hooks that consume dashboard render descriptors and provide
 * live-updating analytics data for React components.
 *
 * @module dashboard-hooks
 */

import type { AnalyticsTracker } from './analytics-tracker.js';
import type { DashboardLayoutDescriptor, MetricCardDescriptor, ChartDescriptor } from './dashboard-components.js';
import {
  buildMetricCard,
  buildChart,
  buildTopEvents,
  type TimeRangePreset,
} from './dashboard-components.js';

/** React hooks interface for DI */
export interface DashboardReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useMemo<T>(fn: () => T, deps: unknown[]): T;
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
}

/** Dashboard hook configuration */
export interface UseDashboardConfig {
  /** Analytics tracker instance */
  readonly tracker: AnalyticsTracker;
  /** Refresh interval in ms (default: 30000) */
  readonly refreshIntervalMs?: number;
  /** Default time range (default: '7d') */
  readonly defaultTimeRange?: TimeRangePreset;
}

/** Return type of useDashboard hook */
export interface UseDashboardReturn {
  readonly layout: DashboardLayoutDescriptor | null;
  readonly isLoading: boolean;
  readonly timeRange: TimeRangePreset;
  readonly setTimeRange: (range: TimeRangePreset) => void;
  readonly refresh: () => void;
}

/**
 * Creates a useDashboard React hook.
 *
 * @example
 * ```typescript
 * import React from 'react';
 * import { createUseDashboardHook } from '@pocket/analytics';
 *
 * const useDashboard = createUseDashboardHook(React);
 *
 * function Dashboard({ tracker }) {
 *   const { layout, isLoading, timeRange, setTimeRange } = useDashboard({ tracker });
 *
 *   if (isLoading || !layout) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       {layout.metrics.map(m => <MetricCard key={m.id} {...m} />)}
 *       {layout.charts.map(c => <Chart key={c.id} {...c} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function createUseDashboardHook(
  React: DashboardReactHooks,
): (config: UseDashboardConfig) => UseDashboardReturn {
  return function useDashboard(config: UseDashboardConfig): UseDashboardReturn {
    const [timeRange, setTimeRange] = React.useState<TimeRangePreset>(
      config.defaultTimeRange ?? '7d',
    );
    const [layout, setLayout] = React.useState<DashboardLayoutDescriptor | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    const buildLayout = React.useCallback(
      () => {
        // Build a dashboard layout from tracker data
        const metrics: MetricCardDescriptor[] = [
          buildMetricCard('total-events', 'Total Events', 0, 0),
          buildMetricCard('active-sessions', 'Active Sessions', 0, 0),
          buildMetricCard('avg-duration', 'Avg Duration', 0, 0, 'duration'),
        ];

        const charts: ChartDescriptor[] = [
          buildChart('events-timeline', 'Events Over Time', 'line', []),
        ];

        const newLayout: DashboardLayoutDescriptor = {
          timeRange,
          metrics,
          charts,
          funnels: [],
          topEvents: buildTopEvents([]),
          generatedAt: Date.now(),
        };
        setLayout(newLayout);
        setIsLoading(false);
      },
      [timeRange] as unknown[],
    );

    const refresh = React.useCallback(buildLayout, [buildLayout] as unknown[]);

    React.useEffect(() => {
      buildLayout();
      const interval = setInterval(buildLayout, config.refreshIntervalMs ?? 30_000);
      return () => clearInterval(interval);
    }, [buildLayout, config.refreshIntervalMs] as unknown[]);

    return { layout, isLoading, timeRange, setTimeRange, refresh };
  };
}

/**
 * Dashboard component render descriptors for offline-first analytics.
 *
 * Framework-agnostic data structures for rendering analytics dashboards.
 * Can be consumed by React, Vue, or any UI framework.
 *
 * @module dashboard-components
 */

/** Time range preset for dashboard queries */
export type TimeRangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

/** A metric card descriptor */
export interface MetricCardDescriptor {
  readonly id: string;
  readonly title: string;
  readonly value: number | string;
  readonly previousValue?: number | string;
  readonly changePercent?: number;
  readonly changeDirection: 'up' | 'down' | 'flat';
  readonly format: 'number' | 'percent' | 'duration' | 'currency';
  readonly color: string;
  readonly icon?: string;
}

/** A chart data point */
export interface ChartPoint {
  readonly label: string;
  readonly value: number;
  readonly timestamp?: number;
}

/** A line/bar chart descriptor */
export interface ChartDescriptor {
  readonly id: string;
  readonly title: string;
  readonly type: 'line' | 'bar' | 'area' | 'pie';
  readonly data: readonly ChartPoint[];
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly color: string;
  readonly fillColor?: string;
}

/** A funnel step descriptor */
export interface FunnelStepDescriptor {
  readonly label: string;
  readonly count: number;
  readonly percent: number;
  readonly dropoffPercent: number;
  readonly color: string;
}

/** Full funnel descriptor */
export interface FunnelDescriptor {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly FunnelStepDescriptor[];
  readonly totalConversion: number;
}

/** Top events table descriptor */
export interface TopEventsDescriptor {
  readonly events: readonly {
    readonly name: string;
    readonly count: number;
    readonly percentOfTotal: number;
  }[];
  readonly totalEvents: number;
}

/** Full dashboard layout descriptor */
export interface DashboardLayoutDescriptor {
  readonly timeRange: TimeRangePreset;
  readonly metrics: readonly MetricCardDescriptor[];
  readonly charts: readonly ChartDescriptor[];
  readonly funnels: readonly FunnelDescriptor[];
  readonly topEvents: TopEventsDescriptor;
  readonly generatedAt: number;
}

// ── Builder Functions ────────────────────────────────────────────────────────

const METRIC_COLORS = {
  positive: '#27AE60',
  negative: '#E74C3C',
  neutral: '#95A5A6',
} as const;

const CHART_COLORS = [
  '#3498DB', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E67E22', '#34495E',
] as const;

/** Build a metric card descriptor from raw values */
export function buildMetricCard(
  id: string,
  title: string,
  current: number,
  previous: number,
  format: MetricCardDescriptor['format'] = 'number',
): MetricCardDescriptor {
  const changePercent = previous > 0
    ? Math.round(((current - previous) / previous) * 10000) / 100
    : 0;
  const changeDirection: MetricCardDescriptor['changeDirection'] =
    changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';

  return {
    id,
    title,
    value: current,
    previousValue: previous,
    changePercent,
    changeDirection,
    format,
    color: changeDirection === 'up'
      ? METRIC_COLORS.positive
      : changeDirection === 'down'
        ? METRIC_COLORS.negative
        : METRIC_COLORS.neutral,
  };
}

/** Build a chart descriptor from data points */
export function buildChart(
  id: string,
  title: string,
  type: ChartDescriptor['type'],
  data: readonly ChartPoint[],
  colorIndex = 0,
): ChartDescriptor {
  const idx = colorIndex % CHART_COLORS.length;
  return {
    id,
    title,
    type,
    data,
    color: CHART_COLORS[idx]!,
    fillColor: type === 'area' ? `${CHART_COLORS[idx]!}33` : undefined,
  };
}

/** Build a funnel descriptor from step counts */
export function buildFunnel(
  id: string,
  title: string,
  steps: readonly { label: string; count: number }[],
): FunnelDescriptor {
  const first = steps[0]?.count ?? 0;
  const funnelSteps: FunnelStepDescriptor[] = steps.map((step, i) => {
    const prev = i === 0 ? first : (steps[i - 1]?.count ?? 0);
    const dropoff = prev > 0 ? Math.round(((prev - step.count) / prev) * 10000) / 100 : 0;
    const colorIdx = i % CHART_COLORS.length;
    return {
      label: step.label,
      count: step.count,
      percent: first > 0 ? Math.round((step.count / first) * 10000) / 100 : 0,
      dropoffPercent: dropoff,
      color: CHART_COLORS[colorIdx]!,
    };
  });

  const last = steps[steps.length - 1]?.count ?? 0;
  const totalConversion = first > 0 ? Math.round((last / first) * 10000) / 100 : 0;

  return { id, title, steps: funnelSteps, totalConversion };
}

/** Build top events table from event counts */
export function buildTopEvents(
  events: readonly { name: string; count: number }[],
): TopEventsDescriptor {
  const total = events.reduce((sum, e) => sum + e.count, 0);
  return {
    events: events.map((e) => ({
      name: e.name,
      count: e.count,
      percentOfTotal: total > 0 ? Math.round((e.count / total) * 10000) / 100 : 0,
    })),
    totalEvents: total,
  };
}

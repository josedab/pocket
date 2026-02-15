/**
 * VisualizationEngine - Chart data models and rendering configurations for Pocket Analytics.
 *
 * Provides chart-library-agnostic data structures that can be consumed by
 * Recharts, Chart.js, D3, or any charting library.
 *
 * @packageDocumentation
 * @module @pocket/analytics/visualization-engine
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported chart types */
export type ChartType =
  | 'line'
  | 'bar'
  | 'pie'
  | 'donut'
  | 'area'
  | 'scatter'
  | 'funnel'
  | 'heatmap'
  | 'retention-grid'
  | 'metric-card';

/** Single data point within a chart series */
export interface ChartDataPoint {
  /** X-axis value (category label, numeric value, or date) */
  x: string | number | Date;
  /** Y-axis value */
  y: number;
  /** Optional human-readable label */
  label?: string;
  /** Optional colour override for this point */
  color?: string;
  /** Arbitrary metadata attached to the point */
  metadata?: Record<string, unknown>;
}

/** A named series of data points */
export interface ChartSeries {
  /** Unique series identifier */
  id: string;
  /** Display name */
  name: string;
  /** Data points in the series */
  data: ChartDataPoint[];
  /** Series colour */
  color?: string;
  /** Line style (line/area charts) */
  type?: 'solid' | 'dashed' | 'dotted';
}

/** Full chart configuration */
export interface ChartConfig {
  /** Unique chart identifier */
  id: string;
  /** Chart visualisation type */
  type: ChartType;
  /** Chart title */
  title: string;
  /** Optional description */
  description?: string;
  /** Data series */
  series: ChartSeries[];
  /** X-axis configuration */
  xAxis?: { label?: string; type?: 'category' | 'time' | 'linear'; format?: string };
  /** Y-axis configuration */
  yAxis?: { label?: string; min?: number; max?: number; format?: string };
  /** Legend configuration */
  legend?: { position?: 'top' | 'bottom' | 'left' | 'right' | 'none'; show?: boolean };
  /** Colour palette override */
  colors?: string[];
  /** Chart dimensions */
  dimensions?: { width?: number; height?: number };
  /** Enable interactive tooltips / zoom */
  interactive?: boolean;
  /** Annotation overlays */
  annotations?: {
    type: 'line' | 'area' | 'point';
    value: number;
    label?: string;
    color?: string;
  }[];
}

/** Data structure for funnel charts */
export interface FunnelChartData {
  /** Ordered funnel steps */
  steps: {
    /** Step name */
    name: string;
    /** Absolute count at this step */
    count: number;
    /** Percentage of the initial step */
    percentage: number;
    /** Dropoff from previous step (0 for first step) */
    dropoff: number;
  }[];
  /** Overall conversion from first to last step */
  totalConversion: number;
}

/** Data structure for retention grid visualisations */
export interface RetentionGridData {
  /** Cohort rows */
  cohorts: {
    /** Cohort period label */
    period: string;
    /** Number of users in the cohort */
    size: number;
    /** Retention percentages for each subsequent period */
    retention: number[];
  }[];
  /** Column period labels */
  periods: string[];
}

/** Data structure for metric card visualisations */
export interface MetricCardData {
  /** Primary metric value */
  value: number;
  /** Previous period value for comparison */
  previousValue?: number;
  /** Absolute change */
  change?: number;
  /** Percentage change */
  changePercent?: number;
  /** Trend direction */
  trend: 'up' | 'down' | 'flat';
  /** Display format */
  format?: 'number' | 'percent' | 'currency' | 'duration';
  /** Optional sparkline data */
  sparkline?: number[];
}

/** Configuration for the visualisation engine */
export interface VisualizationConfig {
  /** Default colour palette */
  colorPalette?: string[];
  /** Date format string */
  dateFormat?: string;
  /** Number format locale */
  numberLocale?: string;
  /** Currency code */
  currency?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default 12-colour palette for charts */
export const DEFAULT_COLOR_PALETTE: readonly string[] = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#64748b',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// ---------------------------------------------------------------------------
// VisualizationEngine
// ---------------------------------------------------------------------------

/**
 * Chart data engine for analytics dashboards.
 *
 * Builds chart-library-agnostic {@link ChartConfig} objects that can be
 * directly consumed by Recharts, Chart.js, D3, or other renderers.
 *
 * @example
 * ```typescript
 * import { createVisualizationEngine } from '@pocket/analytics';
 *
 * const engine = createVisualizationEngine();
 *
 * const line = engine.createLineChart('Daily Active Users', [
 *   { id: 'dau', name: 'DAU', data: [{ x: '2024-01-01', y: 120 }] },
 * ]);
 *
 * const pie = engine.createPieChart('Traffic Sources', [
 *   { x: 'Organic', y: 45 },
 *   { x: 'Direct', y: 30 },
 *   { x: 'Referral', y: 25 },
 * ]);
 * ```
 */
export class VisualizationEngine {
  private readonly config: Required<VisualizationConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly charts$$ = new BehaviorSubject<ChartConfig[]>([]);
  private destroyed = false;

  constructor(config: VisualizationConfig = {}) {
    this.config = {
      colorPalette: config.colorPalette ?? [...DEFAULT_COLOR_PALETTE],
      dateFormat: config.dateFormat ?? 'yyyy-MM-dd',
      numberLocale: config.numberLocale ?? 'en-US',
      currency: config.currency ?? 'USD',
    };
  }

  // -----------------------------------------------------------------------
  // Chart builders
  // -----------------------------------------------------------------------

  /**
   * Create a line chart configuration.
   *
   * @param title - Chart title
   * @param series - One or more data series
   * @param options - Optional overrides for the chart config
   * @returns A complete {@link ChartConfig} for a line chart
   *
   * @example
   * ```typescript
   * const chart = engine.createLineChart('Revenue', [
   *   { id: 'rev', name: 'Revenue', data: [{ x: 'Jan', y: 100 }, { x: 'Feb', y: 140 }] },
   * ]);
   * ```
   */
  createLineChart(
    title: string,
    series: ChartSeries[],
    options?: Partial<ChartConfig>
  ): ChartConfig {
    return this.buildChart('line', title, series, options);
  }

  /**
   * Create a bar chart configuration.
   *
   * @param title - Chart title
   * @param series - One or more data series
   * @param options - Optional overrides for the chart config
   * @returns A complete {@link ChartConfig} for a bar chart
   *
   * @example
   * ```typescript
   * const chart = engine.createBarChart('Events by Type', [
   *   { id: 'events', name: 'Events', data: [{ x: 'click', y: 300 }, { x: 'view', y: 520 }] },
   * ]);
   * ```
   */
  createBarChart(
    title: string,
    series: ChartSeries[],
    options?: Partial<ChartConfig>
  ): ChartConfig {
    return this.buildChart('bar', title, series, options);
  }

  /**
   * Create a pie chart configuration.
   *
   * @param title - Chart title
   * @param data - Data points representing slices
   * @param options - Optional overrides for the chart config
   * @returns A complete {@link ChartConfig} for a pie chart
   *
   * @example
   * ```typescript
   * const chart = engine.createPieChart('Browser Share', [
   *   { x: 'Chrome', y: 65 },
   *   { x: 'Firefox', y: 20 },
   *   { x: 'Safari', y: 15 },
   * ]);
   * ```
   */
  createPieChart(
    title: string,
    data: ChartDataPoint[],
    options?: Partial<ChartConfig>
  ): ChartConfig {
    const series: ChartSeries[] = [
      {
        id: generateId(),
        name: title,
        data: data.map((point, i) => ({
          ...point,
          color: point.color ?? this.getColorForIndex(i),
        })),
      },
    ];
    return this.buildChart('pie', title, series, options);
  }

  /**
   * Create a funnel chart configuration.
   *
   * @param title - Chart title
   * @param funnel - Funnel data with steps and conversion
   * @returns A complete {@link ChartConfig} for a funnel chart
   *
   * @example
   * ```typescript
   * const chart = engine.createFunnelChart('Signup Funnel', {
   *   steps: [
   *     { name: 'Visit', count: 1000, percentage: 100, dropoff: 0 },
   *     { name: 'Signup', count: 400, percentage: 40, dropoff: 60 },
   *   ],
   *   totalConversion: 0.4,
   * });
   * ```
   */
  createFunnelChart(title: string, funnel: FunnelChartData): ChartConfig {
    const series: ChartSeries[] = [
      {
        id: generateId(),
        name: title,
        data: funnel.steps.map((step, i) => ({
          x: step.name,
          y: step.count,
          label: `${step.percentage.toFixed(1)}%`,
          color: this.getColorForIndex(i),
          metadata: { dropoff: step.dropoff, percentage: step.percentage },
        })),
      },
    ];
    return this.buildChart('funnel', title, series, {
      description: `Overall conversion: ${(funnel.totalConversion * 100).toFixed(1)}%`,
    });
  }

  /**
   * Create a retention grid chart configuration.
   *
   * @param title - Chart title
   * @param retention - Retention cohort data
   * @returns A complete {@link ChartConfig} for a retention grid
   *
   * @example
   * ```typescript
   * const chart = engine.createRetentionGrid('Weekly Retention', {
   *   cohorts: [{ period: 'Week 1', size: 500, retention: [100, 60, 45] }],
   *   periods: ['Week 0', 'Week 1', 'Week 2'],
   * });
   * ```
   */
  createRetentionGrid(title: string, retention: RetentionGridData): ChartConfig {
    const series: ChartSeries[] = retention.cohorts.map((cohort, i) => ({
      id: `cohort_${i}`,
      name: cohort.period,
      data: cohort.retention.map((rate, j) => ({
        x: retention.periods[j] ?? `Period ${j}`,
        y: rate,
        label: `${rate.toFixed(1)}%`,
        metadata: { cohortSize: cohort.size },
      })),
    }));
    return this.buildChart('retention-grid', title, series);
  }

  /**
   * Create a metric card chart configuration.
   *
   * @param title - Metric name / card title
   * @param metric - Metric card data with value, trend, and optional sparkline
   * @returns A complete {@link ChartConfig} for a metric card
   *
   * @example
   * ```typescript
   * const card = engine.createMetricCard('Active Users', {
   *   value: 1234,
   *   previousValue: 1100,
   *   change: 134,
   *   changePercent: 12.2,
   *   trend: 'up',
   *   format: 'number',
   *   sparkline: [980, 1020, 1100, 1150, 1234],
   * });
   * ```
   */
  createMetricCard(title: string, metric: MetricCardData): ChartConfig {
    const mainPoint: ChartDataPoint = {
      x: title,
      y: metric.value,
      label: this.formatNumber(metric.value, metric.format),
      metadata: {
        previousValue: metric.previousValue,
        change: metric.change,
        changePercent: metric.changePercent,
        trend: metric.trend,
      },
    };

    const sparklineSeries: ChartSeries[] = metric.sparkline
      ? [
          {
            id: `sparkline_${generateId()}`,
            name: 'sparkline',
            data: metric.sparkline.map((v, i) => ({ x: i, y: v })),
          },
        ]
      : [];

    return this.buildChart('metric-card', title, [
      { id: generateId(), name: title, data: [mainPoint] },
      ...sparklineSeries,
    ]);
  }

  /**
   * Create an area chart configuration.
   *
   * @param title - Chart title
   * @param series - One or more data series
   * @param options - Optional overrides for the chart config
   * @returns A complete {@link ChartConfig} for an area chart
   *
   * @example
   * ```typescript
   * const chart = engine.createAreaChart('Page Views', [
   *   { id: 'pv', name: 'Page Views', data: [{ x: 'Mon', y: 200 }, { x: 'Tue', y: 350 }] },
   * ]);
   * ```
   */
  createAreaChart(
    title: string,
    series: ChartSeries[],
    options?: Partial<ChartConfig>
  ): ChartConfig {
    return this.buildChart('area', title, series, options);
  }

  // -----------------------------------------------------------------------
  // Formatters
  // -----------------------------------------------------------------------

  /**
   * Format a numeric value for display.
   *
   * @param value - Number to format
   * @param format - Display format hint
   * @returns Formatted string
   *
   * @example
   * ```typescript
   * engine.formatNumber(1234.5, 'currency'); // '$1,234.50'
   * engine.formatNumber(0.42, 'percent');    // '42%'
   * ```
   */
  formatNumber(value: number, format?: string): string {
    switch (format) {
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      case 'currency':
        return new Intl.NumberFormat(this.config.numberLocale, {
          style: 'currency',
          currency: this.config.currency,
        }).format(value);
      case 'duration': {
        const seconds = Math.floor(value / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
      }
      default:
        return new Intl.NumberFormat(this.config.numberLocale).format(value);
    }
  }

  /**
   * Format a date or timestamp for display.
   *
   * @param date - Date object or Unix timestamp (ms)
   * @param format - Optional format override (unused in default implementation)
   * @returns ISO date string (yyyy-MM-dd)
   *
   * @example
   * ```typescript
   * engine.formatDate(new Date('2024-01-15')); // '2024-01-15'
   * engine.formatDate(1705276800000);           // '2024-01-15'
   * ```
   */
  formatDate(date: Date | number, _format?: string): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Return the palette colour for a given index (wraps around).
   *
   * @param index - Zero-based index
   * @returns Hex colour string
   *
   * @example
   * ```typescript
   * engine.getColorForIndex(0); // '#6366f1'
   * engine.getColorForIndex(12); // '#6366f1' (wraps)
   * ```
   */
  getColorForIndex(index: number): string {
    const palette = this.config.colorPalette;
    return palette[index % palette.length]!;
  }

  // -----------------------------------------------------------------------
  // Observable
  // -----------------------------------------------------------------------

  /**
   * Observable of all charts created by this engine.
   */
  get charts$(): Observable<ChartConfig[]> {
    return this.charts$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose the engine and release resources.
   */
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.destroy$.next();
    this.destroy$.complete();
    this.charts$$.complete();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildChart(
    type: ChartType,
    title: string,
    series: ChartSeries[],
    options?: Partial<ChartConfig>
  ): ChartConfig {
    const coloured = series.map((s, i) => ({
      ...s,
      color: s.color ?? this.getColorForIndex(i),
    }));

    const chart: ChartConfig = {
      id: generateId(),
      type,
      title,
      series: coloured,
      colors: this.config.colorPalette,
      interactive: true,
      legend: { show: true, position: 'bottom' },
      ...options,
    };

    const current = this.charts$$.getValue();
    this.charts$$.next([...current, chart]);

    return chart;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new VisualizationEngine instance.
 *
 * @param config - Optional visualisation configuration
 * @returns A new {@link VisualizationEngine}
 *
 * @example
 * ```typescript
 * import { createVisualizationEngine } from '@pocket/analytics';
 *
 * const engine = createVisualizationEngine({ currency: 'EUR' });
 * const chart = engine.createLineChart('Sales', series);
 * ```
 */
export function createVisualizationEngine(config?: VisualizationConfig): VisualizationEngine {
  return new VisualizationEngine(config);
}

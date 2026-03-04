/**
 * Dashboard SDK - Framework-agnostic render descriptors for OLAP results.
 */

import type { OLAPResult, PivotResult } from './types.js';

/** Chart descriptor for OLAP results */
export interface OLAPChartDescriptor {
  type: 'bar' | 'line' | 'pie' | 'heatmap' | 'treemap';
  data: Record<string, unknown>[];
  xField: string;
  yField: string;
  series?: string;
  title?: string;
}

/** Pivot table descriptor */
export interface PivotTableDescriptor {
  pivot: PivotResult;
  title?: string;
  formatters?: Record<string, (v: unknown) => string>;
}

/** Metric card descriptor for single KPI */
export interface OLAPMetricDescriptor {
  label: string;
  value: number;
  previousValue?: number;
  format?: string;
  trend?: 'up' | 'down' | 'flat';
}

/** Build a chart descriptor from an OLAP result */
export function buildOLAPChart(
  result: OLAPResult,
  config: Partial<OLAPChartDescriptor>,
): OLAPChartDescriptor {
  return {
    type: config.type ?? 'bar',
    data: result.data,
    xField:
      config.xField ??
      result.metadata.dimensions[0] ??
      '',
    yField:
      config.yField ??
      result.metadata.measures[0] ??
      '',
    series: config.series,
    title: config.title,
  };
}

/** Build a pivot table descriptor */
export function buildPivotTable(
  pivot: PivotResult,
  title?: string,
): PivotTableDescriptor {
  return { pivot, title };
}

/** Build a metric card from an OLAP result */
export function buildOLAPMetric(
  label: string,
  result: OLAPResult,
  field: string,
  compareTo?: OLAPResult,
): OLAPMetricDescriptor {
  const value = Number(result.data[0]?.[field] ?? 0);
  const descriptor: OLAPMetricDescriptor = { label, value };

  if (compareTo) {
    const prev = Number(compareTo.data[0]?.[field] ?? 0);
    descriptor.previousValue = prev;
    if (value > prev) descriptor.trend = 'up';
    else if (value < prev) descriptor.trend = 'down';
    else descriptor.trend = 'flat';
  }

  return descriptor;
}

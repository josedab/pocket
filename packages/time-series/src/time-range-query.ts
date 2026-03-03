/**
 * Time-range query executor with windowing functions.
 */

export interface TimeRangeQuery {
  metric: string;
  from: number;
  to: number;
  window?: WindowConfig;
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
  groupByTag?: string;
  limit?: number;
}

export interface WindowConfig {
  type: 'tumbling' | 'sliding' | 'session';
  size: number;
  slide?: number; // For sliding windows
  gap?: number; // For session windows
}

export interface WindowResult {
  windowStart: number;
  windowEnd: number;
  value: number;
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
}

export interface QueryResult {
  metric: string;
  from: number;
  to: number;
  points: { timestamp: number; value: number; tags?: Record<string, string> }[];
  windows?: WindowResult[];
  groups?: Record<string, { timestamp: number; value: number }[]>;
  stats: {
    pointCount: number;
    executionMs: number;
  };
}

interface DataPoint {
  timestamp: number;
  value: number;
  tags?: Record<string, string>;
}

/**
 * Executes time-range queries with windowing functions.
 */
export class TimeRangeQueryExecutor {
  /** Execute a query against a set of points */
  execute(query: TimeRangeQuery, points: DataPoint[]): QueryResult {
    const start = Date.now();

    // Filter to time range
    let filtered = points.filter((p) => p.timestamp >= query.from && p.timestamp <= query.to);

    // Sort by timestamp
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    // Apply limit
    if (query.limit) {
      filtered = filtered.slice(0, query.limit);
    }

    const result: QueryResult = {
      metric: query.metric,
      from: query.from,
      to: query.to,
      points: filtered,
      stats: { pointCount: filtered.length, executionMs: 0 },
    };

    // Apply windowing
    if (query.window) {
      result.windows = this.applyWindow(filtered, query.window, query.aggregation);
    }

    // Apply groupBy
    if (query.groupByTag) {
      result.groups = this.groupByTag(filtered, query.groupByTag, query.aggregation);
    }

    result.stats.executionMs = Date.now() - start;
    return result;
  }

  private applyWindow(
    points: DataPoint[],
    config: WindowConfig,
    aggregation?: string
  ): WindowResult[] {
    switch (config.type) {
      case 'tumbling':
        return this.tumblingWindow(points, config.size, aggregation);
      case 'sliding':
        return this.slidingWindow(
          points,
          config.size,
          config.slide ?? config.size / 2,
          aggregation
        );
      case 'session':
        return this.sessionWindow(points, config.gap ?? config.size, aggregation);
      default:
        return this.tumblingWindow(points, config.size, aggregation);
    }
  }

  private tumblingWindow(points: DataPoint[], size: number, _agg?: string): WindowResult[] {
    if (points.length === 0) return [];

    const minTs = points[0]!.timestamp;
    const maxTs = points[points.length - 1]!.timestamp;
    const windows: WindowResult[] = [];

    for (let start = Math.floor(minTs / size) * size; start <= maxTs; start += size) {
      const end = start + size;
      const windowPoints = points.filter((p) => p.timestamp >= start && p.timestamp < end);
      if (windowPoints.length > 0) {
        windows.push(this.computeWindowResult(start, end, windowPoints));
      }
    }

    return windows;
  }

  private slidingWindow(
    points: DataPoint[],
    size: number,
    slide: number,
    _agg?: string
  ): WindowResult[] {
    if (points.length === 0) return [];

    const minTs = points[0]!.timestamp;
    const maxTs = points[points.length - 1]!.timestamp;
    const windows: WindowResult[] = [];

    for (let start = Math.floor(minTs / slide) * slide; start <= maxTs; start += slide) {
      const end = start + size;
      const windowPoints = points.filter((p) => p.timestamp >= start && p.timestamp < end);
      if (windowPoints.length > 0) {
        windows.push(this.computeWindowResult(start, end, windowPoints));
      }
    }

    return windows;
  }

  private sessionWindow(points: DataPoint[], gap: number, _agg?: string): WindowResult[] {
    if (points.length === 0) return [];

    const windows: WindowResult[] = [];
    let sessionStart = points[0]!.timestamp;
    let sessionPoints: DataPoint[] = [points[0]!];

    for (let i = 1; i < points.length; i++) {
      if (points[i]!.timestamp - points[i - 1]!.timestamp > gap) {
        // New session
        windows.push(
          this.computeWindowResult(sessionStart, points[i - 1]!.timestamp + 1, sessionPoints)
        );
        sessionStart = points[i]!.timestamp;
        sessionPoints = [points[i]!];
      } else {
        sessionPoints.push(points[i]!);
      }
    }

    // Final session
    if (sessionPoints.length > 0) {
      windows.push(
        this.computeWindowResult(
          sessionStart,
          sessionPoints[sessionPoints.length - 1]!.timestamp + 1,
          sessionPoints
        )
      );
    }

    return windows;
  }

  private computeWindowResult(start: number, end: number, points: DataPoint[]): WindowResult {
    const values = points.map((p) => p.value);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      windowStart: start,
      windowEnd: end,
      value: sum / values.length,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length,
      sum,
    };
  }

  private groupByTag(
    points: DataPoint[],
    tagKey: string,
    _agg?: string
  ): Record<string, { timestamp: number; value: number }[]> {
    const groups: Record<string, { timestamp: number; value: number }[]> = {};

    for (const point of points) {
      const tagValue = point.tags?.[tagKey] ?? '_untagged';
      groups[tagValue] ??= [];
      groups[tagValue].push({ timestamp: point.timestamp, value: point.value });
    }

    return groups;
  }
}

export function createTimeRangeQueryExecutor(): TimeRangeQueryExecutor {
  return new TimeRangeQueryExecutor();
}

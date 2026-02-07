/**
 * Types for time-series optimized storage
 */

/**
 * A single time-series data point
 */
export interface TimeSeriesPoint {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Numeric value */
  value: number;
  /** Optional key-value tags for filtering */
  tags?: Record<string, string>;
}

/**
 * Aggregation function for downsampling
 */
export type AggregationFunction = 'avg' | 'min' | 'max' | 'sum' | 'count' | 'first' | 'last';

/**
 * Retention policy for time-series data
 */
export interface RetentionPolicy {
  /** Time-to-live for raw data in milliseconds */
  rawDataTTL: number;
  /** Time-to-live for downsampled data in milliseconds */
  downsampledTTL: number;
  /** Maximum number of data points to retain */
  maxDataPoints: number;
}

/**
 * Rule for automatic downsampling
 */
export interface DownsamplingRule {
  /** Source interval in milliseconds */
  sourceInterval: number;
  /** Target interval in milliseconds */
  targetInterval: number;
  /** Aggregation function to apply */
  aggregation: AggregationFunction;
}

/**
 * Configuration for a time-series store
 */
export interface TimeSeriesConfig {
  /** Name of the time series */
  name: string;
  /** Retention policy */
  retention: RetentionPolicy;
  /** Downsampling rules */
  downsamplingRules: DownsamplingRule[];
  /** Size of each time bucket in milliseconds */
  bucketSize: number;
}

/**
 * A time range for querying
 */
export interface TimeRange {
  /** Start timestamp (inclusive) in milliseconds */
  start: number;
  /** End timestamp (inclusive) in milliseconds */
  end: number;
}

/**
 * Window function type for time-series analysis
 */
export type WindowFunction = 'moving-average' | 'ewma' | 'rate' | 'delta';

/**
 * Configuration for a window function
 */
export interface WindowConfig {
  /** Window function to apply */
  function: WindowFunction;
  /** Window size (number of points for moving average, alpha for EWMA) */
  windowSize: number;
}

/**
 * Result of a time-series query
 */
export interface TimeSeriesQueryResult {
  /** Matching data points */
  points: TimeSeriesPoint[];
  /** Computed statistics */
  stats: {
    min: number;
    max: number;
    avg: number;
    count: number;
    sum: number;
  };
  /** Query execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Information about a time bucket
 */
export interface BucketInfo {
  /** Bucket start timestamp */
  startTime: number;
  /** Bucket end timestamp */
  endTime: number;
  /** Number of points in the bucket */
  pointCount: number;
}

/**
 * Default time-series configuration
 */
export const DEFAULT_TIME_SERIES_CONFIG: TimeSeriesConfig = {
  name: 'default',
  retention: {
    rawDataTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
    downsampledTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxDataPoints: 1_000_000,
  },
  downsamplingRules: [],
  bucketSize: 60 * 60 * 1000, // 1 hour
};

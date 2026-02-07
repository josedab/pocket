/**
 * @pocket/time-series - Time-series optimized storage for Pocket
 *
 * @example
 * ```typescript
 * import { createTimeSeriesStore } from '@pocket/time-series';
 *
 * // Create a time-series store
 * const store = createTimeSeriesStore({
 *   name: 'cpu-metrics',
 *   bucketSize: 60_000, // 1-minute buckets
 *   retention: {
 *     rawDataTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
 *     downsampledTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
 *     maxDataPoints: 1_000_000,
 *   },
 * });
 *
 * // Insert data points
 * store.insert({ timestamp: Date.now(), value: 72.5, tags: { host: 'server-1' } });
 * store.insertBatch([
 *   { timestamp: Date.now() + 1000, value: 68.2, tags: { host: 'server-1' } },
 *   { timestamp: Date.now() + 2000, value: 75.1, tags: { host: 'server-2' } },
 * ]);
 *
 * // Query with time range and tag filter
 * const result = store.query(
 *   { start: Date.now() - 60_000, end: Date.now() },
 *   { tags: { host: 'server-1' } },
 * );
 * console.log(result.stats); // { min, max, avg, count, sum }
 *
 * // Apply moving average
 * const smoothed = store.applyWindow(result.points, {
 *   function: 'moving-average',
 *   windowSize: 5,
 * });
 * ```
 */

// Types
export type {
  AggregationFunction,
  BucketInfo,
  DownsamplingRule,
  RetentionPolicy,
  TimeRange,
  TimeSeriesConfig,
  TimeSeriesPoint,
  TimeSeriesQueryResult,
  WindowConfig,
  WindowFunction,
} from './types.js';

export { DEFAULT_TIME_SERIES_CONFIG } from './types.js';

// Time Series Store
export { TimeSeriesStore, createTimeSeriesStore } from './time-series-store.js';

// Compression
export { GorillaCompressor, createGorillaCompressor } from './compression.js';

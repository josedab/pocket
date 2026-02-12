/**
 * Core types for the prefetch package.
 */

/** Represents a recorded query pattern used for prediction. */
export interface QueryPattern {
  queryHash: string;
  collection: string;
  filter: Record<string, unknown>;
  frequency: number;
  lastAccessed: number;
  avgExecutionMs: number;
}

/** A prediction of a future query with confidence score. */
export interface PredictionResult {
  queryHash: string;
  confidence: number;
  pattern: QueryPattern;
}

/** Configuration for the prefetch engine. */
export interface PrefetchConfig {
  maxCacheSize: number;
  maxPredictions: number;
  confidenceThreshold: number;
  idleDelayMs: number;
  enableAdaptiveLearning: boolean;
  ttlMs: number;
}

/** A cached query result with metadata. */
export interface CacheEntry<T = unknown> {
  queryHash: string;
  data: T[];
  cachedAt: number;
  ttl: number;
  hitCount: number;
}

/** Statistics about prefetch performance. */
export interface PrefetchStats {
  cacheHits: number;
  cacheMisses: number;
  totalPredictions: number;
  accuratePredictions: number;
  cacheSize: number;
  hitRate: number;
}

/** An event emitted during pattern analysis. */
export interface PatternEvent {
  type: 'query-executed' | 'cache-hit' | 'cache-miss' | 'prediction-made';
  timestamp: number;
  queryHash: string;
}

/** Default prefetch configuration. */
export const DEFAULT_PREFETCH_CONFIG: PrefetchConfig = {
  maxCacheSize: 50,
  maxPredictions: 5,
  confidenceThreshold: 0.3,
  idleDelayMs: 1000,
  enableAdaptiveLearning: true,
  ttlMs: 60_000,
};

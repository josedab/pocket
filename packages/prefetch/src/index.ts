/**
 * @pocket/prefetch - Predictive data prefetching for Pocket
 *
 * @example
 * ```typescript
 * import { createPrefetchEngine } from '@pocket/prefetch';
 *
 * const engine = createPrefetchEngine({
 *   maxCacheSize: 100,
 *   confidenceThreshold: 0.4,
 *   idleDelayMs: 2000,
 * });
 *
 * // Register a callback to fetch data for predicted queries
 * engine.onPrefetchNeeded(async (prediction) => {
 *   const { collection, filter } = prediction.pattern;
 *   return db.find(collection, filter);
 * });
 *
 * // Record queries as they happen
 * engine.recordQuery('todos', { completed: false }, 12, results);
 * engine.recordQuery('users', { role: 'admin' }, 8, users);
 *
 * // Later, check for prefetched results
 * const cached = engine.getCached('todos', { completed: false });
 * if (cached) {
 *   console.log('Cache hit!', cached);
 * }
 *
 * // Start automatic prefetching
 * engine.start();
 *
 * // Get statistics
 * const stats = engine.getStats();
 * console.log(`Hit rate: ${stats.hitRate}`);
 * ```
 */

// Types
export type {
  CacheEntry,
  PatternEvent,
  PredictionResult,
  PrefetchConfig,
  PrefetchStats,
  QueryPattern,
} from './types.js';

export { DEFAULT_PREFETCH_CONFIG } from './types.js';

// Pattern Analyzer
export { PatternAnalyzer, createPatternAnalyzer } from './pattern-analyzer.js';

// Prefetch Cache
export { PrefetchCache, createPrefetchCache } from './prefetch-cache.js';

// Prefetch Engine
export type { PrefetchCallback } from './prefetch-engine.js';

export { PrefetchEngine, createPrefetchEngine } from './prefetch-engine.js';

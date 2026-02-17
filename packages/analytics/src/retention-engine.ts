/**
 * Event retention pruning engine for analytics.
 *
 * Auto-prunes old analytics events based on configurable retention
 * policies, with support for age-based, count-based, and
 * size-based retention limits.
 *
 * @module retention-engine
 */

import type { AnalyticsEvent } from './types.js';

/** Retention policy configuration */
export interface RetentionPolicyConfig {
  /** Maximum age of events in milliseconds (0 = unlimited) */
  readonly maxAgeMs?: number;
  /** Maximum number of events to keep (0 = unlimited) */
  readonly maxCount?: number;
  /** Maximum total storage size estimate in bytes (0 = unlimited) */
  readonly maxSizeBytes?: number;
  /** Events matching these names are exempt from pruning */
  readonly exemptEvents?: readonly string[];
  /** Average bytes per event estimate (default: 200) */
  readonly avgEventSizeBytes?: number;
}

/** Result of a pruning operation */
export interface PruneResult {
  readonly prunedCount: number;
  readonly remainingCount: number;
  readonly prunedByAge: number;
  readonly prunedByCount: number;
  readonly prunedBySize: number;
  readonly durationMs: number;
}

/**
 * Prunes analytics events based on retention policies.
 *
 * @example
 * ```typescript
 * const engine = new RetentionEngine({
 *   maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
 *   maxCount: 100_000,
 *   exemptEvents: ['purchase', 'signup'],
 * });
 *
 * const events = getAllEvents();
 * const result = engine.prune(events);
 * console.log(`Pruned ${result.prunedCount} events`);
 * saveEvents(result.remaining);
 * ```
 */
export class RetentionEngine {
  private readonly config: Required<RetentionPolicyConfig>;

  constructor(config: RetentionPolicyConfig = {}) {
    this.config = {
      maxAgeMs: config.maxAgeMs ?? 0,
      maxCount: config.maxCount ?? 0,
      maxSizeBytes: config.maxSizeBytes ?? 0,
      exemptEvents: config.exemptEvents ?? [],
      avgEventSizeBytes: config.avgEventSizeBytes ?? 200,
    };
  }

  /** Prune events, returning which to keep and pruning stats */
  prune(events: AnalyticsEvent[]): PruneResult & { remaining: AnalyticsEvent[] } {
    const start = Date.now();
    const exempt = new Set(this.config.exemptEvents);
    let prunedByAge = 0;
    let prunedByCount = 0;
    let prunedBySize = 0;

    // Separate exempt events
    const exemptEvents = events.filter((e) => exempt.has(e.name));
    let candidates = events.filter((e) => !exempt.has(e.name));

    // Sort by timestamp descending (keep newest)
    candidates.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    // Age-based pruning
    if (this.config.maxAgeMs > 0) {
      const cutoff = Date.now() - this.config.maxAgeMs;
      const before = candidates.length;
      candidates = candidates.filter((e) => (e.timestamp ?? 0) >= cutoff);
      prunedByAge = before - candidates.length;
    }

    // Count-based pruning
    if (this.config.maxCount > 0) {
      const maxNonExempt = Math.max(0, this.config.maxCount - exemptEvents.length);
      if (candidates.length > maxNonExempt) {
        prunedByCount = candidates.length - maxNonExempt;
        candidates = candidates.slice(0, maxNonExempt);
      }
    }

    // Size-based pruning
    if (this.config.maxSizeBytes > 0) {
      const maxEvents = Math.floor(this.config.maxSizeBytes / this.config.avgEventSizeBytes);
      const maxNonExempt = Math.max(0, maxEvents - exemptEvents.length);
      if (candidates.length > maxNonExempt) {
        prunedBySize = candidates.length - maxNonExempt;
        candidates = candidates.slice(0, maxNonExempt);
      }
    }

    const remaining = [...exemptEvents, ...candidates];
    const totalPruned = prunedByAge + prunedByCount + prunedBySize;

    return {
      remaining,
      prunedCount: totalPruned,
      remainingCount: remaining.length,
      prunedByAge,
      prunedByCount,
      prunedBySize,
      durationMs: Date.now() - start,
    };
  }

  /** Check if pruning is needed based on current event count */
  needsPruning(eventCount: number): boolean {
    if (this.config.maxCount > 0 && eventCount > this.config.maxCount) return true;
    if (this.config.maxSizeBytes > 0) {
      const estimatedSize = eventCount * this.config.avgEventSizeBytes;
      if (estimatedSize > this.config.maxSizeBytes) return true;
    }
    return false;
  }

  /** Get the configured retention limits */
  getLimits(): RetentionPolicyConfig {
    return { ...this.config };
  }
}

/** Factory function */
export function createRetentionEngine(config?: RetentionPolicyConfig): RetentionEngine {
  return new RetentionEngine(config);
}

/**
 * @module merge-resolver
 *
 * Configurable merge resolution strategies for CRDT conflicts.
 */

import type { MergeConflict, MergeStrategy } from './types.js';

/**
 * A resolver function that decides the winning value for a conflict.
 */
export type ConflictResolver = (conflict: MergeConflict) => unknown;

/**
 * Configuration for creating a merge resolver.
 */
export interface MergeResolverConfig {
  /** Default strategy for all fields */
  readonly defaultStrategy: MergeStrategy;
  /** Per-field strategy overrides (field path -> strategy) */
  readonly fieldStrategies?: Record<string, MergeStrategy>;
  /** Custom resolver function for 'custom' strategy */
  readonly customResolver?: ConflictResolver;
}

/**
 * A merge resolver that applies configurable strategies to CRDT conflicts.
 */
export interface MergeResolver {
  /** Resolve a single conflict using configured strategies */
  resolve(conflict: MergeConflict): unknown;
  /** Resolve all conflicts in a batch */
  resolveAll(conflicts: readonly MergeConflict[]): readonly {
    readonly conflict: MergeConflict;
    readonly resolvedValue: unknown;
  }[];
  /** Get the strategy configured for a given field path */
  getStrategy(path: readonly (string | number)[]): MergeStrategy;
}

/**
 * Creates a configurable merge resolver for CRDT conflicts.
 *
 * @param config - Resolution configuration
 * @returns A MergeResolver instance
 *
 * @example
 * ```typescript
 * const resolver = createMergeResolver({
 *   defaultStrategy: 'last-writer-wins',
 *   fieldStrategies: {
 *     'content': 'field-level-merge',
 *     'metadata.tags': 'auto',
 *   },
 * });
 * ```
 */
export function createMergeResolver(config: MergeResolverConfig): MergeResolver {
  const { defaultStrategy, fieldStrategies = {}, customResolver } = config;

  function getStrategy(path: readonly (string | number)[]): MergeStrategy {
    const pathStr = path.join('.');
    // Check exact match, then prefix matches
    if (fieldStrategies[pathStr]) return fieldStrategies[pathStr];

    for (const [pattern, strategy] of Object.entries(fieldStrategies)) {
      if (pathStr.startsWith(pattern)) return strategy;
    }

    return defaultStrategy;
  }

  function resolve(conflict: MergeConflict): unknown {
    const strategy = getStrategy(conflict.path);

    switch (strategy) {
      case 'last-writer-wins':
        return conflict.resolvedValue;

      case 'field-level-merge': {
        if (
          typeof conflict.localValue === 'object' &&
          typeof conflict.remoteValue === 'object' &&
          conflict.localValue !== null &&
          conflict.remoteValue !== null
        ) {
          return {
            ...(conflict.localValue as Record<string, unknown>),
            ...(conflict.remoteValue as Record<string, unknown>),
          };
        }
        return conflict.resolvedValue;
      }

      case 'auto': {
        if (typeof conflict.localValue === 'number' && typeof conflict.remoteValue === 'number') {
          return conflict.localValue + conflict.remoteValue;
        }
        if (typeof conflict.localValue === 'string' && typeof conflict.remoteValue === 'string') {
          return conflict.localValue.length >= conflict.remoteValue.length
            ? conflict.localValue
            : conflict.remoteValue;
        }
        if (Array.isArray(conflict.localValue) && Array.isArray(conflict.remoteValue)) {
          return [...new Set([...conflict.localValue, ...conflict.remoteValue])];
        }
        return conflict.resolvedValue;
      }

      case 'custom':
        if (customResolver) return customResolver(conflict);
        return conflict.resolvedValue;

      default:
        return conflict.resolvedValue;
    }
  }

  function resolveAll(
    conflicts: readonly MergeConflict[],
  ): readonly { readonly conflict: MergeConflict; readonly resolvedValue: unknown }[] {
    return conflicts.map((c) => ({
      conflict: c,
      resolvedValue: resolve(c),
    }));
  }

  return { resolve, resolveAll, getStrategy };
}

/**
 * @pocket/query-advisor — Query performance advisor for Pocket databases.
 *
 * Analyzes query patterns, identifies slow queries, suggests index creation,
 * and provides optimization recommendations with runtime profiling.
 *
 * @example
 * ```ts
 * import { createQueryAdvisor } from '@pocket/query-advisor';
 *
 * const advisor = createQueryAdvisor({ slowQueryThresholdMs: 50 });
 *
 * // Record query executions
 * advisor.recordQuery({
 *   collection: 'users',
 *   filter: { role: 'admin' },
 *   executionTimeMs: 150,
 *   documentsScanned: 10000,
 *   documentsReturned: 5,
 *   indexUsed: null,
 * });
 *
 * // Analyze and get recommendations
 * const report = advisor.analyze();
 * console.log(report.recommendations);
 * console.log(report.indexSuggestions);
 *
 * // Explain a query plan
 * const plan = advisor.explainQuery('users', { role: 'admin' });
 * ```
 *
 * @module @pocket/query-advisor
 */

// Types
export type {
  CollectionQueryStats,
  DiagnosticsReport,
  ExistingIndex,
  IndexSuggestion,
  QueryAdvisorConfig,
  QueryPattern,
  QueryPlanNode,
  QueryProfile,
  Recommendation,
  RecommendationType,
} from './types.js';

// Query Advisor
export {
  QueryAdvisor,
  createQueryAdvisor,
} from './query-advisor.js';
export type { AdvisorEvent } from './query-advisor.js';

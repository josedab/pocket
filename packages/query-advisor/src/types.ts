/**
 * @pocket/query-advisor — Types for the query performance advisor.
 *
 * @module @pocket/query-advisor
 */

// ── Query Profile Types ───────────────────────────────────

export interface QueryProfile {
  id: string;
  collection: string;
  filter: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  fields?: string[];
  executionTimeMs: number;
  documentsScanned: number;
  documentsReturned: number;
  indexUsed: string | null;
  timestamp: number;
}

export interface QueryPattern {
  collection: string;
  filterFields: string[];
  sortFields: string[];
  frequency: number;
  avgExecutionTimeMs: number;
  maxExecutionTimeMs: number;
  totalExecutions: number;
  firstSeen: number;
  lastSeen: number;
}

// ── Index Types ───────────────────────────────────────────

export interface IndexSuggestion {
  collection: string;
  fields: string[];
  type: 'single' | 'compound' | 'covering';
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
  affectedQueries: number;
  priority: number;
}

export interface ExistingIndex {
  name: string;
  collection: string;
  fields: string[];
  unique: boolean;
  usageCount: number;
  lastUsed: number | null;
}

// ── Recommendation Types ──────────────────────────────────

export type RecommendationType =
  | 'create_index'
  | 'remove_unused_index'
  | 'add_limit'
  | 'use_projection'
  | 'restructure_query'
  | 'add_sort_index'
  | 'split_compound_query';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  collection: string;
  suggestedAction?: string;
  estimatedImprovement?: string;
  relatedQueries: string[];
}

// ── Diagnostics Types ─────────────────────────────────────

export interface QueryPlanNode {
  type: 'collection_scan' | 'index_scan' | 'filter' | 'sort' | 'limit' | 'projection';
  collection?: string;
  index?: string;
  fields?: string[];
  estimatedCost: number;
  children?: QueryPlanNode[];
}

export interface DiagnosticsReport {
  generatedAt: number;
  totalQueriesProfiled: number;
  slowQueries: QueryProfile[];
  patterns: QueryPattern[];
  indexSuggestions: IndexSuggestion[];
  recommendations: Recommendation[];
  unusedIndexes: ExistingIndex[];
  collectionStats: CollectionQueryStats[];
}

export interface CollectionQueryStats {
  collection: string;
  totalQueries: number;
  avgExecutionTimeMs: number;
  p95ExecutionTimeMs: number;
  p99ExecutionTimeMs: number;
  fullScans: number;
  indexedQueries: number;
}

export interface QueryAdvisorConfig {
  /** Execution time threshold for slow queries (ms, default: 100) */
  slowQueryThresholdMs?: number;
  /** Maximum profiles to retain (default: 10000) */
  maxProfiles?: number;
  /** Enable auto-analysis (default: true) */
  autoAnalyze?: boolean;
  /** Analysis interval (ms, default: 60000) */
  analysisIntervalMs?: number;
  /** Minimum query frequency to generate suggestions (default: 3) */
  minFrequencyForSuggestion?: number;
}

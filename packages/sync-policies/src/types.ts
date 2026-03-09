/**
 * @pocket/sync-policies — Types for the selective sync policies DSL.
 *
 * @module @pocket/sync-policies
 */

// ── Core Policy Types ─────────────────────────────────────

export type SyncDirection = 'push' | 'pull' | 'both' | 'none';
export type SyncPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type ConflictStrategy = 'server-wins' | 'client-wins' | 'latest-wins' | 'merge' | 'manual';

export interface SyncPolicyDefinition {
  name: string;
  description?: string;
  version: number;
  collections: CollectionPolicyDefinition[];
  globals?: GlobalPolicyConfig;
  userScopes?: UserScopeDefinition[];
  bandwidthConfig?: BandwidthConfig;
}

export interface CollectionPolicyDefinition {
  collection: string;
  direction: SyncDirection;
  priority: SyncPriority;
  fields?: FieldPolicy;
  filter?: FilterExpression;
  conflictStrategy?: ConflictStrategy;
  batchSize?: number;
  rateLimit?: number;
  ttl?: number;
  enabled: boolean;
}

export interface FieldPolicy {
  mode: 'include' | 'exclude';
  fields: string[];
}

export interface GlobalPolicyConfig {
  defaultDirection: SyncDirection;
  defaultPriority: SyncPriority;
  defaultConflictStrategy: ConflictStrategy;
  maxBatchSize: number;
  maxDocumentSizeBytes: number;
  syncIntervalMs: number;
  enableCompression: boolean;
}

export interface UserScopeDefinition {
  name: string;
  condition: UserCondition;
  overrides: Partial<CollectionPolicyDefinition>;
}

export interface UserCondition {
  roles?: string[];
  properties?: Record<string, unknown>;
  custom?: string;
}

export interface BandwidthConfig {
  mode: 'unlimited' | 'metered' | 'offline';
  maxBytesPerSync?: number;
  throttleMs?: number;
  prioritizeCollections?: string[];
}

// ── Filter Expression Types ───────────────────────────────

export type FilterExpression =
  | ComparisonFilter
  | LogicalFilter
  | ExistsFilter
  | InFilter
  | TimeFilter
  | CustomFilter;

export interface ComparisonFilter {
  type: 'comparison';
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  value: unknown;
}

export interface LogicalFilter {
  type: 'and' | 'or' | 'not';
  conditions: FilterExpression[];
}

export interface ExistsFilter {
  type: 'exists';
  field: string;
  exists: boolean;
}

export interface InFilter {
  type: 'in';
  field: string;
  values: unknown[];
  negate?: boolean;
}

export interface TimeFilter {
  type: 'time';
  field: string;
  since?: number | string;
  until?: number | string;
}

export interface CustomFilter {
  type: 'custom';
  name: string;
  params?: Record<string, unknown>;
}

// ── Evaluation Types ──────────────────────────────────────

export interface PolicyEvaluationResult {
  shouldSync: boolean;
  direction: SyncDirection;
  priority: SyncPriority;
  conflictStrategy: ConflictStrategy;
  filteredFields?: string[];
  matchedRules: string[];
  reason: string;
}

export interface PolicyValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: PolicyValidationError[];
  warnings: PolicyValidationError[];
}

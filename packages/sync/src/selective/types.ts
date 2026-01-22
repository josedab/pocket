import type { Document, QueryFilter } from '@pocket/core';

/**
 * Sync filter operator for comparisons
 */
export type SyncFilterOperator =
  | '$eq' // Equal
  | '$ne' // Not equal
  | '$gt' // Greater than
  | '$gte' // Greater than or equal
  | '$lt' // Less than
  | '$lte' // Less than or equal
  | '$in' // In array
  | '$nin' // Not in array
  | '$exists'; // Field exists

/**
 * Sync filter value with operator
 */
export type SyncFilterValue<T = unknown> =
  | T
  | { $eq: T }
  | { $ne: T }
  | { $gt: T }
  | { $gte: T }
  | { $lt: T }
  | { $lte: T }
  | { $in: T[] }
  | { $nin: T[] }
  | { $exists: boolean };

/**
 * Document filter for selective sync
 */
export type SyncFilter<T extends Document = Document> = {
  [K in keyof T]?: SyncFilterValue<T[K]>;
};

/**
 * Time-based sync filter
 */
export interface TimeSyncFilter {
  /** Sync documents updated after this timestamp */
  since?: number;
  /** Sync documents updated before this timestamp */
  until?: number;
  /** Use document creation time instead of update time */
  useCreatedAt?: boolean;
}

/**
 * Collection sync configuration
 */
export interface CollectionSyncConfig<T extends Document = Document> {
  /** Collection name */
  name: string;
  /** Enable sync for this collection */
  enabled?: boolean;
  /** Document filter - only sync matching documents */
  filter?: SyncFilter<T>;
  /** Time-based filter */
  timeFilter?: TimeSyncFilter;
  /** Fields to include (whitelist) */
  includeFields?: (keyof T & string)[];
  /** Fields to exclude (blacklist) */
  excludeFields?: (keyof T & string)[];
  /** Custom sync priority (higher = sync first) */
  priority?: number;
  /** Sync direction override for this collection */
  direction?: 'push' | 'pull' | 'both' | 'none';
  /** Maximum documents to sync per batch */
  batchSize?: number;
  /** Rate limit: max syncs per minute */
  rateLimit?: number;
}

/**
 * Selective sync configuration
 */
export interface SelectiveSyncConfig {
  /** Collection-specific configurations */
  collections: Record<string, CollectionSyncConfig>;
  /** Default configuration for unlisted collections */
  defaultConfig?: Partial<CollectionSyncConfig>;
  /** Global time filter applied to all collections */
  globalTimeFilter?: TimeSyncFilter;
  /** Sync order strategy */
  syncOrder?: 'priority' | 'alphabetical' | 'size' | 'lastModified';
  /** Skip large documents (bytes) */
  maxDocumentSize?: number;
  /** Custom document filter function */
  customFilter?: (doc: Document, collection: string) => boolean;
}

/**
 * Sync rule for dynamic filtering
 */
export interface SyncRule<T extends Document = Document> {
  /** Rule name for identification */
  name: string;
  /** Collection this rule applies to */
  collection: string;
  /** Filter condition */
  filter: SyncFilter<T>;
  /** Rule priority */
  priority?: number;
  /** Whether to include (true) or exclude (false) matching documents */
  action: 'include' | 'exclude';
  /** Optional expiration time for this rule */
  expiresAt?: number;
}

/**
 * Sync policy for defining sync behavior
 */
export interface SyncPolicy {
  /** Policy name */
  name: string;
  /** Description */
  description?: string;
  /** Rules in this policy */
  rules: SyncRule[];
  /** Whether this policy is active */
  active: boolean;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

/**
 * Result of evaluating a sync filter
 */
export interface SyncFilterResult {
  /** Whether the document should be synced */
  shouldSync: boolean;
  /** Reason for the decision */
  reason: string;
  /** Which rule/filter made the decision */
  matchedRule?: string;
  /** Filtered document (with field exclusions applied) */
  filteredDocument?: Document;
}

/**
 * Sync scope - defines what to sync
 */
export interface SyncScope {
  /** Collections to include */
  collections: string[];
  /** Global filter applied to all collections */
  globalFilter?: SyncFilter;
  /** Time range */
  timeRange?: TimeSyncFilter;
  /** Document IDs to specifically include */
  includeIds?: Record<string, string[]>;
  /** Document IDs to specifically exclude */
  excludeIds?: Record<string, string[]>;
}

/**
 * Checkpoint with filter context
 */
export interface FilteredCheckpoint {
  /** Base checkpoint ID */
  checkpointId: string;
  /** Per-collection sequence numbers */
  sequences: Record<string, number>;
  /** Filter hash for cache invalidation */
  filterHash: string;
  /** Timestamp */
  timestamp: number;
  /** Node ID */
  nodeId: string;
}

/**
 * Pull request with selective filters
 */
export interface SelectivePullRequest {
  /** Collections to pull */
  collections: string[];
  /** Per-collection filters */
  filters?: Record<string, SyncFilter>;
  /** Time filters */
  timeFilters?: Record<string, TimeSyncFilter>;
  /** Field projections */
  projections?: Record<string, { include?: string[]; exclude?: string[] }>;
  /** Checkpoint */
  checkpoint: FilteredCheckpoint;
  /** Limit per collection */
  limit?: number;
}

/**
 * Push request with selective context
 */
export interface SelectivePushRequest {
  /** Collection being pushed */
  collection: string;
  /** Changes to push */
  changes: unknown[];
  /** Filter context for server validation */
  filterContext?: {
    filterHash: string;
    appliedFilters: string[];
  };
  /** Checkpoint */
  checkpoint: FilteredCheckpoint;
}

/**
 * Convert QueryFilter to SyncFilter
 */
export function queryFilterToSyncFilter<T extends Document>(
  queryFilter: QueryFilter<T>
): SyncFilter<T> {
  const syncFilter: SyncFilter<T> = {};

  for (const [key, value] of Object.entries(queryFilter)) {
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (syncFilter as any)[key] = value;
    }
  }

  return syncFilter;
}

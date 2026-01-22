import type { Document } from '@pocket/core';
import type {
  CollectionSyncConfig,
  SelectiveSyncConfig,
  SyncFilter,
  SyncFilterResult,
  SyncFilterValue,
  SyncPolicy,
  SyncRule,
  TimeSyncFilter,
} from './types.js';

/**
 * Evaluate a single filter value against a document field
 */
function evaluateFilterValue<T>(
  fieldValue: T | undefined,
  filterValue: SyncFilterValue<T>
): boolean {
  // Direct value comparison
  if (filterValue === null || typeof filterValue !== 'object') {
    return fieldValue === filterValue;
  }

  // Handle operators
  const filterObj = filterValue as Record<string, unknown>;

  if ('$eq' in filterObj) {
    return fieldValue === filterObj.$eq;
  }

  if ('$ne' in filterObj) {
    return fieldValue !== filterObj.$ne;
  }

  if ('$gt' in filterObj) {
    if (fieldValue === undefined || fieldValue === null) return false;
    return fieldValue > (filterObj.$gt as T);
  }

  if ('$gte' in filterObj) {
    if (fieldValue === undefined || fieldValue === null) return false;
    return fieldValue >= (filterObj.$gte as T);
  }

  if ('$lt' in filterObj) {
    if (fieldValue === undefined || fieldValue === null) return false;
    return fieldValue < (filterObj.$lt as T);
  }

  if ('$lte' in filterObj) {
    if (fieldValue === undefined || fieldValue === null) return false;
    return fieldValue <= (filterObj.$lte as T);
  }

  if ('$in' in filterObj) {
    const values = filterObj.$in as T[];
    return values.includes(fieldValue as T);
  }

  if ('$nin' in filterObj) {
    const values = filterObj.$nin as T[];
    return !values.includes(fieldValue as T);
  }

  if ('$exists' in filterObj) {
    const shouldExist = filterObj.$exists as boolean;
    return shouldExist ? fieldValue !== undefined : fieldValue === undefined;
  }

  // Default: deep equality for objects
  return JSON.stringify(fieldValue) === JSON.stringify(filterValue);
}

/**
 * Evaluate a sync filter against a document
 */
export function evaluateSyncFilter<T extends Document>(
  document: T,
  filter: SyncFilter<T>
): boolean {
  for (const [key, filterValue] of Object.entries(filter)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fieldValue = (document as any)[key];
    if (!evaluateFilterValue(fieldValue, filterValue as SyncFilterValue)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluate time-based filter
 */
export function evaluateTimeFilter(document: Document, timeFilter: TimeSyncFilter): boolean {
  const timestamp = timeFilter.useCreatedAt
    ? (document as Document & { _createdAt?: number })._createdAt
    : document._updatedAt;

  if (timestamp === undefined) {
    // If no timestamp, include by default
    return true;
  }

  if (timeFilter.since !== undefined && timestamp < timeFilter.since) {
    return false;
  }

  if (timeFilter.until !== undefined && timestamp > timeFilter.until) {
    return false;
  }

  return true;
}

/**
 * Filter evaluator class for selective sync
 */
export class SyncFilterEvaluator {
  private config: SelectiveSyncConfig;
  private policies = new Map<string, SyncPolicy>();
  private ruleCache = new Map<string, SyncRule[]>();

  constructor(config: SelectiveSyncConfig) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SelectiveSyncConfig>): void {
    this.config = { ...this.config, ...config };
    this.ruleCache.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): SelectiveSyncConfig {
    return this.config;
  }

  /**
   * Add a sync policy
   */
  addPolicy(policy: SyncPolicy): void {
    this.policies.set(policy.name, policy);
    this.ruleCache.clear();
  }

  /**
   * Remove a sync policy
   */
  removePolicy(policyName: string): void {
    this.policies.delete(policyName);
    this.ruleCache.clear();
  }

  /**
   * Get collection configuration
   */
  getCollectionConfig(collection: string): CollectionSyncConfig {
    const collectionConfig = this.config.collections[collection];
    const defaultConfig = this.config.defaultConfig ?? {};

    return {
      name: collection,
      enabled: true,
      priority: 0,
      direction: 'both',
      ...defaultConfig,
      ...collectionConfig,
    };
  }

  /**
   * Get active rules for a collection
   */
  private getActiveRules(collection: string): SyncRule[] {
    if (this.ruleCache.has(collection)) {
      return this.ruleCache.get(collection)!;
    }

    const rules: SyncRule[] = [];
    const now = Date.now();

    for (const policy of this.policies.values()) {
      if (!policy.active) continue;

      for (const rule of policy.rules) {
        if (rule.collection !== collection) continue;
        if (rule.expiresAt && rule.expiresAt < now) continue;

        rules.push(rule);
      }
    }

    // Sort by priority (higher first)
    rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    this.ruleCache.set(collection, rules);
    return rules;
  }

  /**
   * Evaluate whether a document should be synced
   */
  evaluate(document: Document, collection: string): SyncFilterResult {
    const config = this.getCollectionConfig(collection);

    // Check if collection sync is enabled
    if (config.enabled === false || config.direction === 'none') {
      return {
        shouldSync: false,
        reason: 'Collection sync disabled',
      };
    }

    // Check document size limit
    if (this.config.maxDocumentSize) {
      const docSize = JSON.stringify(document).length;
      if (docSize > this.config.maxDocumentSize) {
        return {
          shouldSync: false,
          reason: `Document exceeds size limit (${docSize} > ${this.config.maxDocumentSize})`,
        };
      }
    }

    // Apply custom filter function
    if (this.config.customFilter) {
      if (!this.config.customFilter(document, collection)) {
        return {
          shouldSync: false,
          reason: 'Rejected by custom filter',
        };
      }
    }

    // Apply global time filter
    if (this.config.globalTimeFilter) {
      if (!evaluateTimeFilter(document, this.config.globalTimeFilter)) {
        return {
          shouldSync: false,
          reason: 'Rejected by global time filter',
        };
      }
    }

    // Apply collection time filter
    if (config.timeFilter) {
      if (!evaluateTimeFilter(document, config.timeFilter)) {
        return {
          shouldSync: false,
          reason: 'Rejected by collection time filter',
        };
      }
    }

    // Apply collection filter
    if (config.filter) {
      if (!evaluateSyncFilter(document, config.filter as SyncFilter)) {
        return {
          shouldSync: false,
          reason: 'Rejected by collection filter',
        };
      }
    }

    // Apply policy rules
    const rules = this.getActiveRules(collection);
    for (const rule of rules) {
      const matches = evaluateSyncFilter(document, rule.filter as SyncFilter);

      if (matches) {
        if (rule.action === 'exclude') {
          return {
            shouldSync: false,
            reason: `Excluded by rule: ${rule.name}`,
            matchedRule: rule.name,
          };
        }
        // Include rules just allow through, continue checking
      }
    }

    // Apply field filtering and return filtered document
    const filteredDocument = this.filterDocumentFields(document, config);

    return {
      shouldSync: true,
      reason: 'Passed all filters',
      filteredDocument,
    };
  }

  /**
   * Filter document fields based on include/exclude lists
   */
  filterDocumentFields<T extends Document>(document: T, config: CollectionSyncConfig<T>): Document {
    // Always include system fields
    const systemFields = ['_id', '_rev', '_deleted', '_updatedAt', '_vclock'];

    if (config.includeFields && config.includeFields.length > 0) {
      // Whitelist mode
      const result: Record<string, unknown> = {};
      const includeSet = new Set<string>([...systemFields, ...config.includeFields]);

      for (const [key, value] of Object.entries(document)) {
        if (includeSet.has(key)) {
          result[key] = value;
        }
      }

      return result as unknown as Document;
    }

    if (config.excludeFields && config.excludeFields.length > 0) {
      // Blacklist mode
      const result: Record<string, unknown> = {};
      const excludeSet = new Set<string>(config.excludeFields);

      for (const [key, value] of Object.entries(document)) {
        // Never exclude system fields
        if (systemFields.includes(key) || !excludeSet.has(key)) {
          result[key] = value;
        }
      }

      return result as unknown as Document;
    }

    // No field filtering
    return document;
  }

  /**
   * Get collections to sync, sorted by priority
   */
  getCollectionsToSync(): string[] {
    const collections: { name: string; priority: number }[] = [];

    for (const [name, config] of Object.entries(this.config.collections)) {
      if (config.enabled !== false && config.direction !== 'none') {
        collections.push({
          name,
          priority: config.priority ?? 0,
        });
      }
    }

    // Sort based on sync order strategy
    switch (this.config.syncOrder) {
      case 'priority':
        collections.sort((a, b) => b.priority - a.priority);
        break;
      case 'alphabetical':
        collections.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'size':
      case 'lastModified':
        // These would require additional context; use priority as fallback
        collections.sort((a, b) => b.priority - a.priority);
        break;
      default:
        collections.sort((a, b) => b.priority - a.priority);
    }

    return collections.map((c) => c.name);
  }

  /**
   * Generate a hash of the current filter configuration
   */
  getFilterHash(): string {
    const configString = JSON.stringify({
      collections: this.config.collections,
      globalTimeFilter: this.config.globalTimeFilter,
      maxDocumentSize: this.config.maxDocumentSize,
      policies: Array.from(this.policies.entries()),
    });

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < configString.length; i++) {
      const char = configString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return hash.toString(36);
  }

  /**
   * Check if a document matches any include rules
   */
  matchesIncludeRule(document: Document, collection: string): { matches: boolean; rule?: string } {
    const rules = this.getActiveRules(collection);

    for (const rule of rules) {
      if (rule.action !== 'include') continue;

      if (evaluateSyncFilter(document, rule.filter as SyncFilter)) {
        return { matches: true, rule: rule.name };
      }
    }

    return { matches: false };
  }

  /**
   * Batch evaluate multiple documents
   */
  evaluateBatch(
    documents: Document[],
    collection: string
  ): { document: Document; result: SyncFilterResult }[] {
    return documents.map((document) => ({
      document,
      result: this.evaluate(document, collection),
    }));
  }

  /**
   * Filter a batch of documents and return only those that should sync
   */
  filterBatch(
    documents: Document[],
    collection: string
  ): { filtered: Document[]; excluded: Document[] } {
    const filtered: Document[] = [];
    const excluded: Document[] = [];

    for (const document of documents) {
      const result = this.evaluate(document, collection);
      if (result.shouldSync) {
        filtered.push(result.filteredDocument ?? document);
      } else {
        excluded.push(document);
      }
    }

    return { filtered, excluded };
  }
}

/**
 * Create a simple time-based filter for syncing recent documents
 */
export function createRecentDocumentsFilter(durationMs: number): TimeSyncFilter {
  return {
    since: Date.now() - durationMs,
  };
}

/**
 * Create a date range filter
 */
export function createDateRangeFilter(startDate: Date, endDate: Date): TimeSyncFilter {
  return {
    since: startDate.getTime(),
    until: endDate.getTime(),
  };
}

/**
 * Create a sync rule for specific document IDs
 */
export function createIdFilter(ids: string[]): SyncFilter {
  return {
    _id: { $in: ids },
  };
}

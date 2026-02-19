/**
 * Selective sync filter engine.
 *
 * Defines and evaluates document-level sync filters so clients
 * can sync only relevant data subsets based on field values,
 * ownership, tags, or custom predicates.
 *
 * @module selective-filter
 */

/** Filter operator */
export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists' | 'custom';

/** A single sync filter rule */
export interface SyncFilterRule {
  readonly field: string;
  readonly op: FilterOp;
  readonly value?: unknown;
  readonly customFn?: (doc: Record<string, unknown>) => boolean;
}

/** Complete sync filter configuration */
export interface SyncFilter {
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Collections this filter applies to (empty = all) */
  readonly collections: readonly string[];
  /** Rules — all must pass (AND logic) */
  readonly rules: readonly SyncFilterRule[];
  /** Whether this filter is enabled */
  readonly enabled: boolean;
}

/** Evaluation result */
export interface SyncFilterResult {
  readonly filterId: string;
  readonly documentId: string;
  readonly shouldSync: boolean;
  readonly matchedRules: number;
  readonly failedRule?: string;
}

/**
 * Evaluates sync filters against documents.
 *
 * @example
 * ```typescript
 * const engine = new SyncFilterEngine();
 *
 * engine.addFilter({
 *   id: 'my-data',
 *   name: 'Only my data',
 *   collections: ['todos'],
 *   rules: [{ field: 'userId', op: 'eq', value: 'user-123' }],
 *   enabled: true,
 * });
 *
 * const shouldSync = engine.evaluate('todos', { _id: '1', userId: 'user-123', title: 'Test' });
 * console.log(shouldSync.shouldSync); // true
 * ```
 */
export class SyncFilterEngine {
  private readonly filters = new Map<string, SyncFilter>();

  /** Add a sync filter */
  addFilter(filter: SyncFilter): void {
    this.filters.set(filter.id, filter);
  }

  /** Remove a filter */
  removeFilter(filterId: string): boolean {
    return this.filters.delete(filterId);
  }

  /** Get all filters */
  getFilters(): SyncFilter[] {
    return Array.from(this.filters.values());
  }

  /** Get filters for a specific collection */
  getFiltersForCollection(collection: string): SyncFilter[] {
    return Array.from(this.filters.values()).filter(
      (f) => f.enabled && (f.collections.length === 0 || f.collections.includes(collection)),
    );
  }

  /** Evaluate whether a document should be synced */
  evaluate(collection: string, document: Record<string, unknown>): SyncFilterResult {
    const applicableFilters = this.getFiltersForCollection(collection);

    // No filters → sync everything
    if (applicableFilters.length === 0) {
      return { filterId: '', documentId: String(document['_id'] ?? ''), shouldSync: true, matchedRules: 0 };
    }

    // Any filter must pass (OR between filters, AND within rules)
    for (const filter of applicableFilters) {
      const result = this.evaluateFilter(filter, document);
      if (result.shouldSync) return result;
    }

    // No filter passed
    const first = applicableFilters[0]!;
    return {
      filterId: first.id,
      documentId: String(document['_id'] ?? ''),
      shouldSync: false,
      matchedRules: 0,
      failedRule: 'No filter matched',
    };
  }

  /** Evaluate a batch of documents */
  evaluateBatch(collection: string, documents: Record<string, unknown>[]): SyncFilterResult[] {
    return documents.map((doc) => this.evaluate(collection, doc));
  }

  /** Filter a batch, returning only documents that should sync */
  filterBatch(collection: string, documents: Record<string, unknown>[]): Record<string, unknown>[] {
    return documents.filter((doc) => this.evaluate(collection, doc).shouldSync);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private evaluateFilter(filter: SyncFilter, document: Record<string, unknown>): SyncFilterResult {
    const docId = String(document['_id'] ?? '');
    let matchedRules = 0;

    for (const rule of filter.rules) {
      if (!this.evaluateRule(rule, document)) {
        return { filterId: filter.id, documentId: docId, shouldSync: false, matchedRules, failedRule: `${rule.field} ${rule.op}` };
      }
      matchedRules++;
    }

    return { filterId: filter.id, documentId: docId, shouldSync: true, matchedRules };
  }

  private evaluateRule(rule: SyncFilterRule, document: Record<string, unknown>): boolean {
    if (rule.op === 'custom' && rule.customFn) {
      return rule.customFn(document);
    }

    const fieldValue = this.getNestedValue(document, rule.field);

    switch (rule.op) {
      case 'eq': return fieldValue === rule.value;
      case 'ne': return fieldValue !== rule.value;
      case 'gt': return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue > rule.value;
      case 'gte': return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue >= rule.value;
      case 'lt': return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue < rule.value;
      case 'lte': return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue <= rule.value;
      case 'in': return Array.isArray(rule.value) && rule.value.includes(fieldValue);
      case 'contains': return typeof fieldValue === 'string' && typeof rule.value === 'string' && fieldValue.includes(rule.value);
      case 'exists': return fieldValue !== undefined && fieldValue !== null;
      default: return false;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}

/** Factory function */
export function createSyncFilterEngine(): SyncFilterEngine {
  return new SyncFilterEngine();
}

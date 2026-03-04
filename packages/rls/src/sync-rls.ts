/**
 * Sync integration ensuring server only sends authorized documents.
 */
import type { PolicySet, RLSContext } from './policy-dsl.js';
import { PolicyEvaluator } from './policy-dsl.js';

export interface SyncFilter {
  collection: string;
  filter: Record<string, unknown>;
}

export interface SyncRLSConfig {
  policies: PolicySet;
  getContext: () => RLSContext;
}

/**
 * Generates sync filters based on RLS policies.
 * These filters are applied server-side to ensure only authorized
 * documents are synced to each client.
 */
export class SyncRLS {
  private readonly evaluator: PolicyEvaluator;
  private readonly getContext: () => RLSContext;

  constructor(config: SyncRLSConfig) {
    this.evaluator = new PolicyEvaluator(config.policies);
    this.getContext = config.getContext;
  }

  /** Generate sync filters for a list of collections */
  generateSyncFilters(collections: string[]): SyncFilter[] {
    const context = this.getContext();
    return collections.map((collection) => ({
      collection,
      filter: this.evaluator.generateQueryFilter('read', collection, context),
    }));
  }

  /** Check if a specific document should be synced to the current user */
  shouldSync(collection: string, document: Record<string, unknown>): boolean {
    const context = this.getContext();
    return this.evaluator.evaluate('read', collection, document, context);
  }

  /** Filter outgoing sync payload */
  filterSyncPayload(
    collection: string,
    documents: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    const context = this.getContext();
    return this.evaluator.filter('read', collection, documents, context);
  }

  /** Validate incoming write from sync */
  validateSyncWrite(
    collection: string,
    document: Record<string, unknown>,
    action: 'create' | 'update' | 'delete'
  ): boolean {
    const context = this.getContext();
    return this.evaluator.evaluate(action, collection, document, context);
  }
}

export function createSyncRLS(config: SyncRLSConfig): SyncRLS {
  return new SyncRLS(config);
}

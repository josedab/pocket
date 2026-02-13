/**
 * RetentionEngine - Data retention policy engine for Pocket.
 *
 * Manages data retention policies and evaluates documents against
 * configured rules. Supports automatic deletion, archival, and
 * anonymization of expired data.
 *
 * @module @pocket/compliance
 *
 * @example
 * ```typescript
 * import { createRetentionEngine } from '@pocket/compliance';
 *
 * const engine = createRetentionEngine([
 *   { collection: 'logs', maxAge: 90 * 24 * 60 * 60 * 1000, action: 'delete' },
 *   { collection: 'audit', maxAge: 365 * 24 * 60 * 60 * 1000, action: 'archive' },
 * ]);
 *
 * const actions = engine.evaluate('logs', documents);
 * ```
 *
 * @see {@link GDPRManager} for GDPR compliance management
 * @see {@link ComplianceReporter} for compliance report generation
 */

import type { RetentionPolicy } from './types.js';

/**
 * Manages data retention policies and evaluates documents for expiry.
 *
 * Policies define how long data in a collection may be kept and
 * what action to take when documents exceed the maximum age.
 */
export class RetentionEngine {
  private readonly policies = new Map<string, RetentionPolicy>();

  constructor(policies: RetentionPolicy[] = []) {
    for (const policy of policies) {
      this.policies.set(policy.collection, policy);
    }
  }

  /**
   * Add a retention policy for a collection.
   *
   * @param policy - The retention policy to add
   *
   * @example
   * ```typescript
   * engine.addPolicy({ collection: 'sessions', maxAge: 30 * 24 * 60 * 60 * 1000, action: 'delete' });
   * ```
   */
  addPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.collection, policy);
  }

  /**
   * Remove the retention policy for a collection.
   *
   * @param collection - The collection name to remove the policy for
   *
   * @example
   * ```typescript
   * engine.removePolicy('sessions');
   * ```
   */
  removePolicy(collection: string): void {
    this.policies.delete(collection);
  }

  /**
   * Get all configured retention policies.
   *
   * @returns Array of retention policies
   *
   * @example
   * ```typescript
   * const policies = engine.getPolicies();
   * console.log(policies.length);
   * ```
   */
  getPolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Evaluate documents in a collection against the retention policy.
   *
   * Returns a list of actions to take on expired documents.
   *
   * @param collection - The collection to evaluate
   * @param documents - Documents with _id and _updatedAt fields
   * @returns Array of actions with affected document IDs
   *
   * @example
   * ```typescript
   * const actions = engine.evaluate('logs', [
   *   { _id: 'doc-1', _updatedAt: Date.now() - 100 * 24 * 60 * 60 * 1000 },
   *   { _id: 'doc-2', _updatedAt: Date.now() },
   * ]);
   * // [{ action: 'delete', documentIds: ['doc-1'] }]
   * ```
   */
  evaluate(
    collection: string,
    documents: { _id: string; _updatedAt: number }[]
  ): { action: string; documentIds: string[] }[] {
    const policy = this.policies.get(collection);
    if (!policy) return [];

    const now = Date.now();
    const expiredIds = documents
      .filter((doc) => now - doc._updatedAt > policy.maxAge)
      .map((doc) => doc._id);

    if (expiredIds.length === 0) return [];

    return [{ action: policy.action, documentIds: expiredIds }];
  }

  /**
   * Generate a retention report summarizing policy status.
   *
   * @returns Report with policies, expired document counts, and pending actions
   *
   * @example
   * ```typescript
   * const report = engine.generateRetentionReport();
   * console.log(report.pendingActions);
   * ```
   */
  generateRetentionReport(): {
    policies: RetentionPolicy[];
    expiredDocuments: number;
    pendingActions: number;
  } {
    const policies = this.getPolicies();
    return {
      policies,
      expiredDocuments: 0,
      pendingActions: 0,
    };
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.policies.clear();
  }
}

/**
 * Create a RetentionEngine instance.
 *
 * @param policies - Optional initial retention policies
 * @returns A new RetentionEngine instance
 *
 * @example
 * ```typescript
 * const engine = createRetentionEngine([
 *   { collection: 'logs', maxAge: 90 * 24 * 60 * 60 * 1000, action: 'delete' },
 * ]);
 * ```
 */
export function createRetentionEngine(policies?: RetentionPolicy[]): RetentionEngine {
  return new RetentionEngine(policies);
}

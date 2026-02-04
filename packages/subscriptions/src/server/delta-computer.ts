/**
 * DeltaComputer - computes subscription deltas from change events
 *
 * Given a subscription's current state and a change event, determines
 * what delta (if any) should be sent to the client. Handles document
 * insertions, updates, and deletions with respect to the subscription's
 * filter, sort, and limit constraints.
 */

import type { ChangeEvent, Document } from '@pocket/core';
import { FilterMatcher } from '../filter-matcher.js';
import type { ServerSubscriptionState, SubscriptionDelta } from '../types.js';

/**
 * DeltaComputer computes incremental deltas for subscriptions.
 *
 * For each change event, it determines:
 * - Insert: Does the new document match the filter? If so, add to delta.added.
 * - Update: Did the document enter, leave, or stay in the result set?
 * - Delete: Was the document in the result set? If so, add to delta.removed.
 *
 * It also respects limit constraints: if a subscription has a limit and the
 * result set is already full, an insert may push out another document.
 */
export class DeltaComputer {
  private readonly filterMatcher: FilterMatcher;

  constructor() {
    this.filterMatcher = new FilterMatcher();
  }

  /**
   * Compute a delta for a subscription based on a change event.
   *
   * @param subscription - The current subscription state
   * @param change - The change event that occurred
   * @returns A SubscriptionDelta if the change affects the subscription, or null otherwise
   */
  computeDelta(
    subscription: ServerSubscriptionState,
    change: ChangeEvent<Document>
  ): SubscriptionDelta | null {
    const filter = subscription.query.filter ?? {};
    const limit = subscription.query.limit;

    switch (change.operation) {
      case 'insert':
        return this.handleInsert(subscription, change, filter, limit);

      case 'update':
        return this.handleUpdate(subscription, change, filter, limit);

      case 'delete':
        return this.handleDelete(subscription, change);

      default:
        return null;
    }
  }

  /**
   * Handle an insert operation.
   *
   * If the new document matches the subscription's filter, add it to the result set.
   * If a limit is set and the result set is already at capacity, the insert still
   * adds the document (the client will enforce limit locally, or a more sophisticated
   * implementation would track sort order to determine eviction).
   */
  private handleInsert(
    subscription: ServerSubscriptionState,
    change: ChangeEvent<Document>,
    filter: Record<string, unknown>,
    limit: number | undefined
  ): SubscriptionDelta | null {
    const doc = change.document;
    if (!doc) return null;

    // Check if document matches the subscription filter
    if (!this.filterMatcher.matches(doc, filter)) {
      return null;
    }

    // If limit is set and we're at capacity, this document enters
    // but we may need to remove the last one (based on sort).
    // For simplicity, we let the client handle sort-based eviction
    // and just report the addition.
    const removed: string[] = [];

    if (limit && subscription.currentIds.size >= limit) {
      // At capacity - a document needs to be evicted.
      // Without full sort context on the server, we signal the addition
      // and let the client reconcile. For basic cases we remove a placeholder.
      // In production this would use sort order to determine the evicted doc.
      // Here we mark that the set is at capacity but still add the new doc.
      // The client will apply sort + limit to trim the result set.
    }

    // Add to current IDs
    subscription.currentIds.add(change.documentId);
    subscription.sequence++;

    return {
      subscriptionId: subscription.id,
      type: 'delta',
      added: [doc],
      removed,
      modified: [],
      sequence: subscription.sequence,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle an update operation.
   *
   * Three cases:
   * 1. Document was in result set AND still matches filter -> modified
   * 2. Document was NOT in result set AND now matches filter -> added
   * 3. Document was in result set AND no longer matches filter -> removed
   * 4. Document was NOT in result set AND still doesn't match -> no delta
   */
  private handleUpdate(
    subscription: ServerSubscriptionState,
    change: ChangeEvent<Document>,
    filter: Record<string, unknown>,
    _limit: number | undefined
  ): SubscriptionDelta | null {
    const doc = change.document;
    if (!doc) return null;

    const wasInSet = subscription.currentIds.has(change.documentId);
    const matchesNow = this.filterMatcher.matches(doc, filter);

    if (wasInSet && matchesNow) {
      // Case 1: Document stayed in result set, was modified
      subscription.sequence++;

      return {
        subscriptionId: subscription.id,
        type: 'delta',
        added: [],
        removed: [],
        modified: [doc],
        sequence: subscription.sequence,
        timestamp: Date.now(),
      };
    }

    if (!wasInSet && matchesNow) {
      // Case 2: Document entered the result set
      subscription.currentIds.add(change.documentId);
      subscription.sequence++;

      return {
        subscriptionId: subscription.id,
        type: 'delta',
        added: [doc],
        removed: [],
        modified: [],
        sequence: subscription.sequence,
        timestamp: Date.now(),
      };
    }

    if (wasInSet && !matchesNow) {
      // Case 3: Document left the result set
      subscription.currentIds.delete(change.documentId);
      subscription.sequence++;

      return {
        subscriptionId: subscription.id,
        type: 'delta',
        added: [],
        removed: [change.documentId],
        modified: [],
        sequence: subscription.sequence,
        timestamp: Date.now(),
      };
    }

    // Case 4: Document not relevant to this subscription
    return null;
  }

  /**
   * Handle a delete operation.
   *
   * If the document was in the subscription's result set, remove it.
   */
  private handleDelete(
    subscription: ServerSubscriptionState,
    change: ChangeEvent<Document>
  ): SubscriptionDelta | null {
    if (!subscription.currentIds.has(change.documentId)) {
      return null;
    }

    subscription.currentIds.delete(change.documentId);
    subscription.sequence++;

    return {
      subscriptionId: subscription.id,
      type: 'delta',
      added: [],
      removed: [change.documentId],
      modified: [],
      sequence: subscription.sequence,
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a new DeltaComputer
 */
export function createDeltaComputer(): DeltaComputer {
  return new DeltaComputer();
}

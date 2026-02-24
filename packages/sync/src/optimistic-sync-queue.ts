/**
 * OptimisticSyncQueue — v2 optimistic mutation pipeline.
 *
 * Applies mutations instantly to local state, queues them for server sync,
 * and automatically reconciles or rolls back on server response.
 *
 * @example
 * ```typescript
 * const queue = new OptimisticSyncQueue();
 *
 * // Apply mutation optimistically
 * const mutation = queue.enqueue({
 *   collection: 'todos',
 *   documentId: 'td-1',
 *   operation: 'update',
 *   changes: { completed: true },
 *   previousState: { completed: false },
 * });
 *
 * // Later, server confirms or rejects
 * queue.confirm(mutation.id);
 * // or
 * queue.reject(mutation.id, 'Conflict');
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export type MutationOperation = 'insert' | 'update' | 'delete';
export type MutationStatus = 'pending' | 'confirmed' | 'rejected' | 'rolled-back';

export interface OptimisticMutation {
  id: string;
  collection: string;
  documentId: string;
  operation: MutationOperation;
  changes: Record<string, unknown>;
  previousState: Record<string, unknown> | null;
  status: MutationStatus;
  createdAt: number;
  confirmedAt: number | null;
  rejectedAt: number | null;
  error: string | null;
  retryCount: number;
}

export interface EnqueueInput {
  collection: string;
  documentId: string;
  operation: MutationOperation;
  changes: Record<string, unknown>;
  previousState: Record<string, unknown> | null;
}

export interface SyncQueueConfig {
  /** Max pending mutations before blocking (default: 1000) */
  maxQueueSize?: number;
  /** Max retry attempts for failed mutations (default: 3) */
  maxRetries?: number;
  /** Auto-rollback on rejection (default: true) */
  autoRollback?: boolean;
  /** Group mutations into transactions (default: false) */
  enableTransactions?: boolean;
}

export interface SyncQueueStats {
  pending: number;
  confirmed: number;
  rejected: number;
  rolledBack: number;
  totalEnqueued: number;
  oldestPendingAge: number | null;
}

export type SyncQueueEvent =
  | { type: 'enqueued'; mutation: OptimisticMutation }
  | { type: 'confirmed'; mutationId: string }
  | { type: 'rejected'; mutationId: string; error: string }
  | { type: 'rolled-back'; mutationId: string }
  | { type: 'retrying'; mutationId: string; attempt: number }
  | { type: 'queue-overflow'; dropped: number };

// ── Implementation ────────────────────────────────────────

export class OptimisticSyncQueue {
  private readonly config: Required<SyncQueueConfig>;
  private readonly mutations = new Map<string, OptimisticMutation>();
  private readonly pendingOrder: string[] = [];
  private readonly destroy$ = new Subject<void>();
  private readonly eventsSubject = new Subject<SyncQueueEvent>();
  private readonly statsSubject: BehaviorSubject<SyncQueueStats>;

  private mutationCounter = 0;
  private totalEnqueued = 0;

  /** Observable of queue events. */
  readonly events$: Observable<SyncQueueEvent>;
  /** Observable of queue statistics. */
  readonly stats$: Observable<SyncQueueStats>;

  constructor(config: SyncQueueConfig = {}) {
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 1000,
      maxRetries: config.maxRetries ?? 3,
      autoRollback: config.autoRollback ?? true,
      enableTransactions: config.enableTransactions ?? false,
    };

    this.statsSubject = new BehaviorSubject<SyncQueueStats>(this.buildStats());
    this.events$ = this.eventsSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.stats$ = this.statsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Enqueue an optimistic mutation.
   * Returns the mutation record for tracking.
   */
  enqueue(input: EnqueueInput): OptimisticMutation {
    // Overflow protection
    if (this.pendingOrder.length >= this.config.maxQueueSize) {
      const dropped = this.dropOldest(Math.ceil(this.config.maxQueueSize * 0.1));
      this.eventsSubject.next({ type: 'queue-overflow', dropped });
    }

    const mutation: OptimisticMutation = {
      id: `mut_${++this.mutationCounter}_${Date.now()}`,
      collection: input.collection,
      documentId: input.documentId,
      operation: input.operation,
      changes: { ...input.changes },
      previousState: input.previousState ? { ...input.previousState } : null,
      status: 'pending',
      createdAt: Date.now(),
      confirmedAt: null,
      rejectedAt: null,
      error: null,
      retryCount: 0,
    };

    this.mutations.set(mutation.id, mutation);
    this.pendingOrder.push(mutation.id);
    this.totalEnqueued++;
    this.emitStats();
    this.eventsSubject.next({ type: 'enqueued', mutation });

    return mutation;
  }

  /**
   * Confirm a mutation was accepted by the server.
   */
  confirm(mutationId: string): boolean {
    const mutation = this.mutations.get(mutationId);
    if (mutation?.status !== 'pending') return false;

    mutation.status = 'confirmed';
    mutation.confirmedAt = Date.now();
    this.removePending(mutationId);
    this.emitStats();
    this.eventsSubject.next({ type: 'confirmed', mutationId });
    return true;
  }

  /**
   * Reject a mutation and optionally auto-rollback.
   */
  reject(mutationId: string, error: string): boolean {
    const mutation = this.mutations.get(mutationId);
    if (mutation?.status !== 'pending') return false;

    mutation.status = 'rejected';
    mutation.rejectedAt = Date.now();
    mutation.error = error;
    this.removePending(mutationId);
    this.eventsSubject.next({ type: 'rejected', mutationId, error });

    if (this.config.autoRollback) {
      this.rollback(mutationId);
    }

    this.emitStats();
    return true;
  }

  /**
   * Rollback a mutation — restore the previous state.
   * Returns the previous state to apply, or null.
   */
  rollback(mutationId: string): Record<string, unknown> | null {
    const mutation = this.mutations.get(mutationId);
    if (!mutation) return null;

    mutation.status = 'rolled-back';
    this.removePending(mutationId);
    this.emitStats();
    this.eventsSubject.next({ type: 'rolled-back', mutationId });

    return mutation.previousState;
  }

  /**
   * Retry a rejected mutation.
   */
  retry(mutationId: string): boolean {
    const mutation = this.mutations.get(mutationId);
    if (mutation?.status !== 'rejected') return false;
    if (mutation.retryCount >= this.config.maxRetries) return false;

    mutation.status = 'pending';
    mutation.retryCount++;
    mutation.error = null;
    mutation.rejectedAt = null;
    this.pendingOrder.push(mutationId);
    this.emitStats();
    this.eventsSubject.next({ type: 'retrying', mutationId, attempt: mutation.retryCount });
    return true;
  }

  /**
   * Get all pending mutations (in order).
   */
  getPending(): OptimisticMutation[] {
    return this.pendingOrder
      .map((id) => this.mutations.get(id))
      .filter((m): m is OptimisticMutation => m?.status === 'pending');
  }

  /**
   * Get a mutation by ID.
   */
  getMutation(id: string): OptimisticMutation | undefined {
    return this.mutations.get(id);
  }

  /**
   * Get pending mutations for a specific document (for conflict detection).
   */
  getPendingForDocument(collection: string, documentId: string): OptimisticMutation[] {
    return this.getPending().filter(
      (m) => m.collection === collection && m.documentId === documentId
    );
  }

  /**
   * Confirm all pending mutations (batch).
   */
  confirmAll(): number {
    let count = 0;
    for (const id of [...this.pendingOrder]) {
      if (this.confirm(id)) count++;
    }
    return count;
  }

  /**
   * Get queue statistics.
   */
  getStats(): SyncQueueStats {
    return this.buildStats();
  }

  /**
   * Check if any mutations are pending.
   */
  get hasPending(): boolean {
    return this.pendingOrder.length > 0;
  }

  /**
   * Clear confirmed/rolled-back mutations from memory.
   */
  prune(): number {
    let pruned = 0;
    for (const [id, mutation] of this.mutations) {
      if (mutation.status === 'confirmed' || mutation.status === 'rolled-back') {
        this.mutations.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Destroy the queue and release resources.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.eventsSubject.complete();
    this.statsSubject.complete();
    this.mutations.clear();
    this.pendingOrder.length = 0;
  }

  // ── Private ────────────────────────────────────────────

  private removePending(id: string): void {
    const idx = this.pendingOrder.indexOf(id);
    if (idx !== -1) this.pendingOrder.splice(idx, 1);
  }

  private dropOldest(count: number): number {
    let dropped = 0;
    while (dropped < count && this.pendingOrder.length > 0) {
      const id = this.pendingOrder.shift();
      if (id) {
        const m = this.mutations.get(id);
        if (m) m.status = 'rolled-back';
        dropped++;
      }
    }
    return dropped;
  }

  private buildStats(): SyncQueueStats {
    const pending = this.pendingOrder.length;
    let confirmed = 0;
    let rejected = 0;
    let rolledBack = 0;

    for (const m of this.mutations.values()) {
      switch (m.status) {
        case 'confirmed':
          confirmed++;
          break;
        case 'rejected':
          rejected++;
          break;
        case 'rolled-back':
          rolledBack++;
          break;
      }
    }

    const oldestPending = this.pendingOrder[0]
      ? this.mutations.get(this.pendingOrder[0])
      : undefined;

    return {
      pending,
      confirmed,
      rejected,
      rolledBack,
      totalEnqueued: this.totalEnqueued,
      oldestPendingAge: oldestPending ? Date.now() - oldestPending.createdAt : null,
    };
  }

  private emitStats(): void {
    this.statsSubject.next(this.buildStats());
  }
}

// ── React Hook Types ──────────────────────────────────────

export interface UseOptimisticMutationReturn<T> {
  mutate: (changes: Partial<T>) => OptimisticMutation;
  undo: (mutationId: string) => Record<string, unknown> | null;
  pending: OptimisticMutation[];
  status: 'idle' | 'pending' | 'syncing';
}

/**
 * Factory for creating the useOptimisticMutation React hook.
 */
export function createUseOptimisticMutationHook(React: {
  useState<T>(init: T): [T, (v: T | ((p: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useEffect(effect: () => undefined | (() => void), deps?: unknown[]): void;
  useRef<T>(init: T): { current: T };
}) {
  return function useOptimisticMutation<T extends Record<string, unknown>>(
    queue: OptimisticSyncQueue,
    collection: string,
    documentId: string,
    currentState: T
  ): UseOptimisticMutationReturn<T> {
    const [pending, setPending] = React.useState<OptimisticMutation[]>([]);
    const stateRef = React.useRef(currentState);
    stateRef.current = currentState;

    React.useEffect(() => {
      const sub = queue.events$.subscribe(() => {
        setPending(queue.getPendingForDocument(collection, documentId));
      });
      return () => sub.unsubscribe();
    }, [queue, collection, documentId]);

    const mutate = React.useCallback(
      (changes: Partial<T>) => {
        return queue.enqueue({
          collection,
          documentId,
          operation: 'update',
          changes: changes as Record<string, unknown>,
          previousState: stateRef.current as Record<string, unknown>,
        });
      },
      [queue, collection, documentId]
    ) as (changes: Partial<T>) => OptimisticMutation;

    const undo = React.useCallback(
      (mutationId: string) => {
        return queue.rollback(mutationId);
      },
      [queue]
    ) as (mutationId: string) => Record<string, unknown> | null;

    const status = pending.length > 0 ? ('pending' as const) : ('idle' as const);

    return { mutate, undo, pending, status };
  };
}

export function createOptimisticSyncQueue(config?: SyncQueueConfig): OptimisticSyncQueue {
  return new OptimisticSyncQueue(config);
}

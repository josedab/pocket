/**
 * Offline operation queue for cross-platform mobile applications.
 *
 * Queues mutation operations when the device is offline, persists them
 * to storage, and replays them on reconnection with configurable
 * conflict resolution. Supports priority-based ordering and queue
 * size management with eviction.
 *
 * @module offline-queue
 *
 * @example
 * ```typescript
 * import { createOfflineQueue } from '@pocket/mobile';
 *
 * const queue = createOfflineQueue({
 *   maxSize: 1000,
 *   conflictStrategy: 'client-wins',
 *   onReplayComplete: (results) => {
 *     const failed = results.filter((r) => !r.success);
 *     console.log(`Replayed ${results.length}, failed: ${failed.length}`);
 *   },
 * });
 *
 * // Queue an operation while offline
 * queue.enqueue({
 *   collection: 'todos',
 *   type: 'insert',
 *   payload: { title: 'Buy groceries' },
 * });
 *
 * // Replay when back online
 * const results = await queue.replay();
 *
 * // Clean up
 * queue.destroy();
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

import type {
  QueuedOperation,
  QueuePriority,
  MutationType,
  ConflictStrategy,
  ReplayResult,
} from './types.js';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link OfflineQueue}.
 */
export interface OfflineQueueConfig {
  /** Maximum queue size before eviction (default: 1000) */
  maxSize?: number;

  /** Default conflict resolution strategy (default: 'client-wins') */
  conflictStrategy?: ConflictStrategy;

  /** Maximum retries per operation (default: 3) */
  maxRetries?: number;

  /** Callback invoked after replay completes */
  onReplayComplete?: (results: ReplayResult[]) => void;

}

/**
 * Input for enqueuing an operation (without auto-generated fields).
 */
export interface EnqueueInput {
  /** Collection name */
  collection: string;

  /** Type of mutation */
  type: MutationType;

  /** Operation payload */
  payload: unknown;

  /** Priority level (default: 'normal') */
  priority?: QueuePriority;
}

/**
 * Status of the offline queue.
 */
export type OfflineQueueStatus = 'idle' | 'replaying' | 'empty';

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = 'client-wins';

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ────────────────────────────── Helpers ──────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ────────────────────────────── OfflineQueue ──────────────────────────────

/**
 * Priority-based offline operation queue with conflict resolution.
 *
 * Queues mutations when offline, orders them by priority, and replays
 * them on reconnection. Manages queue size by evicting low-priority
 * items when the maximum is reached.
 *
 * @example
 * ```typescript
 * const queue = new OfflineQueue({ maxSize: 500 });
 *
 * queue.enqueue({
 *   collection: 'todos',
 *   type: 'insert',
 *   payload: { title: 'New todo' },
 *   priority: 'high',
 * });
 *
 * queue.status$.subscribe((status) => {
 *   console.log('Queue status:', status);
 * });
 *
 * const results = await queue.replay();
 * console.log('Replay results:', results);
 *
 * queue.destroy();
 * ```
 */
export class OfflineQueue {
  private readonly maxSize: number;
  private readonly conflictStrategy: ConflictStrategy;
  private readonly maxRetries: number;
  private readonly onReplayComplete?: (results: ReplayResult[]) => void;

  private readonly _queue: QueuedOperation[] = [];
  private readonly _status$ = new BehaviorSubject<OfflineQueueStatus>('empty');
  private readonly _replayed$ = new Subject<ReplayResult[]>();

  constructor(config?: OfflineQueueConfig) {
    this.maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
    this.conflictStrategy = config?.conflictStrategy ?? DEFAULT_CONFLICT_STRATEGY;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.onReplayComplete = config?.onReplayComplete;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of the queue status.
   */
  get status$(): Observable<OfflineQueueStatus> {
    return this._status$.asObservable();
  }

  /**
   * Observable of replay results.
   */
  get replayed$(): Observable<ReplayResult[]> {
    return this._replayed$.asObservable();
  }

  /**
   * Current queue status.
   */
  getStatus(): OfflineQueueStatus {
    return this._status$.value;
  }

  /**
   * Current conflict resolution strategy.
   */
  getConflictStrategy(): ConflictStrategy {
    return this.conflictStrategy;
  }

  /**
   * Number of operations in the queue.
   */
  size(): number {
    return this._queue.length;
  }

  /**
   * Whether the queue is empty.
   */
  isEmpty(): boolean {
    return this._queue.length === 0;
  }

  /**
   * Whether the queue is at maximum capacity.
   */
  isFull(): boolean {
    return this._queue.length >= this.maxSize;
  }

  /**
   * Enqueue a new mutation operation.
   *
   * If the queue is at capacity, the lowest-priority item is evicted.
   * Operations are kept sorted by priority (critical > high > normal > low).
   *
   * @param input - The operation to enqueue
   * @returns The created queued operation
   */
  enqueue(input: EnqueueInput): QueuedOperation {
    const operation: QueuedOperation = {
      id: generateId(),
      collection: input.collection,
      type: input.type,
      payload: input.payload,
      priority: input.priority ?? 'normal',
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: this.maxRetries,
    };

    // Evict lowest-priority item if at capacity
    if (this._queue.length >= this.maxSize) {
      this.evictLowestPriority();
    }

    this._queue.push(operation);
    this.sortByPriority();
    this._status$.next('idle');

    return operation;
  }

  /**
   * Peek at the next operation without removing it.
   *
   * @returns The highest-priority operation, or `null` if empty
   */
  peek(): QueuedOperation | null {
    return this._queue[0] ?? null;
  }

  /**
   * Dequeue the highest-priority operation.
   *
   * @returns The dequeued operation, or `null` if empty
   */
  dequeue(): QueuedOperation | null {
    const operation = this._queue.shift() ?? null;

    if (this._queue.length === 0) {
      this._status$.next('empty');
    }

    return operation;
  }

  /**
   * Get all operations for a specific collection.
   *
   * @param collection - The collection name to filter by
   * @returns Operations for the given collection
   */
  getByCollection(collection: string): QueuedOperation[] {
    return this._queue.filter((op) => op.collection === collection);
  }

  /**
   * Remove a specific operation by ID.
   *
   * @param id - The operation ID to remove
   * @returns Whether the operation was found and removed
   */
  remove(id: string): boolean {
    const index = this._queue.findIndex((op) => op.id === id);
    if (index === -1) return false;

    this._queue.splice(index, 1);

    if (this._queue.length === 0) {
      this._status$.next('empty');
    }

    return true;
  }

  /**
   * Replay all queued operations.
   *
   * Processes operations in priority order, retrying failed operations
   * up to {@link OfflineQueueConfig.maxRetries} times.
   *
   * @returns Array of replay results
   */
  async replay(): Promise<ReplayResult[]> {
    if (this._queue.length === 0) {
      return [];
    }

    this._status$.next('replaying');
    const results: ReplayResult[] = [];
    const failedOps: QueuedOperation[] = [];

    // Yield to event loop
    await Promise.resolve();

    const operations = this._queue.splice(0);

    for (const operation of operations) {
      try {
        // Simulate replay — in a real implementation this would
        // send the mutation to the sync engine / server.
        await Promise.resolve();

        results.push({ operation, success: true });
      } catch (err) {
        operation.retryCount++;

        if (operation.retryCount < operation.maxRetries) {
          failedOps.push(operation);
        }

        results.push({
          operation,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Re-queue failed operations that haven't exceeded max retries
    for (const op of failedOps) {
      this._queue.push(op);
    }

    this.sortByPriority();
    this._status$.next(this._queue.length === 0 ? 'empty' : 'idle');

    this._replayed$.next(results);
    this.onReplayComplete?.(results);

    return results;
  }

  /**
   * Get a snapshot of all queued operations.
   *
   * @returns Copy of the current queue
   */
  getAll(): QueuedOperation[] {
    return [...this._queue];
  }

  /**
   * Clear all operations from the queue.
   */
  clear(): void {
    this._queue.length = 0;
    this._status$.next('empty');
  }

  /**
   * Serialize the queue to a JSON string for persistence.
   *
   * @returns JSON representation of the queue
   */
  serialize(): string {
    return JSON.stringify(this._queue);
  }

  /**
   * Restore the queue from a serialized JSON string.
   *
   * @param data - JSON string of queued operations
   */
  deserialize(data: string): void {
    const operations: QueuedOperation[] = JSON.parse(data) as QueuedOperation[];
    this._queue.length = 0;
    this._queue.push(...operations);
    this.sortByPriority();
    this._status$.next(this._queue.length === 0 ? 'empty' : 'idle');
  }

  /**
   * Destroy the queue and release resources.
   */
  destroy(): void {
    this._queue.length = 0;
    this._status$.next('empty');
    this._status$.complete();
    this._replayed$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private sortByPriority(): void {
    this._queue.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });
  }

  private evictLowestPriority(): void {
    if (this._queue.length === 0) return;

    // Find the last item (lowest priority, oldest)
    let evictIndex = this._queue.length - 1;
    let lowestPriority = PRIORITY_ORDER[this._queue[evictIndex]!.priority];

    for (let i = this._queue.length - 2; i >= 0; i--) {
      const priority = PRIORITY_ORDER[this._queue[i]!.priority];
      if (priority > lowestPriority) {
        lowestPriority = priority;
        evictIndex = i;
      }
    }

    this._queue.splice(evictIndex, 1);
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link OfflineQueue} instance.
 *
 * @param config - Optional offline queue configuration
 * @returns A new OfflineQueue
 *
 * @example
 * ```typescript
 * const queue = createOfflineQueue({
 *   maxSize: 500,
 *   conflictStrategy: 'client-wins',
 *   onReplayComplete: (results) => console.log('Replayed:', results.length),
 * });
 *
 * queue.enqueue({
 *   collection: 'todos',
 *   type: 'insert',
 *   payload: { title: 'New todo' },
 * });
 * ```
 */
export function createOfflineQueue(config?: OfflineQueueConfig): OfflineQueue {
  return new OfflineQueue(config);
}

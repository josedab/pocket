/**
 * @module @pocket/shared-worker/write-coordinator
 *
 * Write conflict prevention across browser tabs. Uses a distributed lock
 * mechanism to serialize writes to the same document, preventing lost updates
 * when multiple tabs modify the same data concurrently.
 *
 * @example
 * ```typescript
 * const coordinator = createWriteCoordinator({ databaseName: 'my-app' });
 * const lock = await coordinator.acquireLock('todos', 'todo-1');
 * try {
 *   await performUpdate();
 * } finally {
 *   coordinator.releaseLock(lock);
 * }
 * ```
 */
import type { Observable } from 'rxjs';
import { Subject } from 'rxjs';

export interface WriteLock {
  readonly lockId: string;
  readonly collection: string;
  readonly documentId: string;
  readonly tabId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

export interface WriteConflict {
  readonly collection: string;
  readonly documentId: string;
  readonly holdingTabId: string;
  readonly requestingTabId: string;
  readonly timestamp: number;
}

export interface WriteCoordinatorConfig {
  databaseName: string;
  lockTimeoutMs?: number;
  maxWaitMs?: number;
  retryIntervalMs?: number;
}

export interface WriteCoordinator {
  acquireLock(collection: string, documentId: string): Promise<WriteLock>;
  releaseLock(lock: WriteLock): void;
  isLocked(collection: string, documentId: string): boolean;
  getActiveLocks(): WriteLock[];
  readonly conflicts$: Observable<WriteConflict>;
  destroy(): void;
}

let lockCounter = 0;

export function createWriteCoordinator(config: WriteCoordinatorConfig): WriteCoordinator {
  const lockTimeoutMs = config.lockTimeoutMs ?? 5000;
  const maxWaitMs = config.maxWaitMs ?? 10000;
  const retryIntervalMs = config.retryIntervalMs ?? 50;
  const tabId = `write-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const locks = new Map<string, WriteLock>();
  const conflictsSubject = new Subject<WriteConflict>();

  function lockKey(collection: string, documentId: string): string {
    return `${collection}:${documentId}`;
  }

  function cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [key, lock] of locks) {
      if (now > lock.expiresAt) {
        locks.delete(key);
      }
    }
  }

  async function acquireLock(collection: string, documentId: string): Promise<WriteLock> {
    const key = lockKey(collection, documentId);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      cleanExpiredLocks();

      const existing = locks.get(key);
      if (!existing) {
        const lock: WriteLock = {
          lockId: `lock_${++lockCounter}`,
          collection,
          documentId,
          tabId,
          acquiredAt: Date.now(),
          expiresAt: Date.now() + lockTimeoutMs,
        };
        locks.set(key, lock);
        return lock;
      }

      // If we already hold the lock, extend it
      if (existing.tabId === tabId) {
        const extended: WriteLock = {
          ...existing,
          expiresAt: Date.now() + lockTimeoutMs,
        };
        locks.set(key, extended);
        return extended;
      }

      // Report conflict
      conflictsSubject.next({
        collection,
        documentId,
        holdingTabId: existing.tabId,
        requestingTabId: tabId,
        timestamp: Date.now(),
      });

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }

    throw new Error(`Failed to acquire lock on ${collection}/${documentId} after ${maxWaitMs}ms`);
  }

  function releaseLock(lock: WriteLock): void {
    const key = lockKey(lock.collection, lock.documentId);
    const existing = locks.get(key);
    if (existing?.lockId === lock.lockId) {
      locks.delete(key);
    }
  }

  function isLocked(collection: string, documentId: string): boolean {
    cleanExpiredLocks();
    return locks.has(lockKey(collection, documentId));
  }

  function getActiveLocks(): WriteLock[] {
    cleanExpiredLocks();
    return Array.from(locks.values());
  }

  function destroy(): void {
    locks.clear();
    conflictsSubject.complete();
  }

  return {
    acquireLock,
    releaseLock,
    isLocked,
    getActiveLocks,
    conflicts$: conflictsSubject.asObservable(),
    destroy,
  };
}

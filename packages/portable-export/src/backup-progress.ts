/**
 * Streaming progress tracking for large backup exports.
 *
 * Provides an observable progress stream that reports backup
 * progress by collection, with ETA estimation and byte counts.
 *
 * @module backup-progress
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Progress for a single collection */
export interface CollectionProgress {
  readonly collection: string;
  readonly documentsProcessed: number;
  readonly totalDocuments: number;
  readonly bytesWritten: number;
  readonly percentComplete: number;
  readonly status: 'pending' | 'processing' | 'complete' | 'error';
}

/** Overall backup progress */
export interface BackupProgress {
  readonly snapshotId: string;
  readonly overallPercent: number;
  readonly collectionsProcessed: number;
  readonly totalCollections: number;
  readonly collections: readonly CollectionProgress[];
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs: number | null;
  readonly totalBytesWritten: number;
  readonly status: 'running' | 'complete' | 'error';
  readonly error?: string;
}

/**
 * Tracks and emits streaming progress for backup operations.
 *
 * @example
 * ```typescript
 * const tracker = new BackupProgressTracker('backup_123');
 *
 * // Subscribe to progress updates
 * tracker.progress$.subscribe(p => {
 *   console.log(`${p.overallPercent}% — ${p.estimatedRemainingMs}ms remaining`);
 * });
 *
 * // Report progress from backup loop
 * tracker.startCollection('todos', 1000);
 * for (let i = 0; i < 1000; i += 100) {
 *   tracker.updateCollection('todos', i + 100, 5000);
 * }
 * tracker.completeCollection('todos');
 * tracker.complete();
 * ```
 */
export class BackupProgressTracker {
  private readonly snapshotId: string;
  private readonly progress$$: BehaviorSubject<BackupProgress>;
  private readonly destroy$ = new Subject<void>();
  private readonly collections = new Map<string, MutableCollectionProgress>();
  private readonly startedAt = Date.now();
  private totalCollections = 0;
  private status: 'running' | 'complete' | 'error' = 'running';
  private errorMessage?: string;

  constructor(snapshotId: string) {
    this.snapshotId = snapshotId;
    this.progress$$ = new BehaviorSubject<BackupProgress>(this.buildProgress());
  }

  /** Observable progress stream */
  get progress$(): Observable<BackupProgress> {
    return this.progress$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Get current progress snapshot */
  getProgress(): BackupProgress {
    return this.progress$$.value;
  }

  /** Set total collection count */
  setTotalCollections(count: number): void {
    this.totalCollections = count;
    this.emit();
  }

  /** Start tracking a collection */
  startCollection(collection: string, totalDocuments: number): void {
    this.collections.set(collection, {
      collection,
      documentsProcessed: 0,
      totalDocuments,
      bytesWritten: 0,
      percentComplete: 0,
      status: 'processing',
    });
    this.emit();
  }

  /** Update progress for a collection */
  updateCollection(collection: string, documentsProcessed: number, bytesWritten: number): void {
    const cp = this.collections.get(collection);
    if (!cp) return;
    cp.documentsProcessed = documentsProcessed;
    cp.bytesWritten = bytesWritten;
    cp.percentComplete = cp.totalDocuments > 0
      ? Math.round((documentsProcessed / cp.totalDocuments) * 10000) / 100
      : 100;
    this.emit();
  }

  /** Mark a collection as complete */
  completeCollection(collection: string): void {
    const cp = this.collections.get(collection);
    if (!cp) return;
    cp.status = 'complete';
    cp.percentComplete = 100;
    cp.documentsProcessed = cp.totalDocuments;
    this.emit();
  }

  /** Mark a collection as errored */
  errorCollection(collection: string, _error: string): void {
    const cp = this.collections.get(collection);
    if (!cp) return;
    cp.status = 'error';
    this.emit();
  }

  /** Mark the entire backup as complete */
  complete(): void {
    this.status = 'complete';
    this.emit();
    this.destroy$.next();
    this.destroy$.complete();
    this.progress$$.complete();
  }

  /** Mark the entire backup as failed */
  fail(error: string): void {
    this.status = 'error';
    this.errorMessage = error;
    this.emit();
    this.destroy$.next();
    this.destroy$.complete();
    this.progress$$.complete();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private emit(): void {
    if (!this.progress$$.closed) {
      this.progress$$.next(this.buildProgress());
    }
  }

  private buildProgress(): BackupProgress {
    const colls = Array.from(this.collections.values());
    const completed = colls.filter((c) => c.status === 'complete').length;
    const totalDocs = colls.reduce((s, c) => s + c.totalDocuments, 0);
    const processedDocs = colls.reduce((s, c) => s + c.documentsProcessed, 0);
    const totalBytes = colls.reduce((s, c) => s + c.bytesWritten, 0);
    const overallPercent = totalDocs > 0
      ? Math.round((processedDocs / totalDocs) * 10000) / 100
      : this.totalCollections > 0 ? Math.round((completed / this.totalCollections) * 10000) / 100 : 0;

    const elapsed = Date.now() - this.startedAt;
    let eta: number | null = null;
    if (overallPercent > 0 && overallPercent < 100) {
      eta = Math.round((elapsed / overallPercent) * (100 - overallPercent));
    }

    return {
      snapshotId: this.snapshotId,
      overallPercent,
      collectionsProcessed: completed,
      totalCollections: this.totalCollections || this.collections.size,
      collections: colls.map((c) => ({ ...c })),
      startedAt: this.startedAt,
      elapsedMs: elapsed,
      estimatedRemainingMs: eta,
      totalBytesWritten: totalBytes,
      status: this.status,
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
    };
  }
}

interface MutableCollectionProgress {
  collection: string;
  documentsProcessed: number;
  totalDocuments: number;
  bytesWritten: number;
  percentComplete: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
}

/** Factory function */
export function createBackupProgressTracker(snapshotId: string): BackupProgressTracker {
  return new BackupProgressTracker(snapshotId);
}

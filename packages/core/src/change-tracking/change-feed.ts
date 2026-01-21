import { type Observable, Subject, takeUntil } from 'rxjs';
import type { ChangeBatch, ChangeEvent, Document } from '../types/document.js';

/**
 * Change feed options
 */
export interface ChangeFeedOptions {
  /** Maximum events to buffer */
  bufferSize?: number;
  /** Enable persistence of change log */
  persistent?: boolean;
}

/**
 * Change feed - central hub for change events
 */
export class ChangeFeed<T extends Document> {
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private readonly destroy$ = new Subject<void>();
  private readonly options: Required<ChangeFeedOptions>;

  private buffer: ChangeEvent<T>[] = [];
  private sequence = 0;
  private lastCheckpoint = '0';

  constructor(options: ChangeFeedOptions = {}) {
    this.options = {
      bufferSize: 1000,
      persistent: false,
      ...options,
    };
  }

  /**
   * Emit a change event
   */
  emit(event: Omit<ChangeEvent<T>, 'sequence'>): void {
    const fullEvent: ChangeEvent<T> = {
      ...event,
      sequence: ++this.sequence,
    };

    // Add to buffer
    this.buffer.push(fullEvent);

    // Trim buffer if needed
    if (this.buffer.length > this.options.bufferSize) {
      this.buffer = this.buffer.slice(-this.options.bufferSize);
    }

    this.lastCheckpoint = String(this.sequence);
    this.changes$.next(fullEvent);
  }

  /**
   * Observable stream of all changes
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get changes since a checkpoint
   */
  changesSince(checkpoint: string): ChangeEvent<T>[] {
    const sinceSequence = parseInt(checkpoint, 10) || 0;
    return this.buffer.filter((event) => event.sequence > sinceSequence);
  }

  /**
   * Get a batch of changes since checkpoint
   */
  getBatch(checkpoint: string, limit = 100): ChangeBatch<T> {
    const changes = this.changesSince(checkpoint).slice(0, limit);
    const lastChange = changes[changes.length - 1];

    return {
      changes,
      checkpoint: lastChange ? String(lastChange.sequence) : checkpoint,
    };
  }

  /**
   * Get current checkpoint
   */
  getCheckpoint(): string {
    return this.lastCheckpoint;
  }

  /**
   * Get current sequence number
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = [];
  }

  /**
   * Destroy the change feed
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.changes$.complete();
    this.buffer = [];
  }
}

/**
 * Multi-collection change feed
 */
export class GlobalChangeFeed {
  private readonly feeds = new Map<string, ChangeFeed<Document>>();
  private readonly globalChanges$ = new Subject<{
    collection: string;
    event: ChangeEvent<Document>;
  }>();
  private readonly destroy$ = new Subject<void>();

  /**
   * Get or create a change feed for a collection
   */
  getOrCreate<T extends Document>(collectionName: string): ChangeFeed<T> {
    let feed = this.feeds.get(collectionName);

    if (!feed) {
      feed = new ChangeFeed<Document>();
      this.feeds.set(collectionName, feed);

      // Forward to global stream
      feed.changes().subscribe((event) => {
        this.globalChanges$.next({ collection: collectionName, event });
      });
    }

    return feed as unknown as ChangeFeed<T>;
  }

  /**
   * Observable of all changes across all collections
   */
  allChanges(): Observable<{ collection: string; event: ChangeEvent<Document> }> {
    return this.globalChanges$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get checkpoint for all collections
   */
  getCheckpoints(): Record<string, string> {
    const checkpoints: Record<string, string> = {};
    for (const [name, feed] of this.feeds) {
      checkpoints[name] = feed.getCheckpoint();
    }
    return checkpoints;
  }

  /**
   * Destroy all change feeds
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.globalChanges$.complete();

    for (const feed of this.feeds.values()) {
      feed.destroy();
    }
    this.feeds.clear();
  }
}

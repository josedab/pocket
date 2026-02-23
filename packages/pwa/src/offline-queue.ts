import { BehaviorSubject, Observable } from 'rxjs';
import type { OfflineQueueItem, PWAConfig } from './types.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_QUEUE_SIZE = 1000;

export class OfflineQueue {
  private items: OfflineQueueItem[] = [];
  private readonly queueSubject: BehaviorSubject<OfflineQueueItem[]>;
  private readonly maxRetries: number;
  private readonly maxQueueSize: number;

  constructor(config?: PWAConfig) {
    this.maxRetries = DEFAULT_MAX_RETRIES;
    this.maxQueueSize = config?.maxOfflineQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.queueSubject = new BehaviorSubject<OfflineQueueItem[]>([]);
  }

  get queue$(): Observable<OfflineQueueItem[]> {
    return this.queueSubject.asObservable();
  }

  get size(): number {
    return this.items.length;
  }

  enqueue(item: Omit<OfflineQueueItem, 'id' | 'timestamp' | 'retryCount'>): OfflineQueueItem {
    if (this.items.length >= this.maxQueueSize) {
      throw new Error(`Offline queue is full (max ${this.maxQueueSize})`);
    }
    const queueItem: OfflineQueueItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      retryCount: 0,
    };
    this.items.push(queueItem);
    this.queueSubject.next([...this.items]);
    return queueItem;
  }

  async drain(
    processor: (item: OfflineQueueItem) => Promise<boolean>,
  ): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    const remaining: OfflineQueueItem[] = [];

    while (this.items.length > 0) {
      const item = this.items.shift()!;
      try {
        const success = await processor(item);
        if (success) {
          processed++;
        } else {
          item.retryCount++;
          if (item.retryCount < this.maxRetries) {
            remaining.push(item);
          } else {
            failed++;
          }
        }
      } catch {
        item.retryCount++;
        if (item.retryCount < this.maxRetries) {
          remaining.push(item);
        } else {
          failed++;
        }
      }
    }

    this.items = remaining;
    this.queueSubject.next([...this.items]);
    return { processed, failed };
  }

  clear(): void {
    this.items = [];
    this.queueSubject.next([]);
  }

  destroy(): void {
    this.clear();
    this.queueSubject.complete();
  }
}

export function createOfflineQueue(config?: PWAConfig): OfflineQueue {
  return new OfflineQueue(config);
}

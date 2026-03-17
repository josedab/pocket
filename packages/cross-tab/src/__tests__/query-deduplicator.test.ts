import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueryDeduplicator,
  createQueryDeduplicator,
  type DeduplicatorStats,
} from '../query-deduplicator.js';

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && instance.onmessage) {
        instance.onmessage(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx >= 0) MockBroadcastChannel.instances.splice(idx, 1);
  }
}

describe('QueryDeduplicator', () => {
  let dedup: QueryDeduplicator;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    dedup?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('cache operations', () => {
    it('should return null for uncached query', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      const result = dedup.getCached('todos', { status: 'active' });
      expect(result).toBeNull();
    });

    it('should cache and retrieve a query result', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      const results = [{ id: '1', text: 'Buy milk' }];
      dedup.cacheAndShare('todos', { status: 'active' }, results);

      const cached = dedup.getCached('todos', { status: 'active' });
      expect(cached).not.toBeNull();
      expect(cached!.results).toEqual(results);
      expect(cached!.collection).toBe('todos');
    });

    it('should return null for expired cache entry', () => {
      dedup = createQueryDeduplicator({ cacheTtlMs: 500 });
      dedup.start();

      dedup.cacheAndShare('todos', { status: 'active' }, [{ id: '1' }]);

      vi.advanceTimersByTime(600);

      const cached = dedup.getCached('todos', { status: 'active' });
      expect(cached).toBeNull();
    });

    it('should differentiate queries by filter', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', { status: 'active' }, [{ id: '1' }]);
      dedup.cacheAndShare('todos', { status: 'done' }, [{ id: '2' }]);

      const active = dedup.getCached('todos', { status: 'active' });
      const done = dedup.getCached('todos', { status: 'done' });

      expect(active!.results).toEqual([{ id: '1' }]);
      expect(done!.results).toEqual([{ id: '2' }]);
    });

    it('should differentiate queries by collection', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [{ id: 'todo-1' }]);
      dedup.cacheAndShare('notes', {}, [{ id: 'note-1' }]);

      const todos = dedup.getCached('todos', {});
      const notes = dedup.getCached('notes', {});

      expect(todos!.results).toEqual([{ id: 'todo-1' }]);
      expect(notes!.results).toEqual([{ id: 'note-1' }]);
    });

    it('should produce consistent keys regardless of filter key order', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', { a: 1, b: 2 }, [{ id: '1' }]);

      const cached = dedup.getCached('todos', { b: 2, a: 1 });
      expect(cached).not.toBeNull();
      expect(cached!.results).toEqual([{ id: '1' }]);
    });
  });

  describe('cache eviction', () => {
    it('should evict oldest entries when max is exceeded', () => {
      dedup = createQueryDeduplicator({ maxCachedQueries: 3 });
      dedup.start();

      dedup.cacheAndShare('c1', {}, [1]);
      dedup.cacheAndShare('c2', {}, [2]);
      dedup.cacheAndShare('c3', {}, [3]);
      dedup.cacheAndShare('c4', {}, [4]);

      // c1 should be evicted
      const stats = dedup.getCurrentStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(3);
    });

    it('should evict expired entries', () => {
      dedup = createQueryDeduplicator({ cacheTtlMs: 200 });
      dedup.start();

      dedup.cacheAndShare('old', {}, [1]);

      vi.advanceTimersByTime(300);

      // Trigger eviction by caching a new result
      dedup.cacheAndShare('new', {}, [2]);

      // The old entry should be gone
      expect(dedup.getCached('old', {})).toBeNull();
    });
  });

  describe('invalidation', () => {
    it('should invalidate a specific collection', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', { a: 1 }, [1]);
      dedup.cacheAndShare('todos', { b: 2 }, [2]);
      dedup.cacheAndShare('notes', {}, [3]);

      dedup.invalidate('todos');

      expect(dedup.getCached('todos', { a: 1 })).toBeNull();
      expect(dedup.getCached('todos', { b: 2 })).toBeNull();
      expect(dedup.getCached('notes', {})).not.toBeNull();
    });

    it('should invalidate all collections when no argument', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [1]);
      dedup.cacheAndShare('notes', {}, [2]);

      dedup.invalidate();

      expect(dedup.getCached('todos', {})).toBeNull();
      expect(dedup.getCached('notes', {})).toBeNull();
    });
  });

  describe('cross-tab sharing', () => {
    it('should share cached results to other tabs', () => {
      const dedup1 = createQueryDeduplicator();
      dedup1.start();

      const dedup2 = createQueryDeduplicator();
      dedup2.start();

      dedup1.cacheAndShare('todos', { status: 'active' }, [{ id: '1' }]);

      // dedup2 should receive the shared result
      const cached = dedup2.getCached('todos', { status: 'active' });
      expect(cached).not.toBeNull();
      expect(cached!.results).toEqual([{ id: '1' }]);

      dedup1.destroy();
      dedup2.destroy();
    });

    it('should track shared results in stats', () => {
      const dedup1 = createQueryDeduplicator();
      dedup1.start();

      const dedup2 = createQueryDeduplicator();
      dedup2.start();

      dedup1.cacheAndShare('todos', {}, [1, 2, 3]);

      const stats = dedup2.getCurrentStats();
      expect(stats.sharedResults).toBeGreaterThanOrEqual(1);

      dedup1.destroy();
      dedup2.destroy();
    });

    it('should not share results to same tab', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [1]);

      // The shared count should be 0 since it's from the same tab
      const stats = dedup.getCurrentStats();
      expect(stats.sharedResults).toBe(0);
    });
  });

  describe('stats', () => {
    it('should track total queries', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.getCached('todos', {});
      dedup.getCached('notes', {});
      dedup.getCached('todos', {});

      const stats = dedup.getCurrentStats();
      expect(stats.totalQueries).toBe(3);
    });

    it('should track cache hits and misses', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [1]);
      dedup.getCached('todos', {}); // hit
      dedup.getCached('notes', {}); // miss

      const stats = dedup.getCurrentStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });

    it('should calculate hit rate', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [1]);
      dedup.getCached('todos', {}); // hit
      dedup.getCached('todos', {}); // hit
      dedup.getCached('notes', {}); // miss

      const stats = dedup.getCurrentStats();
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it('should report hit rate of 0 when no queries', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      expect(dedup.getCurrentStats().hitRate).toBe(0);
    });

    it('should track cache size', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('a', {}, [1]);
      dedup.cacheAndShare('b', {}, [2]);

      expect(dedup.getCurrentStats().cacheSize).toBe(2);
    });

    it('should expose stats observable', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      const allStats: DeduplicatorStats[] = [];
      dedup.getStats().subscribe((s) => allStats.push(s));

      dedup.cacheAndShare('todos', {}, [1]);
      dedup.getCached('todos', {});

      expect(allStats.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('start/stop', () => {
    it('should work without BroadcastChannel', () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      dedup = createQueryDeduplicator();
      dedup.start();

      dedup.cacheAndShare('todos', {}, [1]);
      expect(dedup.getCached('todos', {})).not.toBeNull();
    });

    it('should close channel on stop', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      const before = MockBroadcastChannel.instances.length;
      dedup.stop();
      expect(MockBroadcastChannel.instances.length).toBeLessThan(before);
    });

    it('should work after stop and restart', () => {
      dedup = createQueryDeduplicator();
      dedup.start();
      dedup.stop();

      // Cache still works locally after stop
      dedup.cacheAndShare('todos', {}, [1]);
      expect(dedup.getCached('todos', {})).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('should clear cache on destroy', () => {
      dedup = createQueryDeduplicator();
      dedup.start();
      dedup.cacheAndShare('todos', {}, [1]);
      dedup.destroy();

      // Creating a new instance should have empty cache
      const dedup2 = createQueryDeduplicator();
      expect(dedup2.getCurrentStats().cacheSize).toBe(0);
      dedup2.destroy();
    });

    it('should complete observables on destroy', () => {
      dedup = createQueryDeduplicator();
      dedup.start();

      let completed = false;
      dedup.getStats().subscribe({
        complete: () => {
          completed = true;
        },
      });

      dedup.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('factory', () => {
    it('should create via factory function', () => {
      dedup = createQueryDeduplicator();
      expect(dedup).toBeInstanceOf(QueryDeduplicator);
    });

    it('should accept config', () => {
      dedup = createQueryDeduplicator({
        channelName: 'my-dedup',
        cacheTtlMs: 10000,
        maxCachedQueries: 50,
      });
      expect(dedup).toBeInstanceOf(QueryDeduplicator);
    });
  });
});

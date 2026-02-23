import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { createStreamingPipeline } from '../streaming-pipeline.js';

interface Order {
  _id: string;
  status: string;
  amount: number;
  category: string;
  timestamp: number;
}

const sampleOrders: Order[] = Array.from({ length: 50 }, (_, i) => ({
  _id: `o-${i}`,
  status: i % 3 === 0 ? 'completed' : 'pending',
  amount: 10 + (i % 20) * 5,
  category: i % 2 === 0 ? 'electronics' : 'clothing',
  timestamp: Date.now() - i * 1000,
}));

describe('StreamingPipeline', () => {
  describe('builder', () => {
    it('should build a pipeline with filter', () => {
      const pipeline = createStreamingPipeline<Order>().filter({ status: 'completed' }).build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.every((o) => o.status === 'completed')).toBe(true);
    });

    it('should build a pipeline with function filter', () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter((o) => o.amount > 50)
        .build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.every((o) => o.amount > 50)).toBe(true);
    });

    it('should chain multiple filters', () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter({ status: 'completed' })
        .filter((o) => o.amount > 30)
        .build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.every((o) => o.status === 'completed' && o.amount > 30)).toBe(true);
    });

    it('should apply map transforms', () => {
      const pipeline = createStreamingPipeline<Order>()
        .map((o) => ({ ...o, amount: o.amount * 1.1 }))
        .build();

      const result = pipeline.processBatch([sampleOrders[0]!]);
      expect(result.items[0]!.amount).toBeCloseTo(sampleOrders[0]!.amount * 1.1);
    });

    it('should apply limit', () => {
      const pipeline = createStreamingPipeline<Order>().limit(5).build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.length).toBe(5);
    });

    it('should deduplicate by field', () => {
      const pipeline = createStreamingPipeline<Order>().distinct('category').build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.length).toBe(2);
    });
  });

  describe('aggregations', () => {
    it('should compute count', () => {
      const pipeline = createStreamingPipeline<Order>().aggregate('count', '_id', 'total').build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.aggregations.total).toBe(50);
    });

    it('should compute sum', () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter({ status: 'completed' })
        .aggregate('sum', 'amount', 'totalRevenue')
        .build();

      const result = pipeline.processBatch(sampleOrders);
      const expectedSum = sampleOrders
        .filter((o) => o.status === 'completed')
        .reduce((s, o) => s + o.amount, 0);
      expect(result.aggregations.totalRevenue).toBe(expectedSum);
    });

    it('should compute avg, min, max', () => {
      const pipeline = createStreamingPipeline<Order>()
        .aggregate('avg', 'amount', 'avg')
        .aggregate('min', 'amount', 'min')
        .aggregate('max', 'amount', 'max')
        .build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.aggregations.avg).toBeGreaterThan(0);
      expect(result.aggregations.min).toBe(10);
      expect(result.aggregations.max).toBe(105);
    });

    it('should return null for empty batches', () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter(() => false)
        .aggregate('sum', 'amount', 'total')
        .build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.aggregations.total).toBeNull();
    });
  });

  describe('windowed processing via operator()', () => {
    it('should process items through an observable stream', async () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter({ status: 'completed' })
        .aggregate('count', '_id', 'count')
        .window({ type: 'tumbling', durationMs: 50 })
        .build();

      const source$ = new Subject<Order>();
      const results: unknown[] = [];

      const sub = source$.pipe(pipeline.operator()).subscribe((result) => {
        results.push(result);
      });

      // Emit items
      for (const order of sampleOrders.slice(0, 10)) {
        source$.next(order);
      }

      // Wait for window
      await new Promise((r) => setTimeout(r, 100));

      sub.unsubscribe();
      pipeline.destroy();

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('backpressure', () => {
    it('should drop oldest items when buffer overflows', () => {
      const pipeline = createStreamingPipeline<Order>({ maxBufferSize: 5 }).build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.length).toBe(5);
    });

    it('should drop newest items with drop-newest strategy', () => {
      const pipeline = createStreamingPipeline<Order>({
        maxBufferSize: 5,
        backpressureStrategy: 'drop-newest',
      }).build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.length).toBe(5);
      expect(result.items[0]!._id).toBe('o-0');
    });
  });

  describe('stats', () => {
    it('should track processing statistics', () => {
      const pipeline = createStreamingPipeline<Order>().filter({ status: 'completed' }).build();

      pipeline.processBatch(sampleOrders);
      pipeline.processBatch(sampleOrders);

      const stats = pipeline.getStats();
      expect(stats.totalProcessed).toBe(100);
      expect(stats.windowsCompleted).toBe(2);
      expect(stats.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('combined pipeline', () => {
    it('should handle filter→map→aggregate→limit in one pipeline', () => {
      const pipeline = createStreamingPipeline<Order>()
        .filter({ status: 'completed' })
        .map((o) => ({ ...o, amount: Math.round(o.amount * 1.08) })) // tax
        .aggregate('sum', 'amount', 'totalWithTax')
        .aggregate('count', '_id', 'orderCount')
        .limit(10)
        .build();

      const result = pipeline.processBatch(sampleOrders);
      expect(result.items.length).toBeLessThanOrEqual(10);
      expect(result.items.every((o) => o.status === 'completed')).toBe(true);
      expect(result.aggregations.totalWithTax).toBeGreaterThan(0);
      expect(result.aggregations.orderCount).toBeLessThanOrEqual(10);
    });
  });
});

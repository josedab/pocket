import { Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeEvent, Document } from '../../types/document.js';
import { ChangeStreamAdapter } from '../change-stream-adapter.js';
import { createStreamingPipeline } from '../streaming-pipeline.js';

interface TestDoc extends Document {
  _id: string;
  status: string;
  amount: number;
}

function makeChange(
  op: 'insert' | 'update' | 'delete',
  doc: TestDoc | null,
  prev?: TestDoc
): ChangeEvent<TestDoc> {
  return {
    operation: op,
    documentId: doc?._id ?? prev?._id ?? '',
    document: doc,
    previousDocument: prev,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: 0,
  };
}

describe('ChangeStreamAdapter', () => {
  let adapter: ChangeStreamAdapter<TestDoc>;

  afterEach(() => {
    adapter?.destroy();
  });

  it('should connect to change feed and produce windowed results', async () => {
    const pipeline = createStreamingPipeline<TestDoc>()
      .filter({ status: 'completed' })
      .aggregate('sum', 'amount', 'total')
      .window({ type: 'tumbling', durationMs: 50 })
      .build();

    adapter = new ChangeStreamAdapter(pipeline);
    const changeFeed$ = new Subject<ChangeEvent<Document>>();
    const results: unknown[] = [];

    adapter.results$.subscribe((r) => results.push(r));
    adapter.connect(changeFeed$ as unknown as import('rxjs').Observable<ChangeEvent<Document>>);

    // Emit some changes
    changeFeed$.next(makeChange('insert', { _id: '1', status: 'completed', amount: 100 }));
    changeFeed$.next(makeChange('insert', { _id: '2', status: 'pending', amount: 200 }));
    changeFeed$.next(makeChange('insert', { _id: '3', status: 'completed', amount: 50 }));

    await new Promise((r) => setTimeout(r, 100));

    expect(results.length).toBeGreaterThanOrEqual(1);
    const lastResult = results[results.length - 1] as {
      aggregations: { total: number };
      itemCount: number;
    };
    expect(lastResult.aggregations.total).toBe(150); // 100 + 50, pending filtered out
    expect(lastResult.itemCount).toBe(2);

    pipeline.destroy();
  });

  it('should ignore deletes when configured', async () => {
    const pipeline = createStreamingPipeline<TestDoc>()
      .aggregate('count', '_id', 'count')
      .window({ type: 'tumbling', durationMs: 50 })
      .build();

    adapter = new ChangeStreamAdapter(pipeline, { ignoreDeletes: true });
    const changeFeed$ = new Subject<ChangeEvent<Document>>();
    const results: unknown[] = [];

    adapter.results$.subscribe((r) => results.push(r));
    adapter.connect(changeFeed$ as unknown as import('rxjs').Observable<ChangeEvent<Document>>);

    changeFeed$.next(makeChange('insert', { _id: '1', status: 'a', amount: 10 }));
    changeFeed$.next(makeChange('delete', null, { _id: '2', status: 'b', amount: 20 }));
    changeFeed$.next(makeChange('insert', { _id: '3', status: 'c', amount: 30 }));

    await new Promise((r) => setTimeout(r, 100));

    expect(results.length).toBeGreaterThanOrEqual(1);
    const lastResult = results[results.length - 1] as { aggregations: { count: number } };
    expect(lastResult.aggregations.count).toBe(2); // delete ignored

    pipeline.destroy();
  });

  it('should disconnect and stop processing', async () => {
    const pipeline = createStreamingPipeline<TestDoc>()
      .window({ type: 'tumbling', durationMs: 50 })
      .build();

    adapter = new ChangeStreamAdapter(pipeline);
    const changeFeed$ = new Subject<ChangeEvent<Document>>();
    const results: unknown[] = [];

    adapter.results$.subscribe((r) => results.push(r));
    adapter.connect(changeFeed$ as unknown as import('rxjs').Observable<ChangeEvent<Document>>);
    adapter.disconnect();

    changeFeed$.next(makeChange('insert', { _id: '1', status: 'a', amount: 10 }));
    await new Promise((r) => setTimeout(r, 100));

    expect(results.length).toBe(0);
    pipeline.destroy();
  });
});

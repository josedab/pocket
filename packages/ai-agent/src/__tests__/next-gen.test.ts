import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentChange } from '../document-watcher.js';
import {
  createDocumentWatcher,
  createInferenceCache,
  createScheduledTaskRunner,
} from '../index.js';
import type { LLMProvider } from '../types.js';

function createMockProvider(response = 'AI response'): LLMProvider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({ content: response, toolCalls: [] }),
  };
}

describe('ScheduledTaskRunner', () => {
  let runner: ReturnType<typeof createScheduledTaskRunner>;

  afterEach(() => {
    runner?.destroy();
  });

  it('should register and execute a task on-demand', async () => {
    const provider = createMockProvider('Summary: 5 items processed');
    runner = createScheduledTaskRunner(provider);

    runner.registerTask({
      id: 'summarize',
      name: 'Daily Summary',
      intervalMs: 60_000,
      prompt: 'Summarize recent activity',
    });

    const result = await runner.executeNow('summarize');
    expect(result.success).toBe(true);
    expect(result.output).toBe('Summary: 5 items processed');
    expect(result.taskId).toBe('summarize');
  });

  it('should return error for unknown task', async () => {
    runner = createScheduledTaskRunner(createMockProvider());
    const result = await runner.executeNow('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle LLM errors gracefully', async () => {
    const provider: LLMProvider = {
      name: 'failing',
      complete: vi.fn().mockRejectedValue(new Error('API rate limit')),
    };
    runner = createScheduledTaskRunner(provider);
    runner.registerTask({
      id: 'fail-task',
      name: 'Failing',
      intervalMs: 60_000,
      prompt: 'Do something',
    });

    const result = await runner.executeNow('fail-task');
    expect(result.success).toBe(false);
    expect(result.error).toBe('API rate limit');
  });

  it('should track execution history', async () => {
    runner = createScheduledTaskRunner(createMockProvider());
    runner.registerTask({
      id: 't1',
      name: 'Task 1',
      intervalMs: 60_000,
      prompt: 'Test',
    });

    await runner.executeNow('t1');
    await runner.executeNow('t1');

    const history = runner.getHistory('t1');
    expect(history).toHaveLength(2);
  });

  it('should emit events', async () => {
    runner = createScheduledTaskRunner(createMockProvider());
    const events: string[] = [];
    const sub = runner.events.subscribe((e) => events.push(e.type));

    runner.registerTask({
      id: 'evt',
      name: 'Event Test',
      intervalMs: 60_000,
      prompt: 'Test',
    });

    await runner.executeNow('evt');
    sub.unsubscribe();

    expect(events).toContain('task-started');
    expect(events).toContain('task-completed');
  });

  it('should start and stop the runner', () => {
    runner = createScheduledTaskRunner(createMockProvider());
    runner.registerTask({
      id: 'periodic',
      name: 'Periodic',
      intervalMs: 100_000,
      prompt: 'Run',
    });

    const events: string[] = [];
    const sub = runner.events.subscribe((e) => events.push(e.type));

    runner.start();
    runner.stop();
    sub.unsubscribe();

    expect(events).toContain('runner-started');
    expect(events).toContain('runner-stopped');
  });
});

describe('DocumentWatcher', () => {
  it('should trigger pipeline on document change', async () => {
    const provider = createMockProvider('Classified as: important');
    const watcher = createDocumentWatcher(provider);

    const changeSubject = new Subject<DocumentChange>();
    watcher.registerSource('todos', {
      subscribe: (cb) => changeSubject.subscribe(cb),
    });

    const results: string[] = [];
    const sub = watcher.results.subscribe((r) => results.push(r.output));

    watcher.addPipeline({
      id: 'classify',
      name: 'Auto-classify',
      collection: 'todos',
      triggers: ['insert'],
      promptTemplate: 'Classify this document: {{document}}',
      debounceMs: 0,
    });

    // Emit a change
    changeSubject.next({
      type: 'insert',
      collection: 'todos',
      documentId: 'doc-1',
      document: { title: 'Buy milk', priority: 'low' },
    });

    // Wait for debounce + execution
    await new Promise((r) => setTimeout(r, 50));

    sub.unsubscribe();
    watcher.destroy();

    expect(results).toHaveLength(1);
    expect(results[0]).toBe('Classified as: important');
  });

  it('should trigger pipeline manually', async () => {
    const provider = createMockProvider('Processed');
    const watcher = createDocumentWatcher(provider);

    watcher.addPipeline({
      id: 'manual',
      name: 'Manual pipeline',
      collection: 'notes',
      triggers: ['any'],
      promptTemplate: 'Process: {{document}}',
    });

    const result = await watcher.triggerPipeline('manual', {
      type: 'update',
      collection: 'notes',
      documentId: 'n1',
      document: { text: 'Hello world' },
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('Processed');
    watcher.destroy();
  });

  it('should return error for unknown pipeline', async () => {
    const watcher = createDocumentWatcher(createMockProvider());
    const result = await watcher.triggerPipeline('unknown', {
      type: 'insert',
      collection: 'test',
      documentId: 'x',
    });
    expect(result.success).toBe(false);
    watcher.destroy();
  });
});

describe('InferenceCache', () => {
  it('should cache and retrieve responses', () => {
    const cache = createInferenceCache();
    cache.set('What is 2+2?', 'The answer is 4');
    expect(cache.get('What is 2+2?')).toBe('The answer is 4');
  });

  it('should normalize prompts for matching', () => {
    const cache = createInferenceCache();
    cache.set('  What  is  2+2?  ', '4');
    expect(cache.get('what is 2+2?')).toBe('4');
  });

  it('should return undefined for cache misses', () => {
    const cache = createInferenceCache();
    expect(cache.get('unknown prompt')).toBeUndefined();
  });

  it('should track hit/miss statistics', () => {
    const cache = createInferenceCache();
    cache.set('q1', 'a1');
    cache.get('q1'); // hit
    cache.get('q2'); // miss
    cache.get('q1'); // hit

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.667, 2);
  });

  it('should track saved time', () => {
    const cache = createInferenceCache();
    cache.set('q1', 'a1');
    cache.get('q1', 500);
    cache.get('q1', 500);

    const stats = cache.getStats();
    expect(stats.totalSavedMs).toBe(1000);
  });

  it('should evict oldest when at capacity', () => {
    const cache = createInferenceCache({ maxEntries: 2 });
    cache.set('q1', 'a1');
    cache.set('q2', 'a2');
    cache.set('q3', 'a3'); // evicts q1

    expect(cache.get('q1')).toBeUndefined();
    expect(cache.get('q3')).toBe('a3');
  });

  it('should clear all entries', () => {
    const cache = createInferenceCache();
    cache.set('q1', 'a1');
    cache.set('q2', 'a2');
    cache.clear();
    expect(cache.getStats().entries).toBe(0);
  });

  it('should invalidate matching entries', () => {
    const cache = createInferenceCache();
    cache.set('summarize todos collection', 'summary1');
    cache.set('summarize notes collection', 'summary2');
    cache.set('classify documents', 'class1');

    const removed = cache.invalidateMatching('summarize');
    expect(removed).toBe(2);
    expect(cache.get('classify documents')).toBe('class1');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevToolsPanel } from '../devtools-panel.js';

describe('DevToolsPanel', () => {
  let panel: DevToolsPanel;

  const mockDb = {
    name: 'test-db',
    listCollections: async () => ['todos', 'users'],
    collection: (name: string) => ({
      find: (filter?: Record<string, unknown>) => ({
        exec: async () => {
          if (name === 'todos') {
            const docs = [
              { _id: '1', title: 'Task 1', completed: false },
              { _id: '2', title: 'Task 2', completed: true },
            ];
            if (filter?.completed !== undefined) {
              return docs.filter((d) => d.completed === filter.completed);
            }
            return docs;
          }
          return [{ _id: '10', name: 'Alice' }];
        },
      }),
      count: async () => (name === 'todos' ? 2 : 1),
      get: async (id: string) => ({ _id: id, name: 'mock' }),
    }),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    panel = new DevToolsPanel({ refreshIntervalMs: 5000 });
  });

  afterEach(() => {
    panel.destroy();
    vi.useRealTimers();
  });

  it('should return empty snapshot without database', async () => {
    const snapshot = await panel.getSnapshot();
    expect(snapshot.databaseName).toBe('');
    expect(snapshot.collections).toHaveLength(0);
  });

  it('should get snapshot with connected database', async () => {
    panel.connectDatabase(mockDb);
    const snapshot = await panel.getSnapshot();

    expect(snapshot.databaseName).toBe('test-db');
    expect(snapshot.collections).toHaveLength(2);
    expect(snapshot.collections[0]!.name).toBe('todos');
    expect(snapshot.collections[0]!.documentCount).toBe(2);
    expect(snapshot.collections[1]!.name).toBe('users');
    expect(snapshot.collections[1]!.documentCount).toBe(1);
  });

  it('should execute query command', async () => {
    panel.connectDatabase(mockDb);

    const result = await panel.executeCommand({
      type: 'query',
      collection: 'todos',
      filter: { completed: false },
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('should execute list-collections command', async () => {
    panel.connectDatabase(mockDb);

    const result = await panel.executeCommand({ type: 'list-collections' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['todos', 'users']);
  });

  it('should execute get-document command', async () => {
    panel.connectDatabase(mockDb);

    const result = await panel.executeCommand({
      type: 'get-document',
      collection: 'users',
      documentId: '10',
    });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?._id).toBe('10');
  });

  it('should execute get-metrics command', async () => {
    panel.connectDatabase(mockDb);

    const result = await panel.executeCommand({ type: 'get-metrics' });
    expect(result.success).toBe(true);
    const metrics = result.data as Record<string, unknown>;
    expect(metrics.totalQueries).toBe(0);
  });

  it('should record and buffer change events', () => {
    const updates: unknown[] = [];
    panel.updates$.subscribe((u) => updates.push(u));

    panel.recordChange('todos', 'insert', 'doc-1');
    panel.recordChange('todos', 'update', 'doc-1');
    panel.recordChange('todos', 'delete', 'doc-2');

    expect(updates).toHaveLength(3);
  });

  it('should track write metrics', async () => {
    panel.connectDatabase(mockDb);
    panel.recordChange('todos', 'insert', 'doc-1');
    panel.recordChange('todos', 'update', 'doc-2');

    const result = await panel.executeCommand({ type: 'get-metrics' });
    const metrics = result.data as Record<string, number>;
    expect(metrics.totalWrites).toBe(2);
  });

  it('should clear events', async () => {
    panel.recordChange('todos', 'insert', 'doc-1');
    panel.recordChange('todos', 'insert', 'doc-2');

    const result = await panel.executeCommand({ type: 'clear-events' });
    expect(result.success).toBe(true);
  });

  it('should track query metrics', async () => {
    panel.connectDatabase(mockDb);

    await panel.executeCommand({ type: 'query', collection: 'todos' });
    await panel.executeCommand({ type: 'query', collection: 'users' });

    const result = await panel.executeCommand({ type: 'get-metrics' });
    const metrics = result.data as Record<string, number>;
    expect(metrics.totalQueries).toBe(2);
  });
});

/**
 * Svelte store behavioral tests
 *
 * Tests the Svelte stores by mocking the context provider to inject
 * a mock database/collection. Verifies store reactivity, mutation
 * operations, loading/error state, and callbacks.
 */
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the context provider so getCollection returns our mock
const mockCollection = {
  insert: vi.fn(),
  insertMany: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  find: vi.fn().mockReturnValue({
    live: vi.fn().mockReturnValue({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }),
    exec: vi.fn().mockResolvedValue([]),
  }),
};

vi.mock('../context/provider.js', () => ({
  getCollection: vi.fn(() => mockCollection),
  getDatabase: vi.fn(() => ({ collection: vi.fn(() => mockCollection) })),
  getPocketContext: vi.fn(() => ({
    database: { subscribe: vi.fn() },
    isReady: { subscribe: vi.fn() },
    error: { subscribe: vi.fn() },
  })),
}));

describe('@pocket/svelte stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.insert.mockResolvedValue({ _id: '1', title: 'Test' });
    mockCollection.insertMany.mockResolvedValue([{ _id: '1' }, { _id: '2' }]);
    mockCollection.update.mockResolvedValue({ _id: '1', title: 'Updated' });
    mockCollection.upsert.mockResolvedValue({ _id: '1', title: 'Upserted' });
    mockCollection.delete.mockResolvedValue(undefined);
    mockCollection.deleteMany.mockResolvedValue(undefined);
  });

  describe('createMutation', () => {
    it('should create mutation store with all operations', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      expect(mutation.insert).toBeDefined();
      expect(mutation.insertMany).toBeDefined();
      expect(mutation.update).toBeDefined();
      expect(mutation.upsert).toBeDefined();
      expect(mutation.remove).toBeDefined();
      expect(mutation.removeMany).toBeDefined();
      expect(mutation.isLoading).toBeDefined();
      expect(mutation.error).toBeDefined();
      expect(mutation.resetError).toBeDefined();
    });

    it('should have isLoading initially false', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');
      expect(get(mutation.isLoading)).toBe(false);
    });

    it('should have error initially null', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');
      expect(get(mutation.error)).toBeNull();
    });

    it('should call collection.insert on insert', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      const doc = { title: 'New todo', completed: false };
      await mutation.insert(doc);

      expect(mockCollection.insert).toHaveBeenCalledWith(doc);
    });

    it('should call collection.update on update', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.update('1', { title: 'Changed' });
      expect(mockCollection.update).toHaveBeenCalledWith('1', { title: 'Changed' });
    });

    it('should call collection.delete on remove', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.remove('1');
      expect(mockCollection.delete).toHaveBeenCalledWith('1');
    });

    it('should call collection.upsert on upsert', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.upsert('1', { title: 'Upserted' });
      expect(mockCollection.upsert).toHaveBeenCalledWith('1', { title: 'Upserted' });
    });

    it('should call collection.insertMany on insertMany', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      const docs = [{ title: 'A' }, { title: 'B' }];
      await mutation.insertMany(docs);
      expect(mockCollection.insertMany).toHaveBeenCalledWith(docs);
    });

    it('should call collection.deleteMany on removeMany', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.removeMany(['1', '2']);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(['1', '2']);
    });

    it('should set isLoading=false after successful mutation', async () => {
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.insert({ title: 'Test' });
      expect(get(mutation.isLoading)).toBe(false);
    });

    it('should set error on mutation failure', async () => {
      mockCollection.insert.mockRejectedValue(new Error('Insert failed'));
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await expect(mutation.insert({ title: 'Test' })).rejects.toThrow('Insert failed');
      expect(get(mutation.error)).toBeInstanceOf(Error);
      expect(get(mutation.error)!.message).toBe('Insert failed');
    });

    it('should set isLoading=false after failed mutation', async () => {
      mockCollection.insert.mockRejectedValue(new Error('fail'));
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.insert({ title: 'Test' }).catch(() => {});
      expect(get(mutation.isLoading)).toBe(false);
    });

    it('should clear error with resetError', async () => {
      mockCollection.insert.mockRejectedValue(new Error('fail'));
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos');

      await mutation.insert({ title: 'x' }).catch(() => {});
      expect(get(mutation.error)).not.toBeNull();

      mutation.resetError();
      expect(get(mutation.error)).toBeNull();
    });

    it('should call onSuccess callback on successful mutation', async () => {
      const onSuccess = vi.fn();
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos', { onSuccess });

      await mutation.insert({ title: 'Test' });
      expect(onSuccess).toHaveBeenCalledOnce();
    });

    it('should call onError callback on failed mutation', async () => {
      mockCollection.insert.mockRejectedValue(new Error('fail'));
      const onError = vi.fn();
      const { createMutation } = await import('../stores/mutation.js');
      const mutation = createMutation('todos', { onError });

      await mutation.insert({ title: 'x' }).catch(() => {});
      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createLiveQuery', () => {
    it('should create live query store with all properties', async () => {
      const { createLiveQuery } = await import('../stores/live-query.js');
      const store = createLiveQuery('todos');

      expect(store.subscribe).toBeDefined();
      expect(store.isLoading).toBeDefined();
      expect(store.error).toBeDefined();
      expect(store.refresh).toBeDefined();
    });

    it('should call collection.find().live() to create subscription', async () => {
      const { createLiveQuery } = await import('../stores/live-query.js');
      createLiveQuery('todos');

      expect(mockCollection.find).toHaveBeenCalled();
    });

    it('should support custom query function', async () => {
      const customQueryFn = vi.fn().mockReturnValue({
        live: vi.fn().mockReturnValue({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }),
        exec: vi.fn().mockResolvedValue([]),
      });

      const { createLiveQuery } = await import('../stores/live-query.js');
      createLiveQuery('todos', customQueryFn);

      expect(customQueryFn).toHaveBeenCalled();
    });
  });
});

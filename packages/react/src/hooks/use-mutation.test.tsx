import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useOptimisticMutation } from './use-mutation.js';
import { PocketProvider } from '../context/provider.js';
import type { Database, Document } from '@pocket/core';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
}

// Create a mock collection
function createMockCollection() {
  return {
    name: 'test-collection',
    insert: vi.fn().mockImplementation((doc) => Promise.resolve({ ...doc, _id: doc._id ?? 'new-id' })),
    insertMany: vi.fn().mockImplementation((docs) =>
      Promise.resolve(docs.map((d: TestDoc, i: number) => ({ ...d, _id: d._id ?? `new-id-${i}` })))
    ),
    update: vi.fn().mockImplementation((id, changes) => Promise.resolve({ _id: id, ...changes })),
    upsert: vi.fn().mockImplementation((id, doc) => Promise.resolve({ _id: id, ...doc })),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    find: vi.fn(),
    changes: vi.fn(),
    observeById: vi.fn(),
  };
}

// Create a mock database
function createMockDatabase(collection: ReturnType<typeof createMockCollection>): Database {
  return {
    name: 'test-db',
    collection: vi.fn().mockReturnValue(collection),
    close: vi.fn(),
    isOpen: true,
  } as unknown as Database;
}

describe('useMutation', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should start with isLoading false and no error', () => {
    const TestComponent = () => {
      const { isLoading, error } = useMutation<TestDoc>('test-collection');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('no-error');
  });

  it('should insert a document', async () => {
    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert, isLoading, error } = useMutation<TestDoc>('test-collection');
      insertFn = insert;
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    let result: TestDoc | null = null;
    await act(async () => {
      result = await insertFn!({ title: 'New Doc', count: 1 });
    });

    expect(mockCollection.insert).toHaveBeenCalledWith({ title: 'New Doc', count: 1 });
    expect(result).toEqual({ _id: 'new-id', title: 'New Doc', count: 1 });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('should insert many documents', async () => {
    let insertManyFn: ((docs: Omit<TestDoc, '_id'>[]) => Promise<TestDoc[]>) | null = null;

    const TestComponent = () => {
      const { insertMany } = useMutation<TestDoc>('test-collection');
      insertManyFn = insertMany;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    let results: TestDoc[] | null = null;
    await act(async () => {
      results = await insertManyFn!([
        { title: 'Doc 1', count: 1 },
        { title: 'Doc 2', count: 2 },
      ]);
    });

    expect(mockCollection.insertMany).toHaveBeenCalledWith([
      { title: 'Doc 1', count: 1 },
      { title: 'Doc 2', count: 2 },
    ]);
    expect(results).toHaveLength(2);
  });

  it('should update a document', async () => {
    let updateFn: ((id: string, changes: Partial<TestDoc>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { update } = useMutation<TestDoc>('test-collection');
      updateFn = update;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    let result: TestDoc | null = null;
    await act(async () => {
      result = await updateFn!('doc-1', { title: 'Updated' });
    });

    expect(mockCollection.update).toHaveBeenCalledWith('doc-1', { title: 'Updated' });
    expect(result?._id).toBe('doc-1');
  });

  it('should upsert a document', async () => {
    let upsertFn: ((id: string, doc: Partial<TestDoc>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { upsert } = useMutation<TestDoc>('test-collection');
      upsertFn = upsert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await upsertFn!('doc-1', { title: 'Upserted', count: 10 });
    });

    expect(mockCollection.upsert).toHaveBeenCalledWith('doc-1', { title: 'Upserted', count: 10 });
  });

  it('should delete a document', async () => {
    let removeFn: ((id: string) => Promise<void>) | null = null;

    const TestComponent = () => {
      const { remove } = useMutation<TestDoc>('test-collection');
      removeFn = remove;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await removeFn!('doc-1');
    });

    expect(mockCollection.delete).toHaveBeenCalledWith('doc-1');
  });

  it('should delete many documents', async () => {
    let removeManyFn: ((ids: string[]) => Promise<void>) | null = null;

    const TestComponent = () => {
      const { removeMany } = useMutation<TestDoc>('test-collection');
      removeManyFn = removeMany;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await removeManyFn!(['doc-1', 'doc-2']);
    });

    expect(mockCollection.deleteMany).toHaveBeenCalledWith(['doc-1', 'doc-2']);
  });

  it('should handle mutation error', async () => {
    mockCollection.insert.mockRejectedValue(new Error('Insert failed'));

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert, error } = useMutation<TestDoc>('test-collection');
      insertFn = insert;
      return <span data-testid="error">{error ? error.message : 'no-error'}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      try {
        await insertFn!({ title: 'Fail', count: 0 });
      } catch {
        // Expected
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Insert failed');
    });
  });

  it('should call onSuccess callback', async () => {
    const onSuccess = vi.fn();

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert } = useMutation<TestDoc>('test-collection', { onSuccess });
      insertFn = insert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await insertFn!({ title: 'New', count: 1 });
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it('should call onError callback', async () => {
    mockCollection.insert.mockRejectedValue(new Error('Insert failed'));
    const onError = vi.fn();

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert } = useMutation<TestDoc>('test-collection', { onError });
      insertFn = insert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      try {
        await insertFn!({ title: 'Fail', count: 0 });
      } catch {
        // Expected
      }
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should reset error state', async () => {
    mockCollection.insert.mockRejectedValueOnce(new Error('Insert failed'));

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;
    let resetErrorFn: (() => void) | null = null;

    const TestComponent = () => {
      const { insert, error, resetError } = useMutation<TestDoc>('test-collection');
      insertFn = insert;
      resetErrorFn = resetError;
      return <span data-testid="error">{error ? error.message : 'no-error'}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      try {
        await insertFn!({ title: 'Fail', count: 0 });
      } catch {
        // Expected
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Insert failed');
    });

    act(() => {
      resetErrorFn!();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });
  });
});

describe('useOptimisticMutation', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should apply optimistic update on insert', async () => {
    const currentData: TestDoc[] = [{ _id: '1', title: 'Existing', count: 1 }];
    const setCurrentData = vi.fn();

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert } = useOptimisticMutation<TestDoc>('test-collection', {
        currentData,
        setCurrentData,
        optimisticUpdate: (data, mutation) => {
          if (mutation.type === 'insert') {
            return [...data, mutation.doc];
          }
          return data;
        },
      });
      insertFn = insert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await insertFn!({ title: 'New Doc', count: 2 });
    });

    // setCurrentData should have been called with optimistic data
    expect(setCurrentData).toHaveBeenCalled();
  });

  it('should rollback on error', async () => {
    mockCollection.insert.mockRejectedValue(new Error('Insert failed'));

    const currentData: TestDoc[] = [{ _id: '1', title: 'Existing', count: 1 }];
    const setCurrentData = vi.fn();

    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert } = useOptimisticMutation<TestDoc>('test-collection', {
        currentData,
        setCurrentData,
        optimisticUpdate: (data, mutation) => {
          if (mutation.type === 'insert') {
            return [...data, mutation.doc];
          }
          return data;
        },
      });
      insertFn = insert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      try {
        await insertFn!({ title: 'New Doc', count: 2 });
      } catch {
        // Expected
      }
    });

    // Should have rolled back - setCurrentData called twice (optimistic + rollback)
    expect(setCurrentData).toHaveBeenCalledTimes(2);
    // Last call should be the rollback with original data
    expect(setCurrentData).toHaveBeenLastCalledWith(currentData);
  });

  it('should apply optimistic update on delete', async () => {
    const currentData: TestDoc[] = [
      { _id: '1', title: 'Doc 1', count: 1 },
      { _id: '2', title: 'Doc 2', count: 2 },
    ];
    const setCurrentData = vi.fn();

    let removeFn: ((id: string) => Promise<void>) | null = null;

    const TestComponent = () => {
      const { remove } = useOptimisticMutation<TestDoc>('test-collection', {
        currentData,
        setCurrentData,
        optimisticUpdate: (data, mutation) => {
          if (mutation.type === 'delete') {
            return data.filter((d) => d._id !== mutation.id);
          }
          return data;
        },
      });
      removeFn = remove;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await removeFn!('1');
    });

    // First call should remove the document optimistically
    expect(setCurrentData).toHaveBeenCalledWith([{ _id: '2', title: 'Doc 2', count: 2 }]);
  });

  it('should provide rollback function', async () => {
    const currentData: TestDoc[] = [{ _id: '1', title: 'Existing', count: 1 }];
    const setCurrentData = vi.fn();

    let rollbackFn: (() => void) | null = null;
    let insertFn: ((doc: Omit<TestDoc, '_id'>) => Promise<TestDoc>) | null = null;

    const TestComponent = () => {
      const { insert, rollback } = useOptimisticMutation<TestDoc>('test-collection', {
        currentData,
        setCurrentData,
        optimisticUpdate: (data, mutation) => {
          if (mutation.type === 'insert') {
            return [...data, mutation.doc];
          }
          return data;
        },
      });
      rollbackFn = rollback;
      insertFn = insert;
      return null;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await act(async () => {
      await insertFn!({ title: 'New', count: 2 });
    });

    act(() => {
      rollbackFn!();
    });

    // Should have called setCurrentData with original data on rollback
    expect(setCurrentData).toHaveBeenLastCalledWith(currentData);
  });
});

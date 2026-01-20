import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLiveQuery, useQuery } from './use-live-query.js';
import { PocketProvider } from '../context/provider.js';
import type { Database, Document, Collection, QueryBuilder } from '@pocket/core';
import { Subject, of } from 'rxjs';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
}

// Create mock query builder
function createMockQueryBuilder(liveSubject: Subject<TestDoc[]>) {
  const builder = {
    exec: vi.fn().mockResolvedValue([]),
    live: vi.fn().mockReturnValue(liveSubject.asObservable()),
    where: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
  return builder as unknown as QueryBuilder<TestDoc>;
}

// Create a mock collection
function createMockCollection() {
  const liveSubject = new Subject<TestDoc[]>();
  const queryBuilder = createMockQueryBuilder(liveSubject);

  return {
    name: 'test-collection',
    find: vi.fn().mockReturnValue(queryBuilder),
    get: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    changes: vi.fn().mockReturnValue(of({})),
    observeById: vi.fn().mockReturnValue(of(null)),
    // Test helpers
    _liveSubject: liveSubject,
    _queryBuilder: queryBuilder,
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

describe('useLiveQuery', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should start in loading state', () => {
    const TestComponent = () => {
      const { isLoading, data } = useLiveQuery<TestDoc>('test-collection');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{data.length}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('should receive live updates', async () => {
    const TestComponent = () => {
      const { isLoading, data, error } = useLiveQuery<TestDoc>('test-collection');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{data.length}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
          {data.map((doc) => (
            <span key={doc._id} data-testid={`doc-${doc._id}`}>
              {doc.title}
            </span>
          ))}
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    // Emit documents via live query
    act(() => {
      mockCollection._liveSubject.next([
        { _id: '1', title: 'Doc 1', count: 1 },
        { _id: '2', title: 'Doc 2', count: 2 },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('count')).toHaveTextContent('2');
      expect(screen.getByTestId('doc-1')).toHaveTextContent('Doc 1');
      expect(screen.getByTestId('doc-2')).toHaveTextContent('Doc 2');
    });
  });

  it('should accept custom query function', async () => {
    const customQueryFn = vi.fn((collection: Collection<TestDoc>) => {
      return collection.find({ count: { $gt: 5 } });
    });

    const TestComponent = () => {
      const { data } = useLiveQuery<TestDoc>('test-collection', customQueryFn, []);
      return <span data-testid="count">{data.length}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(customQueryFn).toHaveBeenCalled();
    expect(mockCollection.find).toHaveBeenCalledWith({ count: { $gt: 5 } });
  });

  it('should respect enabled option', async () => {
    const TestComponent = () => {
      const { isLoading, data } = useLiveQuery<TestDoc>(
        'test-collection',
        undefined,
        [],
        { enabled: false }
      );
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{data.length}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });

    // find should not be called when disabled
    expect(mockCollection.find).not.toHaveBeenCalled();
  });

  it('should handle observable error', async () => {
    const TestComponent = () => {
      const { isLoading, data, error } = useLiveQuery<TestDoc>('test-collection');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{data.length}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    // Emit error
    act(() => {
      mockCollection._liveSubject.error(new Error('Query failed'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('Query failed');
    });
  });

  it('should call live() with correct options', async () => {
    const TestComponent = () => {
      const { data } = useLiveQuery<TestDoc>(
        'test-collection',
        undefined,
        [],
        { debounceMs: 100, useEventReduce: false }
      );
      return <span data-testid="count">{data.length}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(mockCollection._queryBuilder.live).toHaveBeenCalledWith({
      debounceMs: 100,
      useEventReduce: false,
    });
  });

  it('should call refresh function', async () => {
    mockCollection._queryBuilder.exec.mockResolvedValue([{ _id: '1', title: 'Refreshed', count: 1 }]);

    const TestComponent = () => {
      const { refresh } = useLiveQuery<TestDoc>('test-collection');
      return (
        <button data-testid="refresh" onClick={refresh}>
          Refresh
        </button>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    // Click refresh
    act(() => {
      screen.getByTestId('refresh').click();
    });

    await waitFor(() => {
      expect(mockCollection._queryBuilder.exec).toHaveBeenCalled();
    });
  });
});

describe('useQuery', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should query with filter', async () => {
    const TestComponent = () => {
      const { data } = useQuery<TestDoc>('test-collection', { count: 10 });
      return <span data-testid="count">{data.length}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(mockCollection.find).toHaveBeenCalledWith({ count: 10 });
  });

  it('should query without filter', async () => {
    const TestComponent = () => {
      const { data } = useQuery<TestDoc>('test-collection');
      return <span data-testid="count">{data.length}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(mockCollection.find).toHaveBeenCalledWith(undefined);
  });

  it('should pass options to useLiveQuery', async () => {
    const TestComponent = () => {
      const { data, isLoading } = useQuery<TestDoc>(
        'test-collection',
        { title: 'Test' },
        { enabled: false }
      );
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{data.length}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // Should not call find when disabled
    expect(mockCollection.find).not.toHaveBeenCalled();
  });
});

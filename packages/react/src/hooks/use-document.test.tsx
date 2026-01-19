import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDocument, useFindOne } from './use-document.js';
import { PocketProvider } from '../context/provider.js';
import type { Database, Document, Collection } from '@pocket/core';
import { Subject } from 'rxjs';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
}

// Create a mock collection with observable
function createMockCollection() {
  const documentSubject = new Subject<TestDoc | null>();
  const changesSubject = new Subject<unknown>();

  return {
    name: 'test-collection',
    get: vi.fn().mockResolvedValue(null),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnThis(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    changes: vi.fn().mockReturnValue(changesSubject.asObservable()),
    observeById: vi.fn().mockReturnValue(documentSubject.asObservable()),
    // Test helpers
    _documentSubject: documentSubject,
    _changesSubject: changesSubject,
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

describe('useDocument', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should start in loading state', () => {
    const TestComponent = () => {
      const { isLoading, data } = useDocument<TestDoc>('test-collection', 'doc-1');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('data')).toHaveTextContent('null');
  });

  it('should load document when observable emits', async () => {
    const TestComponent = () => {
      const { isLoading, data, error } = useDocument<TestDoc>('test-collection', 'doc-1');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    // Emit document via observable
    act(() => {
      mockCollection._documentSubject.next({ _id: 'doc-1', title: 'Test Doc', count: 42 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('data')).toHaveTextContent('Test Doc');
    });
  });

  it('should handle null document ID', async () => {
    const TestComponent = () => {
      const { isLoading, data } = useDocument<TestDoc>('test-collection', null);
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
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
      expect(screen.getByTestId('data')).toHaveTextContent('null');
    });
  });

  it('should respect enabled option', async () => {
    const TestComponent = ({ enabled }: { enabled: boolean }) => {
      const { isLoading, data } = useDocument<TestDoc>('test-collection', 'doc-1', { enabled });
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent enabled={false} />
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('data')).toHaveTextContent('null');
    });

    // observeById should not be called when disabled
    expect(mockCollection.observeById).not.toHaveBeenCalled();
  });

  it('should handle observable error', async () => {
    const TestComponent = () => {
      const { isLoading, data, error } = useDocument<TestDoc>('test-collection', 'doc-1');
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    // Emit error via observable
    act(() => {
      mockCollection._documentSubject.error(new Error('Document not found'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('Document not found');
    });
  });

  it('should call refresh function', async () => {
    mockCollection.get.mockResolvedValue({ _id: 'doc-1', title: 'Refreshed', count: 1 });

    const TestComponent = () => {
      const { data, refresh } = useDocument<TestDoc>('test-collection', 'doc-1');
      return (
        <div>
          <span data-testid="data">{data ? data.title : 'null'}</span>
          <button data-testid="refresh" onClick={refresh}>
            Refresh
          </button>
        </div>
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
      expect(mockCollection.get).toHaveBeenCalledWith('doc-1');
    });
  });
});

describe('useFindOne', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockCollection = createMockCollection();
    mockDatabase = createMockDatabase(mockCollection);
    vi.clearAllMocks();
  });

  it('should find document by filter', async () => {
    mockCollection.findOne = vi.fn().mockResolvedValue({ _id: 'doc-1', title: 'Found', count: 10 });

    const TestComponent = () => {
      const { isLoading, data } = useFindOne<TestDoc>('test-collection', { title: 'Found' });
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
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
      expect(screen.getByTestId('data')).toHaveTextContent('Found');
    });

    expect(mockCollection.findOne).toHaveBeenCalledWith({ title: 'Found' });
  });

  it('should respect enabled option', async () => {
    const TestComponent = () => {
      const { isLoading, data } = useFindOne<TestDoc>('test-collection', { title: 'Test' }, { enabled: false });
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="data">{data ? data.title : 'null'}</span>
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

    expect(mockCollection.findOne).not.toHaveBeenCalled();
  });

  it('should re-query when collection changes', async () => {
    mockCollection.findOne = vi.fn().mockResolvedValue({ _id: 'doc-1', title: 'Initial', count: 1 });

    const TestComponent = () => {
      const { data } = useFindOne<TestDoc>('test-collection', { title: 'Initial' });
      return <span data-testid="data">{data ? data.title : 'null'}</span>;
    };

    render(
      <PocketProvider database={mockDatabase}>
        <TestComponent />
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toHaveTextContent('Initial');
    });

    // Simulate collection change
    mockCollection.findOne.mockResolvedValue({ _id: 'doc-1', title: 'Updated', count: 2 });

    act(() => {
      mockCollection._changesSubject.next({});
    });

    await waitFor(() => {
      expect(mockCollection.findOne).toHaveBeenCalledTimes(2); // Initial + 1 change event
    });
  });
});

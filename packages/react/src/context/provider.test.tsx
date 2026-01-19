import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PocketProvider, usePocketContext, useDatabase } from './provider.js';
import type { Database } from '@pocket/core';

// Mock database
const createMockDatabase = (): Database => ({
  name: 'test-db',
  collection: vi.fn().mockReturnValue({
    name: 'test-collection',
    get: vi.fn(),
    find: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    changes: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    observeById: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  }),
  close: vi.fn(),
  isOpen: true,
} as unknown as Database);

describe('PocketProvider', () => {
  it('should render children when database is ready', () => {
    const db = createMockDatabase();

    render(
      <PocketProvider database={db}>
        <div data-testid="child">Child Content</div>
      </PocketProvider>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('should show loading state while database promise is pending', () => {
    const dbPromise = new Promise<Database>(() => {
      // Never resolves
    });

    render(
      <PocketProvider database={dbPromise} loading={<div data-testid="loading">Loading...</div>}>
        <div data-testid="child">Child Content</div>
      </PocketProvider>
    );

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('should render children when database promise resolves', async () => {
    const db = createMockDatabase();
    const dbPromise = Promise.resolve(db);

    render(
      <PocketProvider database={dbPromise} loading={<div data-testid="loading">Loading...</div>}>
        <div data-testid="child">Child Content</div>
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
  });

  it('should show error component when database promise rejects', async () => {
    const error = new Error('Database init failed');
    const dbPromise = Promise.reject(error);

    render(
      <PocketProvider
        database={dbPromise}
        loading={<div data-testid="loading">Loading...</div>}
        errorComponent={(err) => <div data-testid="error">{err.message}</div>}
      >
        <div data-testid="child">Child Content</div>
      </PocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Database init failed');
    });
  });
});

describe('usePocketContext', () => {
  it('should throw when used outside provider', () => {
    const TestComponent = () => {
      try {
        usePocketContext();
        return <div>No error</div>;
      } catch (e) {
        return <div data-testid="error">{(e as Error).message}</div>;
      }
    };

    render(<TestComponent />);

    expect(screen.getByTestId('error')).toHaveTextContent(
      'usePocketContext must be used within a PocketProvider'
    );
  });

  it('should return context when used inside provider', () => {
    const db = createMockDatabase();

    const TestComponent = () => {
      const context = usePocketContext();
      return <div data-testid="ready">{String(context.isReady)}</div>;
    };

    render(
      <PocketProvider database={db}>
        <TestComponent />
      </PocketProvider>
    );

    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });
});

describe('useDatabase', () => {
  it('should return the database instance', () => {
    const db = createMockDatabase();

    const TestComponent = () => {
      const database = useDatabase();
      return <div data-testid="name">{database.name}</div>;
    };

    render(
      <PocketProvider database={db}>
        <TestComponent />
      </PocketProvider>
    );

    expect(screen.getByTestId('name')).toHaveTextContent('test-db');
  });
});

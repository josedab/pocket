/**
 * Tests for the PocketProvider context and hooks.
 *
 * Strategy: Mock solid-js createContext/useContext to control what the
 * hooks see, then test usePocketContext, useDatabase, useCollection, and
 * usePocketReady independently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state                                              */
/* ------------------------------------------------------------------ */
const { contextValue, mountFns } = vi.hoisted(() => ({
  contextValue: { current: undefined as unknown },
  mountFns: [] as (() => void)[],
}));

/* ------------------------------------------------------------------ */
/*  Mock solid-js                                                     */
/* ------------------------------------------------------------------ */
vi.mock('solid-js', () => ({
  createContext: () => Symbol('PocketContext'),
  useContext: () => contextValue.current,
  createSignal: <T>(initial: T): [() => T, (v: T | ((p: T) => T)) => void] => {
    let value = initial;
    return [
      () => value,
      (v: unknown) => {
        value = typeof v === 'function' ? (v as (p: T) => T)(value) : (v as T);
      },
    ];
  },
  onMount: (fn: () => void) => {
    mountFns.push(fn);
  },
}));

/* ------------------------------------------------------------------ */
/*  Import under test                                                 */
/* ------------------------------------------------------------------ */
import {
  useCollection,
  useDatabase,
  usePocketContext,
  usePocketReady,
} from '../context/provider.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
function createMockDatabase() {
  const mockColl = {
    find: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return {
    db: {
      collection: vi.fn().mockReturnValue(mockColl),
    },
    collection: mockColl,
  };
}

/* ================================================================== */
/*  usePocketContext                                                   */
/* ================================================================== */
describe('usePocketContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextValue.current = undefined;
    mountFns.length = 0;
  });

  it('should throw when used outside PocketProvider', () => {
    contextValue.current = undefined;

    expect(() => usePocketContext()).toThrow(
      'usePocketContext must be used within a PocketProvider'
    );
  });

  it('should return context value when inside PocketProvider', () => {
    const ctx = {
      database: () => ({}),
      isReady: () => true,
      error: () => null,
    };
    contextValue.current = ctx;

    expect(usePocketContext()).toBe(ctx);
  });
});

/* ================================================================== */
/*  useDatabase                                                       */
/* ================================================================== */
describe('useDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextValue.current = undefined;
    mountFns.length = 0;
  });

  it('should return the database when ready', () => {
    const { db } = createMockDatabase();
    contextValue.current = {
      database: () => db,
      isReady: () => true,
      error: () => null,
    };

    expect(useDatabase()).toBe(db);
  });

  it('should throw when database is not ready', () => {
    contextValue.current = {
      database: () => null,
      isReady: () => false,
      error: () => null,
    };

    expect(() => useDatabase()).toThrow('Database is not ready');
  });

  it('should throw when database is null even if isReady is true', () => {
    contextValue.current = {
      database: () => null,
      isReady: () => true,
      error: () => null,
    };

    expect(() => useDatabase()).toThrow('Database is not ready');
  });

  it('should throw when context is missing', () => {
    contextValue.current = undefined;

    expect(() => useDatabase()).toThrow('usePocketContext must be used within a PocketProvider');
  });
});

/* ================================================================== */
/*  useCollection                                                     */
/* ================================================================== */
describe('useCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextValue.current = undefined;
    mountFns.length = 0;
  });

  it('should return collection from database', () => {
    const { db, collection: mockColl } = createMockDatabase();
    contextValue.current = {
      database: () => db,
      isReady: () => true,
      error: () => null,
    };

    const result = useCollection('todos');

    expect(db.collection).toHaveBeenCalledWith('todos');
    expect(result).toBe(mockColl);
  });

  it('should call database.collection with the correct name', () => {
    const { db } = createMockDatabase();
    contextValue.current = {
      database: () => db,
      isReady: () => true,
      error: () => null,
    };

    useCollection('users');
    expect(db.collection).toHaveBeenCalledWith('users');

    useCollection('products');
    expect(db.collection).toHaveBeenCalledWith('products');
  });

  it('should throw when database is not available', () => {
    contextValue.current = {
      database: () => null,
      isReady: () => false,
      error: () => null,
    };

    expect(() => useCollection('todos')).toThrow('Database is not ready');
  });
});

/* ================================================================== */
/*  usePocketReady                                                    */
/* ================================================================== */
describe('usePocketReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextValue.current = undefined;
    mountFns.length = 0;
  });

  it('should return isReady and error accessors', () => {
    const isReady = () => true;
    const error = () => null;
    contextValue.current = {
      database: () => ({}),
      isReady,
      error,
    };

    const result = usePocketReady();

    expect(result.isReady).toBe(isReady);
    expect(result.error).toBe(error);
  });

  it('should reflect ready state', () => {
    contextValue.current = {
      database: () => ({}),
      isReady: () => true,
      error: () => null,
    };

    const { isReady } = usePocketReady();
    expect(isReady()).toBe(true);
  });

  it('should reflect error state', () => {
    const err = new Error('init failed');
    contextValue.current = {
      database: () => null,
      isReady: () => false,
      error: () => err,
    };

    const { error } = usePocketReady();
    expect(error()).toBe(err);
  });

  it('should throw when used outside PocketProvider', () => {
    contextValue.current = undefined;

    expect(() => usePocketReady()).toThrow('usePocketContext must be used within a PocketProvider');
  });
});

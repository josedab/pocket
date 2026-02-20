import { describe, it, expect, beforeEach } from 'vitest';
import {
  PocketProvider,
  usePocketContext,
  useDatabase,
  useCollection,
  useLiveQuery,
  useQuery,
  useDocument,
  useFindOne,
  useMutation,
  useOptimisticMutation,
  useSuspenseQuery,
  usePrefetchQuery,
  useInvalidateQuery,
  clearSuspenseCache,
  useSyncStatus,
  useOnlineStatus,
  useCollaborators,
  useCursors,
  useTypingIndicator,
  useUndoRedo,
} from '../index.js';

describe('React hooks - function signatures', () => {
  describe('PocketProvider', () => {
    it('should be a function', () => {
      expect(typeof PocketProvider).toBe('function');
    });

    it('should have a non-zero length (accepts props)', () => {
      expect(PocketProvider.length).toBeGreaterThan(0);
    });
  });

  describe('Context hooks', () => {
    it('usePocketContext is a function', () => {
      expect(typeof usePocketContext).toBe('function');
    });

    it('useDatabase is a function', () => {
      expect(typeof useDatabase).toBe('function');
    });

    it('useCollection is a function with 1 parameter', () => {
      expect(typeof useCollection).toBe('function');
      expect(useCollection.length).toBe(1);
    });
  });

  describe('Query hooks', () => {
    it('useLiveQuery accepts collectionName as first argument', () => {
      expect(typeof useLiveQuery).toBe('function');
      expect(useLiveQuery.length).toBeGreaterThanOrEqual(1);
    });

    it('useQuery accepts collectionName as first argument', () => {
      expect(typeof useQuery).toBe('function');
      expect(useQuery.length).toBeGreaterThanOrEqual(1);
    });

    it('useDocument accepts collectionName and documentId', () => {
      expect(typeof useDocument).toBe('function');
      expect(useDocument.length).toBeGreaterThanOrEqual(2);
    });

    it('useFindOne accepts collectionName and filter', () => {
      expect(typeof useFindOne).toBe('function');
      expect(useFindOne.length).toBeGreaterThanOrEqual(2);
    });

    it('useSuspenseQuery accepts collectionName', () => {
      expect(typeof useSuspenseQuery).toBe('function');
      expect(useSuspenseQuery.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Mutation hooks', () => {
    it('useMutation accepts collectionName', () => {
      expect(typeof useMutation).toBe('function');
      expect(useMutation.length).toBeGreaterThanOrEqual(1);
    });

    it('useOptimisticMutation accepts collectionName', () => {
      expect(typeof useOptimisticMutation).toBe('function');
      expect(useOptimisticMutation.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Sync hooks', () => {
    it('useSyncStatus accepts syncEngine', () => {
      expect(typeof useSyncStatus).toBe('function');
      expect(useSyncStatus.length).toBeGreaterThanOrEqual(1);
    });

    it('useOnlineStatus takes no required arguments', () => {
      expect(typeof useOnlineStatus).toBe('function');
    });
  });

  describe('Collaboration hooks', () => {
    it('useCollaborators is a function', () => {
      expect(typeof useCollaborators).toBe('function');
    });

    it('useCursors accepts collection name', () => {
      expect(typeof useCursors).toBe('function');
      expect(useCursors.length).toBeGreaterThanOrEqual(1);
    });

    it('useTypingIndicator accepts collection name', () => {
      expect(typeof useTypingIndicator).toBe('function');
      expect(useTypingIndicator.length).toBeGreaterThanOrEqual(1);
    });

    it('useUndoRedo is a function', () => {
      expect(typeof useUndoRedo).toBe('function');
    });
  });
});

describe('clearSuspenseCache', () => {
  beforeEach(() => {
    clearSuspenseCache();
  });

  it('should be callable with no arguments', () => {
    expect(() => clearSuspenseCache()).not.toThrow();
  });

  it('should be callable with a specific key', () => {
    expect(() => clearSuspenseCache('users:[]')).not.toThrow();
  });

  it('should be callable multiple times without error', () => {
    clearSuspenseCache();
    clearSuspenseCache('key1');
    clearSuspenseCache('key2');
    clearSuspenseCache();
    expect(true).toBe(true);
  });

  it('should handle clearing non-existent keys gracefully', () => {
    expect(() => clearSuspenseCache('nonexistent:key')).not.toThrow();
  });
});

describe('Hooks are distinct functions', () => {
  it('all exported hooks are unique references', () => {
    const hooks = [
      usePocketContext,
      useDatabase,
      useCollection,
      useLiveQuery,
      useQuery,
      useDocument,
      useFindOne,
      useMutation,
      useOptimisticMutation,
      useSuspenseQuery,
      usePrefetchQuery,
      useInvalidateQuery,
      useSyncStatus,
      useOnlineStatus,
      useCollaborators,
      useCursors,
      useTypingIndicator,
      useUndoRedo,
    ];

    const uniqueHooks = new Set(hooks);
    expect(uniqueHooks.size).toBe(hooks.length);
  });
});

describe('Module re-exports are consistent', () => {
  it('hooks/index re-exports match top-level exports', async () => {
    const topLevel = await import('../index.js');
    const hooks = await import('../hooks/index.js');

    // Every hook export should be in the top-level module
    for (const key of Object.keys(hooks)) {
      expect(topLevel).toHaveProperty(key);
      expect((topLevel as Record<string, unknown>)[key]).toBe(
        (hooks as Record<string, unknown>)[key]
      );
    }
  });

  it('context/provider exports are included in top-level', async () => {
    const topLevel = await import('../index.js');
    const provider = await import('../context/provider.js');

    for (const key of Object.keys(provider)) {
      expect(topLevel).toHaveProperty(key);
      expect((topLevel as Record<string, unknown>)[key]).toBe(
        (provider as Record<string, unknown>)[key]
      );
    }
  });
});

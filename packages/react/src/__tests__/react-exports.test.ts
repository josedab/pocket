import { describe, it, expect } from 'vitest';

describe('@pocket/react', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export PocketProvider component', async () => {
    const mod = await import('../index.js');
    expect(mod.PocketProvider).toBeDefined();
    expect(typeof mod.PocketProvider).toBe('function');
  });

  it('should export context hooks', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.usePocketContext).toBe('function');
    expect(typeof mod.useDatabase).toBe('function');
    expect(typeof mod.useCollection).toBe('function');
  });

  it('should export query hooks', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.useLiveQuery).toBe('function');
    expect(typeof mod.useQuery).toBe('function');
    expect(typeof mod.useDocument).toBe('function');
    expect(typeof mod.useFindOne).toBe('function');
    expect(typeof mod.useSuspenseQuery).toBe('function');
  });

  it('should export mutation hooks', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.useMutation).toBe('function');
    expect(typeof mod.useOptimisticMutation).toBe('function');
  });

  it('should export sync and status hooks', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.useSyncStatus).toBe('function');
    expect(typeof mod.useOnlineStatus).toBe('function');
  });

  it('should export collaboration hooks', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.useCollaborators).toBe('function');
    expect(typeof mod.useCursors).toBe('function');
    expect(typeof mod.useTypingIndicator).toBe('function');
    expect(typeof mod.useUndoRedo).toBe('function');
  });

  it('should export suspense cache utilities', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.clearSuspenseCache).toBe('function');
    expect(typeof mod.usePrefetchQuery).toBe('function');
    expect(typeof mod.useInvalidateQuery).toBe('function');
  });
});

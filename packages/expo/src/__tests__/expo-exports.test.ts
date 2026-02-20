import { describe, it, expect } from 'vitest';

describe('@pocket/expo', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export createExpoSQLiteStorage factory function', async () => {
    const { createExpoSQLiteStorage } = await import('../index.js');
    expect(createExpoSQLiteStorage).toBeDefined();
    expect(typeof createExpoSQLiteStorage).toBe('function');
  });

  it('should export createExpoFileSystemStorage factory function', async () => {
    const { createExpoFileSystemStorage } = await import('../index.js');
    expect(createExpoFileSystemStorage).toBeDefined();
    expect(typeof createExpoFileSystemStorage).toBe('function');
  });

  it('should create an Expo SQLite storage adapter with default config', async () => {
    const { createExpoSQLiteStorage } = await import('../index.js');
    const adapter = createExpoSQLiteStorage();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('expo-sqlite');
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.close).toBe('function');
    expect(typeof adapter.getStore).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('should create an Expo FileSystem storage adapter with default config', async () => {
    const { createExpoFileSystemStorage } = await import('../index.js');
    const adapter = createExpoFileSystemStorage();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('expo-filesystem');
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.close).toBe('function');
    expect(typeof adapter.getStore).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('should re-export React hooks from @pocket/react', async () => {
    const mod = await import('../index.js');
    const expectedHooks = [
      'PocketProvider',
      'useCollection',
      'useDatabase',
      'useDocument',
      'useFindOne',
      'useLiveQuery',
      'useMutation',
      'useOptimisticMutation',
      'usePocketContext',
      'useQuery',
      'useSyncStatus',
    ];

    for (const hookName of expectedHooks) {
      expect(mod).toHaveProperty(hookName);
    }
  });
});

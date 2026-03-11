import { describe, expect, it } from 'vitest';

describe('@pocket/tauri storage adapter', () => {
  it('should create adapter via factory with no args', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('tauri-sqlite');
  });

  it('should implement full StorageAdapter interface', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.close).toBe('function');
    expect(typeof adapter.getStore).toBe('function');
    expect(typeof adapter.hasStore).toBe('function');
    expect(typeof adapter.listStores).toBe('function');
    expect(typeof adapter.deleteStore).toBe('function');
    expect(typeof adapter.transaction).toBe('function');
    expect(typeof adapter.getStats).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('should return false for isAvailable in Node.js environment', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(adapter.isAvailable()).toBe(false);
  });

  it('should throw when getStore called before initialize', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(() => adapter.getStore('test')).toThrow('Database not initialized');
  });

  it('should return false for hasStore before any store created', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(adapter.hasStore('nonexistent')).toBe(false);
  });

  it('should return empty list from listStores when not initialized', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    const stores = await adapter.listStores();
    expect(stores).toEqual([]);
  });

  it('should accept custom path configuration', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage({ path: 'sqlite:custom-path.db' });
    expect(adapter.name).toBe('tauri-sqlite');
  });

  it('should not throw when deleteStore called before initialize', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    await expect(adapter.deleteStore('test')).resolves.toBeUndefined();
  });
});

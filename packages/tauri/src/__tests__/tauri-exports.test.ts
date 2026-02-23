import { describe, it, expect } from 'vitest';

describe('@pocket/tauri', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export createTauriSQLiteStorage factory function', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    expect(createTauriSQLiteStorage).toBeDefined();
    expect(typeof createTauriSQLiteStorage).toBe('function');
  });

  it('should create a Tauri SQLite storage adapter with default config', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('tauri-sqlite');
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.close).toBe('function');
    expect(typeof adapter.getStore).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('should create a Tauri SQLite storage adapter with custom config', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage({ path: 'sqlite:custom.db' });
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('tauri-sqlite');
  });

  it('should report isAvailable as false outside Tauri environment', async () => {
    const { createTauriSQLiteStorage } = await import('../index.js');
    const adapter = createTauriSQLiteStorage();
    // In Node.js test environment, Tauri APIs are not available
    expect(adapter.isAvailable()).toBe(false);
  });
});

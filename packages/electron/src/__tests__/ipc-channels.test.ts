import { describe, expect, it } from 'vitest';

describe('@pocket/electron IPC channels', () => {
  it('should have unique channel values (no duplicates)', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    const values = Object.values(IPC_CHANNELS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should have consistent naming convention (pocket:operation)', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      expect(value).toMatch(/^pocket:[a-zA-Z]+$/);
      expect(key).toBe(key.toUpperCase());
    }
  });

  it('should export all CRUD operation channels', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    expect(IPC_CHANNELS.GET).toBe('pocket:get');
    expect(IPC_CHANNELS.PUT).toBe('pocket:put');
    expect(IPC_CHANNELS.DELETE).toBe('pocket:delete');
    expect(IPC_CHANNELS.QUERY).toBe('pocket:query');
    expect(IPC_CHANNELS.COUNT).toBe('pocket:count');
  });

  it('should export bulk operation channels', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    expect(IPC_CHANNELS.GET_MANY).toBeDefined();
    expect(IPC_CHANNELS.GET_ALL).toBeDefined();
    expect(IPC_CHANNELS.BULK_PUT).toBeDefined();
    expect(IPC_CHANNELS.BULK_DELETE).toBeDefined();
  });

  it('should export lifecycle channels', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    expect(IPC_CHANNELS.INIT).toBe('pocket:init');
    expect(IPC_CHANNELS.CLOSE).toBe('pocket:close');
  });

  it('should export subscription channels', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    expect(IPC_CHANNELS.SUBSCRIBE).toBe('pocket:subscribe');
    expect(IPC_CHANNELS.UNSUBSCRIBE).toBe('pocket:unsubscribe');
  });
});

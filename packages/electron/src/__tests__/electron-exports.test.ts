import { describe, it, expect } from 'vitest';

describe('@pocket/electron', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export IPC_CHANNELS with all required channel names', async () => {
    const { IPC_CHANNELS } = await import('../index.js');
    expect(IPC_CHANNELS).toBeDefined();
    expect(typeof IPC_CHANNELS).toBe('object');

    const expectedChannels = [
      'INIT',
      'CLOSE',
      'GET',
      'GET_MANY',
      'GET_ALL',
      'PUT',
      'BULK_PUT',
      'DELETE',
      'BULK_DELETE',
      'QUERY',
      'COUNT',
      'CLEAR',
      'LIST_COLLECTIONS',
      'SUBSCRIBE',
      'UNSUBSCRIBE',
    ];

    for (const channel of expectedChannels) {
      expect(IPC_CHANNELS).toHaveProperty(channel);
      expect(typeof IPC_CHANNELS[channel as keyof typeof IPC_CHANNELS]).toBe('string');
    }
  });

  it('should have IPC_CHANNELS values prefixed with "pocket:"', async () => {
    const { IPC_CHANNELS } = await import('../index.js');

    for (const value of Object.values(IPC_CHANNELS)) {
      expect(value).toMatch(/^pocket:/);
    }
  });
});

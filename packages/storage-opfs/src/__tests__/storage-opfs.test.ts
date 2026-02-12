import { describe, it, expect } from 'vitest';

describe('@pocket/storage-opfs', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});

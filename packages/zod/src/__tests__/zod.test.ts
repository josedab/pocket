import { describe, it, expect } from 'vitest';

describe('@pocket/zod', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export Schema from core', async () => {
    const mod = await import('../index.js');
    expect(mod.Schema).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';

describe('@pocket/forms', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export FormManager', async () => {
    const mod = await import('../index.js');
    expect(mod.FormManager).toBeDefined();
    expect(mod.createFormManager).toBeDefined();
  });

  it('should re-export zod', async () => {
    const mod = await import('../index.js');
    expect(mod.z).toBeDefined();
  });
});

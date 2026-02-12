import { describe, it, expect } from 'vitest';

describe('@pocket/permissions', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export PermissionManager', async () => {
    const mod = await import('../index.js');
    expect(mod.PermissionManager).toBeDefined();
    expect(mod.createPermissionManager).toBeDefined();
  });

  it('should export PermissionEvaluator', async () => {
    const mod = await import('../index.js');
    expect(mod.PermissionEvaluator).toBeDefined();
    expect(mod.createPermissionEvaluator).toBeDefined();
  });
});

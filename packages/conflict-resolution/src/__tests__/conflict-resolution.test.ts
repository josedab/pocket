import { describe, it, expect } from 'vitest';

describe('@pocket/conflict-resolution', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export ConflictAnalyzer', async () => {
    const mod = await import('../index.js');
    expect(mod.ConflictAnalyzer).toBeDefined();
    expect(mod.createConflictAnalyzer).toBeDefined();
  });

  it('should export ConflictManager', async () => {
    const mod = await import('../index.js');
    expect(mod.ConflictManager).toBeDefined();
    expect(mod.createConflictManager).toBeDefined();
  });

  it('should export DEFAULT_CONFLICT_CONFIG', async () => {
    const mod = await import('../index.js');
    expect(mod.DEFAULT_CONFLICT_CONFIG).toBeDefined();
  });
});

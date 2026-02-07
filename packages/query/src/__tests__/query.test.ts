import { describe, it, expect } from 'vitest';

describe('@pocket/query', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should export QueryBuilder utilities', async () => {
    const mod = await import('../index.js');
    expect(mod.QueryBuilder).toBeDefined();
    expect(mod.query).toBeDefined();
    expect(mod.parseQuery).toBeDefined();
    expect(mod.serializeQuery).toBeDefined();
    expect(mod.hashQuery).toBeDefined();
  });

  it('should export QueryExecutor', async () => {
    const mod = await import('../index.js');
    expect(mod.QueryExecutor).toBeDefined();
    expect(mod.createQueryExecutor).toBeDefined();
    expect(mod.executeQuery).toBeDefined();
  });
});

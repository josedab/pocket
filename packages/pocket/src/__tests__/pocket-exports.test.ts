import { describe, it, expect } from 'vitest';

describe('pocket umbrella package', () => {
  it('should export public API', async () => {
    const mod = await import('../index.js');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('should have no undefined exports', async () => {
    const mod = await import('../index.js');
    const undefinedExports = Object.entries(mod).filter(
      ([, value]) => value === undefined,
    );
    expect(undefinedExports).toEqual([]);
  });

  describe('core database APIs', () => {
    it('should re-export Database and createDatabase', async () => {
      const mod = await import('../index.js');
      expect(mod.Database).toBeDefined();
      expect(mod.createDatabase).toBeDefined();
    });

    it('should re-export Collection', async () => {
      const mod = await import('../index.js');
      expect(mod.Collection).toBeDefined();
    });

    it('should re-export query utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.QueryBuilder).toBeDefined();
      expect(mod.QueryExecutor).toBeDefined();
      expect(mod.QueryPlanner).toBeDefined();
      expect(mod.createQueryBuilder).toBeDefined();
    });

    it('should re-export reactive utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.LiveQuery).toBeDefined();
      expect(mod.createLiveQuery).toBeDefined();
      expect(mod.ObservableValue).toBeDefined();
      expect(mod.ObservableAsync).toBeDefined();
    });

    it('should re-export document utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.prepareNewDocument).toBeDefined();
      expect(mod.prepareDocumentUpdate).toBeDefined();
      expect(mod.prepareSoftDelete).toBeDefined();
      expect(mod.cloneDocument).toBeDefined();
      expect(mod.documentsEqual).toBeDefined();
    });

    it('should re-export schema utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.Schema).toBeDefined();
      expect(mod.ValidationError).toBeDefined();
    });

    it('should re-export clock utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.HybridLogicalClock).toBeDefined();
      expect(mod.LamportClock).toBeDefined();
      expect(mod.VectorClockUtil).toBeDefined();
    });

    it('should re-export query operators', async () => {
      const mod = await import('../index.js');
      expect(mod.matchesCondition).toBeDefined();
      expect(mod.matchesFilter).toBeDefined();
    });

    it('should re-export change feed utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.ChangeFeed).toBeDefined();
      expect(mod.GlobalChangeFeed).toBeDefined();
    });

    it('should re-export general utilities', async () => {
      const mod = await import('../index.js');
      expect(mod.generateId).toBeDefined();
      expect(mod.generateRevision).toBeDefined();
      expect(mod.debounce).toBeDefined();
      expect(mod.throttle).toBeDefined();
      expect(mod.isEqual).toBeDefined();
      expect(mod.createDeferred).toBeDefined();
    });
  });

  describe('storage adapters', () => {
    it('should re-export IndexedDB storage', async () => {
      const mod = await import('../index.js');
      expect(mod.IndexedDBAdapter).toBeDefined();
      expect(mod.createIndexedDBStorage).toBeDefined();
    });

    it('should re-export memory storage', async () => {
      const mod = await import('../index.js');
      expect(mod.MemoryStorageAdapter).toBeDefined();
      expect(mod.createMemoryStorage).toBeDefined();
    });

    it('should re-export OPFS storage', async () => {
      const mod = await import('../index.js');
      expect(mod.OPFSAdapter).toBeDefined();
      expect(mod.createOPFSStorage).toBeDefined();
      expect(mod.WriteAheadLog).toBeDefined();
      expect(mod.createWAL).toBeDefined();
    });
  });
});

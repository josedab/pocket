import { describe, expect, it } from 'vitest';

describe('@pocket/svelte', () => {
  describe('module exports — context', () => {
    it('should export context provider functions', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.setPocketContext).toBe('function');
      expect(typeof mod.getPocketContext).toBe('function');
      expect(typeof mod.getDatabase).toBe('function');
      expect(typeof mod.getCollection).toBe('function');
      expect(typeof mod.getDatabaseStore).toBe('function');
      expect(typeof mod.getReadyStore).toBe('function');
      expect(typeof mod.getErrorStore).toBe('function');
    });
  });

  describe('module exports — stores', () => {
    it('should export createLiveQuery store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createLiveQuery).toBe('function');
    });

    it('should export createQuery store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createQuery).toBe('function');
    });

    it('should export createDocument store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createDocument).toBe('function');
    });

    it('should export createMutation store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createMutation).toBe('function');
    });

    it('should export createSyncStatus store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createSyncStatus).toBe('function');
    });

    it('should export createOnlineStatus store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createOnlineStatus).toBe('function');
    });

    it('should export createFindOne store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createFindOne).toBe('function');
    });

    it('should export createReactiveQuery store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createReactiveQuery).toBe('function');
    });

    it('should export createReactiveDocument store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createReactiveDocument).toBe('function');
    });

    it('should export createOptimisticMutation store creator', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createOptimisticMutation).toBe('function');
    });

    it('should export all expected functions and types', async () => {
      const mod = await import('../index.js');
      const exportKeys = Object.keys(mod);
      expect(exportKeys.length).toBeGreaterThan(10);
      for (const key of exportKeys) {
        expect(mod[key as keyof typeof mod]).toBeDefined();
      }
    });
  });
});

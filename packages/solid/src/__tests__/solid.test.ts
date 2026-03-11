import { describe, expect, it } from 'vitest';

describe('@pocket/solid', () => {
  describe('module exports — context', () => {
    it('should export PocketProvider component', async () => {
      const mod = await import('../index.js');
      expect(mod.PocketProvider).toBeDefined();
      expect(typeof mod.PocketProvider).toBe('function');
    });

    it('should export context hooks', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useDatabase).toBe('function');
      expect(typeof mod.useCollection).toBe('function');
      expect(typeof mod.usePocketContext).toBe('function');
      expect(typeof mod.usePocketReady).toBe('function');
    });
  });

  describe('module exports — primitives', () => {
    it('should export createLiveQuery primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createLiveQuery).toBe('function');
    });

    it('should export createQuery primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createQuery).toBe('function');
    });

    it('should export createDocument primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createDocument).toBe('function');
    });

    it('should export createMutation primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createMutation).toBe('function');
    });

    it('should export createSyncStatus primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createSyncStatus).toBe('function');
    });

    it('should export createOnlineStatus primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createOnlineStatus).toBe('function');
    });

    it('should export createFindOne primitive', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.createFindOne).toBe('function');
    });

    it('should export createOptimisticMutation primitive', async () => {
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

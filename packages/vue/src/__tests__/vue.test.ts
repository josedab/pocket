import { describe, expect, it } from 'vitest';

describe('@pocket/vue', () => {
  describe('module exports', () => {
    it('should export context and provider functions', async () => {
      const mod = await import('../index.js');
      expect(mod.PocketKey).toBeDefined();
      expect(typeof mod.providePocket).toBe('function');
      expect(typeof mod.useDatabase).toBe('function');
      expect(typeof mod.useCollection).toBe('function');
      expect(typeof mod.usePocketContext).toBe('function');
      expect(typeof mod.usePocketReady).toBe('function');
      expect(typeof mod.createPocketPlugin).toBe('function');
    });

    it('should export live query composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useLiveQuery).toBe('function');
    });

    it('should export query composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useQuery).toBe('function');
    });

    it('should export document composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useDocument).toBe('function');
    });

    it('should export mutation composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useMutation).toBe('function');
    });

    it('should export sync status composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useSyncStatus).toBe('function');
    });

    it('should export online status composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useOnlineStatus).toBe('function');
    });

    it('should export findOne composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useFindOne).toBe('function');
    });

    it('should export optimistic mutation composable', async () => {
      const mod = await import('../index.js');
      expect(typeof mod.useOptimisticMutation).toBe('function');
    });

    it('should export all expected composables and types', async () => {
      const mod = await import('../index.js');
      const exportKeys = Object.keys(mod);
      // Should have context exports + composable exports
      expect(exportKeys.length).toBeGreaterThan(10);
      // Verify no undefined exports
      for (const key of exportKeys) {
        expect(mod[key as keyof typeof mod]).toBeDefined();
      }
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExpoPlugin, createExpoPlugin } from '../expo-plugin.js';

describe('ExpoPlugin', () => {
  let plugin: ExpoPlugin;

  beforeEach(() => {
    plugin = createExpoPlugin({
      databaseName: 'test-db',
      storage: 'sqlite',
      backgroundSync: false, // disable to avoid timers in tests
      pushSyncEnabled: true,
    });
  });

  afterEach(() => {
    plugin.dispose();
  });

  describe('initialization', () => {
    it('should initialize with default config', async () => {
      const state = await plugin.initialize();
      expect(state.initialized).toBe(true);
      expect(state.databaseName).toBe('test-db');
      expect(state.storage).toBe('sqlite');
    });

    it('should use defaults when no config provided', () => {
      const defaultPlugin = createExpoPlugin();
      expect(defaultPlugin.config.databaseName).toBe('pocket-app');
      expect(defaultPlugin.config.storage).toBe('sqlite');
      expect(defaultPlugin.config.backgroundSync).toBe(true);
      defaultPlugin.dispose();
    });

    it('should not re-initialize', async () => {
      await plugin.initialize();
      const state = await plugin.initialize();
      expect(state.initialized).toBe(true);
    });
  });

  describe('offline queue', () => {
    it('should enqueue operations', () => {
      const success = plugin.enqueue({
        collection: 'todos',
        operation: 'insert',
        data: { title: 'Test' },
      });
      expect(success).toBe(true);
      expect(plugin.getOfflineQueue()).toHaveLength(1);
    });

    it('should respect max queue size', () => {
      const small = createExpoPlugin({ maxQueueSize: 2 });
      small.enqueue({ collection: 'a', operation: 'insert', data: {} });
      small.enqueue({ collection: 'b', operation: 'insert', data: {} });
      const result = small.enqueue({ collection: 'c', operation: 'insert', data: {} });
      expect(result).toBe(false);
      expect(small.getOfflineQueue()).toHaveLength(2);
      small.dispose();
    });

    it('should process and flush queue', () => {
      plugin.enqueue({ collection: 'todos', operation: 'insert', data: { a: 1 } });
      plugin.enqueue({ collection: 'todos', operation: 'update', data: { a: 2 } });

      const processed = plugin.processOfflineQueue();
      expect(processed).toHaveLength(2);
      expect(plugin.getOfflineQueue()).toHaveLength(0);
    });

    it('should clear queue', () => {
      plugin.enqueue({ collection: 'x', operation: 'delete', data: {} });
      plugin.clearOfflineQueue();
      expect(plugin.getOfflineQueue()).toHaveLength(0);
    });
  });

  describe('push sync', () => {
    it('should register for push sync', async () => {
      const result = await plugin.registerPushSync();
      expect(result).toBe(true);
    });

    it('should not register when disabled', async () => {
      const noSync = createExpoPlugin({ pushSyncEnabled: false });
      const result = await noSync.registerPushSync();
      expect(result).toBe(false);
      noSync.dispose();
    });

    it('should handle high priority push notifications', async () => {
      await plugin.registerPushSync();
      plugin.enqueue({ collection: 'a', operation: 'insert', data: {} });

      plugin.handlePushNotification({
        type: 'sync-required',
        timestamp: Date.now(),
        priority: 'high',
      });

      // Queue should be flushed by triggerSync
      expect(plugin.getOfflineQueue()).toHaveLength(0);
    });
  });

  describe('app state', () => {
    it('should process queue when coming to foreground', () => {
      plugin.enqueue({ collection: 'x', operation: 'insert', data: {} });
      plugin.onAppStateChange('active');
      expect(plugin.getOfflineQueue()).toHaveLength(0);
    });

    it('should track app state', () => {
      plugin.onAppStateChange('background');
      expect(plugin.getState().appState).toBe('background');
    });
  });

  describe('background sync', () => {
    it('should start and stop background sync', () => {
      plugin.startBackgroundSync();
      expect(plugin.getState().backgroundSyncActive).toBe(true);

      plugin.stopBackgroundSync();
      expect(plugin.getState().backgroundSyncActive).toBe(false);
    });
  });

  describe('expo config generation', () => {
    it('should generate expo config', () => {
      const config = plugin.toExpoConfig();
      const expo = config['expo'] as Record<string, unknown>;
      expect(expo).toBeDefined();
      expect(expo['plugins']).toBeDefined();
    });

    it('should include notification config when push enabled', () => {
      const config = plugin.toExpoConfig();
      const expo = config['expo'] as Record<string, unknown>;
      expect(expo['notification']).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('should clean up on dispose', () => {
      plugin.enqueue({ collection: 'x', operation: 'insert', data: {} });
      plugin.startBackgroundSync();
      plugin.dispose();

      expect(plugin.getState().initialized).toBe(false);
      expect(plugin.getState().backgroundSyncActive).toBe(false);
    });
  });
});

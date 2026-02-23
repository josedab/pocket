import { describe, expect, it } from 'vitest';
import { createPocketCloud } from '../zero-config-cloud.js';

describe('Zero-Config Cloud Sync', () => {
  describe('PocketCloud', () => {
    it('should require an API key', () => {
      expect(() => createPocketCloud({ apiKey: '' })).toThrow('apiKey is required');
    });

    it('should start in idle status', () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      expect(cloud.status).toBe('idle');
    });

    it('should detect test environment from API key', () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      expect(cloud.getEnvironment()).toBe('test');
    });

    it('should detect live environment from API key', () => {
      const cloud = createPocketCloud({ apiKey: 'pk_live_abc123' });
      expect(cloud.getEnvironment()).toBe('live');
    });

    it('should resolve endpoint with region', () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123', region: 'eu-west-1' });
      expect(cloud.getEndpoint()).toContain('eu-west-1');
    });

    it('should use custom endpoint when provided', () => {
      const cloud = createPocketCloud({
        apiKey: 'pk_test_abc123',
        endpoint: 'http://localhost:8080/sync',
      });
      expect(cloud.getEndpoint()).toBe('http://localhost:8080/sync');
    });

    it('should connect and reach connected status', async () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      const db = { name: 'test-db' };

      await cloud.syncDatabase(db);
      expect(cloud.status).toBe('connected');

      const stats = cloud.stats;
      expect(stats.lastSyncAt).not.toBeNull();
      expect(stats.reconnectAttempts).toBe(0);
    });

    it('should assign a session ID on successful handshake', async () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_session' });
      await cloud.syncDatabase({ name: 'test-db' });
      expect(cloud.getSessionId()).toBeTruthy();
      expect(cloud.getSessionId()).toContain('test_session_');
    });

    it('should emit status changes via observable', async () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      const statuses: string[] = [];

      cloud.status$.subscribe((s) => statuses.push(s));

      await cloud.syncDatabase({ name: 'test-db' });
      expect(statuses).toContain('connecting');
      expect(statuses).toContain('connected');
    });

    it('should disconnect gracefully', async () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      await cloud.syncDatabase({ name: 'test-db' });

      await cloud.disconnect();
      expect(cloud.status).toBe('disconnected');
    });

    it('should reject invalid API key format', async () => {
      const cloud = createPocketCloud({ apiKey: 'invalid_key' });
      await expect(cloud.syncDatabase({ name: 'test-db' })).rejects.toThrow(
        'Invalid API key format'
      );
    });

    it('should throw when used after destroy', async () => {
      const cloud = createPocketCloud({ apiKey: 'pk_test_abc123' });
      await cloud.destroy();
      await expect(cloud.syncDatabase({ name: 'test-db' })).rejects.toThrow('destroyed');
    });

    it('should track errors in stats', async () => {
      const cloud = createPocketCloud({
        apiKey: 'invalid_key',
        autoReconnect: false,
      });

      try {
        await cloud.syncDatabase({ name: 'test-db' });
      } catch {
        /* expected */
      }
      expect(cloud.stats.errors.length).toBeGreaterThan(0);
    });
  });
});

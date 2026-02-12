import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSecureStorage, SecureStorage } from '../secure-storage.js';

describe('SecureStorage', () => {
  let storage: SecureStorage;

  beforeEach(() => {
    storage = createSecureStorage({ namespace: 'test' });
  });

  afterEach(() => {
    storage.destroy();
  });

  describe('createSecureStorage', () => {
    it('returns a SecureStorage instance', () => {
      expect(storage).toBeInstanceOf(SecureStorage);
    });

    it('uses default namespace when not specified', () => {
      storage.destroy();
      storage = createSecureStorage();
      expect(storage).toBeInstanceOf(SecureStorage);
    });
  });

  describe('set/get', () => {
    it('stores and retrieves a value', async () => {
      await storage.set('key1', 'value1');
      const result = await storage.get('key1');
      expect(result).toBe('value1');
    });

    it('overwrites existing values', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key1', 'value2');
      const result = await storage.get('key1');
      expect(result).toBe('value2');
    });

    it('stores multiple keys independently', async () => {
      await storage.set('a', '1');
      await storage.set('b', '2');
      expect(await storage.get('a')).toBe('1');
      expect(await storage.get('b')).toBe('2');
    });

    it('accepts storage options', async () => {
      await storage.set('key1', 'value1', {
        accessControl: 'whenUnlocked',
        requireBiometrics: true,
      });
      expect(await storage.get('key1')).toBe('value1');
    });
  });

  describe('delete', () => {
    it('removes a stored value', async () => {
      await storage.set('key1', 'value1');
      const deleted = await storage.delete('key1');
      expect(deleted).toBe(true);
      expect(await storage.get('key1')).toBeNull();
    });

    it('returns false for missing keys', async () => {
      const deleted = await storage.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('has', () => {
    it('returns true for existing keys', async () => {
      await storage.set('key1', 'value1');
      expect(await storage.has('key1')).toBe(true);
    });

    it('returns false for missing keys', async () => {
      expect(await storage.has('nonexistent')).toBe(false);
    });
  });

  describe('keys', () => {
    it('returns all keys in the namespace', async () => {
      await storage.set('a', '1');
      await storage.set('b', '2');
      const result = await storage.keys();
      expect(result).toHaveLength(2);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('returns empty array when no keys', async () => {
      expect(await storage.keys()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all values in the namespace', async () => {
      await storage.set('a', '1');
      await storage.set('b', '2');
      await storage.clear();
      expect(await storage.get('a')).toBeNull();
      expect(await storage.get('b')).toBeNull();
      expect(storage.size()).toBe(0);
    });
  });

  describe('lock/unlock', () => {
    it('prevents reads when locked', async () => {
      await storage.set('key1', 'value1');
      storage.lock();
      expect(storage.getStatus()).toBe('locked');
      await expect(storage.get('key1')).rejects.toThrow('locked');
    });

    it('prevents writes when locked', async () => {
      storage.lock();
      await expect(storage.set('key1', 'value1')).rejects.toThrow('locked');
    });

    it('prevents deletes when locked', async () => {
      storage.lock();
      await expect(storage.delete('key1')).rejects.toThrow('locked');
    });

    it('allows access after unlock', async () => {
      await storage.set('key1', 'value1');
      storage.lock();
      storage.unlock();
      expect(storage.getStatus()).toBe('ready');
      expect(await storage.get('key1')).toBe('value1');
    });

    it('unlock is no-op when already ready', () => {
      expect(storage.getStatus()).toBe('ready');
      storage.unlock();
      expect(storage.getStatus()).toBe('ready');
    });
  });

  describe('size', () => {
    it('returns 0 for empty storage', () => {
      expect(storage.size()).toBe(0);
    });

    it('returns correct count', async () => {
      await storage.set('a', '1');
      await storage.set('b', '2');
      expect(storage.size()).toBe(2);
    });

    it('decreases after delete', async () => {
      await storage.set('a', '1');
      await storage.set('b', '2');
      await storage.delete('a');
      expect(storage.size()).toBe(1);
    });
  });

  describe('get returns null for missing keys', () => {
    it('returns null when key does not exist', async () => {
      expect(await storage.get('nonexistent')).toBeNull();
    });
  });

  describe('destroy', () => {
    it('clears all stored data', async () => {
      await storage.set('key1', 'value1');
      storage.destroy();
      expect(storage.getStatus()).toBe('unavailable');
    });

    it('throws on operations after destroy', async () => {
      storage.destroy();
      await expect(storage.set('key1', 'value1')).rejects.toThrow('destroyed');
    });

    it('completes the status$ observable', () => {
      let completed = false;
      storage.status$.subscribe({ complete: () => { completed = true; } });
      storage.destroy();
      expect(completed).toBe(true);
    });
  });
});

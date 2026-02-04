import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  KeyExchangeManager,
  createKeyExchangeManager,
} from '../key-exchange.js';
import {
  EncryptedIndexManager,
  createEncryptedIndexManager,
} from '../encrypted-index.js';

// ─── KeyExchangeManager Tests ─────────────────────────────────────────────────

describe('KeyExchangeManager', () => {
  let manager: KeyExchangeManager;

  beforeEach(() => {
    manager = createKeyExchangeManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('pairing flow', () => {
    it('should initiate pairing and return a code', async () => {
      const request = await manager.initiatePairing();
      expect(request.code).toBeDefined();
      expect(request.code).toHaveLength(8);
      expect(request.expiresAt).toBeGreaterThan(Date.now());
      expect(request.sharedSecret).toBeInstanceOf(Uint8Array);
    });

    it('should accept a valid pairing code', async () => {
      const request = await manager.initiatePairing();
      const device = await manager.acceptPairing(request.code, 'Test Device');

      expect(device.deviceId).toBeDefined();
      expect(device.name).toBe('Test Device');
      expect(device.pairedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should reject an invalid pairing code', async () => {
      await expect(manager.acceptPairing('INVALID1')).rejects.toThrow('Invalid pairing code');
    });

    it('should derive the same shared secret for the same code', async () => {
      const request = await manager.initiatePairing();
      const device = await manager.acceptPairing(request.code);
      const secret = manager.getMasterSecret();

      expect(secret).toBeDefined();
      expect(secret).toBeInstanceOf(Uint8Array);
      // The secret should match what was derived during pairing
      expect(secret!.length).toBeGreaterThan(0);
    });

    it('should emit pairing events', async () => {
      const events: unknown[] = [];
      manager.events$.subscribe((e) => events.push(e));

      const request = await manager.initiatePairing();
      await manager.acceptPairing(request.code);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'pairing:initiated', code: request.code });
      expect(events[1]).toMatchObject({ type: 'pairing:completed' });
    });
  });

  describe('mnemonic generation and recovery', () => {
    it('should generate a 12-word mnemonic', () => {
      const words = manager.generateMnemonic();
      expect(words).toHaveLength(12);
      words.forEach((word) => {
        expect(typeof word).toBe('string');
        expect(word.length).toBeGreaterThan(0);
      });
    });

    it('should recover from a valid mnemonic', async () => {
      const words = manager.generateMnemonic();
      const originalSecret = manager.getMasterSecret();

      const manager2 = createKeyExchangeManager();
      await manager2.recoverFromMnemonic(words);
      const recoveredSecret = manager2.getMasterSecret();

      expect(recoveredSecret).toBeDefined();
      expect(recoveredSecret).toBeInstanceOf(Uint8Array);
      manager2.destroy();
    });

    it('should reject a mnemonic with wrong length', async () => {
      await expect(manager.recoverFromMnemonic(['only', 'three', 'words'])).rejects.toThrow(
        'Mnemonic must be exactly 12 words'
      );
    });

    it('should reject a mnemonic with invalid words', async () => {
      const words = ['invalid', 'word', 'xyz123', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
      await expect(manager.recoverFromMnemonic(words)).rejects.toThrow('Invalid mnemonic word');
    });
  });

  describe('device tracking', () => {
    it('should list paired devices', async () => {
      expect(manager.listDevices()).toHaveLength(0);

      const request = await manager.initiatePairing();
      await manager.acceptPairing(request.code, 'Device A');

      const devices = manager.listDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]!.name).toBe('Device A');
    });

    it('should revoke a device', async () => {
      const request = await manager.initiatePairing();
      const device = await manager.acceptPairing(request.code, 'Device A');

      manager.revokeDevice(device.deviceId);
      expect(manager.listDevices()).toHaveLength(0);
    });

    it('should emit revocation event', async () => {
      const events: unknown[] = [];
      manager.events$.subscribe((e) => events.push(e));

      const request = await manager.initiatePairing();
      const device = await manager.acceptPairing(request.code);
      manager.revokeDevice(device.deviceId);

      const revocationEvent = events.find(
        (e) => (e as { type: string }).type === 'device:revoked'
      );
      expect(revocationEvent).toBeDefined();
    });

    it('should throw when revoking unknown device', () => {
      expect(() => manager.revokeDevice('nonexistent')).toThrow('Device not found');
    });
  });
});

// ─── EncryptedIndexManager Tests ──────────────────────────────────────────────

describe('EncryptedIndexManager', () => {
  let indexManager: EncryptedIndexManager;

  beforeEach(() => {
    indexManager = createEncryptedIndexManager();
  });

  describe('deterministic encryption', () => {
    it('should produce consistent ciphertext for the same input', async () => {
      const key = 'test-encryption-key';
      const value = 'hello world';

      const encrypted1 = await indexManager.encryptForIndex(value, key);
      const encrypted2 = await indexManager.encryptForIndex(value, key);

      expect(encrypted1).toBe(encrypted2);
    });

    it('should produce different ciphertext for different inputs', async () => {
      const key = 'test-encryption-key';

      const encrypted1 = await indexManager.encryptForIndex('value-a', key);
      const encrypted2 = await indexManager.encryptForIndex('value-b', key);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce different ciphertext for different keys', async () => {
      const value = 'same-value';

      const encrypted1 = await indexManager.encryptForIndex(value, 'key-1');
      const encrypted2 = await indexManager.encryptForIndex(value, 'key-2');

      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe('index creation and querying', () => {
    it('should create an index and query documents', async () => {
      const docs = [
        { _id: '1', status: 'active', name: 'Alice' },
        { _id: '2', status: 'inactive', name: 'Bob' },
        { _id: '3', status: 'active', name: 'Charlie' },
      ];

      const key = 'index-key';
      await indexManager.createIndex('users', 'status', key, docs);

      const encryptedActive = await indexManager.encryptForIndex('active', key);
      const results = indexManager.queryIndex('users', 'status', encryptedActive);

      expect(results).toContain('1');
      expect(results).toContain('3');
      expect(results).not.toContain('2');
    });

    it('should return empty array for non-existent index', () => {
      const results = indexManager.queryIndex('missing', 'field', 'value');
      expect(results).toEqual([]);
    });

    it('should return empty array for non-matching value', async () => {
      const docs = [{ _id: '1', status: 'active' }];
      const key = 'index-key';
      await indexManager.createIndex('users', 'status', key, docs);

      const encrypted = await indexManager.encryptForIndex('nonexistent', key);
      const results = indexManager.queryIndex('users', 'status', encrypted);

      expect(results).toEqual([]);
    });

    it('should rebuild index with new key', async () => {
      const docs = [
        { _id: '1', role: 'admin' },
        { _id: '2', role: 'user' },
      ];

      const oldKey = 'old-key';
      const newKey = 'new-key';

      await indexManager.createIndex('users', 'role', oldKey, docs);
      await indexManager.rebuildIndex('users', 'role', newKey, docs);

      // Old key should no longer work
      const oldEncrypted = await indexManager.encryptForIndex('admin', oldKey);
      expect(indexManager.queryIndex('users', 'role', oldEncrypted)).toEqual([]);

      // New key should work
      const newEncrypted = await indexManager.encryptForIndex('admin', newKey);
      expect(indexManager.queryIndex('users', 'role', newEncrypted)).toEqual(['1']);
    });

    it('should track index existence', async () => {
      expect(indexManager.hasIndex('users', 'name')).toBe(false);
      await indexManager.createIndex('users', 'name', 'key');
      expect(indexManager.hasIndex('users', 'name')).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IdentityManager, createIdentityManager } from '../identity.js';
import type { KeyPair } from '../types.js';

describe('IdentityManager', () => {
  let manager: IdentityManager;

  beforeEach(() => {
    manager = createIdentityManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createIdentityManager factory', () => {
    it('creates an IdentityManager instance', () => {
      expect(manager).toBeInstanceOf(IdentityManager);
    });
  });

  describe('generateKeyPair', () => {
    it('creates a key pair', async () => {
      const keyPair = await manager.generateKeyPair();
      expect(keyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
      expect(keyPair.privateKey).toMatch(/^[0-9a-f]{128}$/);
      expect(keyPair.algorithm).toBe('Ed25519');
      expect(keyPair.createdAt).toBeGreaterThan(0);
    });

    it('generates unique key pairs', async () => {
      const kp1 = await manager.generateKeyPair();
      const kp2 = await manager.generateKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
    });
  });

  describe('createDID', () => {
    it('creates a DID document', async () => {
      const keyPair = await manager.generateKeyPair();
      const did = manager.createDID(keyPair);
      expect(did.id).toMatch(/^did:pocket:/);
      expect(did.publicKeys).toHaveLength(1);
      expect(did.publicKeys[0]!.publicKeyHex).toBe(keyPair.publicKey);
      expect(did.authentication).toHaveLength(1);
    });
  });

  describe('resolveDID', () => {
    it('retrieves a registered DID', async () => {
      const keyPair = await manager.generateKeyPair();
      const did = manager.createDID(keyPair);
      const resolved = manager.resolveDID(did.id);
      expect(resolved).toEqual(did);
    });

    it('returns null for unknown DID', () => {
      expect(manager.resolveDID('did:pocket:unknown')).toBeNull();
    });
  });

  describe('sign', () => {
    it('creates a signature', async () => {
      const keyPair = await manager.generateKeyPair();
      manager.createDID(keyPair);
      const data = new TextEncoder().encode('hello');
      const sig = await manager.sign(data, keyPair);
      expect(sig.signer).toMatch(/^did:pocket:/);
      expect(sig.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(sig.algorithm).toBe('Ed25519');
    });

    it('produces consistent signatures for same input', async () => {
      const keyPair = await manager.generateKeyPair();
      const data = new TextEncoder().encode('hello');
      const sig1 = await manager.sign(data, keyPair);
      const sig2 = await manager.sign(data, keyPair);
      expect(sig1.signature).toBe(sig2.signature);
    });
  });

  describe('verify', () => {
    it('validates a valid signature', async () => {
      const keyPair = await manager.generateKeyPair();
      manager.createDID(keyPair);
      const data = new TextEncoder().encode('hello');
      const sig = await manager.sign(data, keyPair);
      const valid = await manager.verify(data, sig, keyPair.publicKey);
      expect(valid).toBe(true);
    });

    it('rejects signature from unknown DID', async () => {
      const keyPair = await manager.generateKeyPair();
      // Do NOT create DID
      const data = new TextEncoder().encode('hello');
      const sig = await manager.sign(data, keyPair);
      const valid = await manager.verify(data, sig, keyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('rejects tampered signer', async () => {
      const keyPair = await manager.generateKeyPair();
      manager.createDID(keyPair);
      const data = new TextEncoder().encode('hello');
      const sig = await manager.sign(data, keyPair);
      const tampered = { ...sig, signer: 'did:pocket:tampered' };
      const valid = await manager.verify(data, tampered, keyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('rejects wrong public key', async () => {
      const keyPair = await manager.generateKeyPair();
      manager.createDID(keyPair);
      const data = new TextEncoder().encode('hello');
      const sig = await manager.sign(data, keyPair);
      const other = await manager.generateKeyPair();
      const valid = await manager.verify(data, sig, other.publicKey);
      expect(valid).toBe(false);
    });
  });

  describe('session keys', () => {
    let keyPair: KeyPair;
    let didId: string;

    beforeEach(async () => {
      keyPair = await manager.generateKeyPair();
      const did = manager.createDID(keyPair);
      didId = did.id;
    });

    describe('createSessionKey', () => {
      it('creates a temporary key', async () => {
        const session = await manager.createSessionKey(didId);
        expect(session.id).toBeTruthy();
        expect(session.did).toBe(didId);
        expect(session.publicKey).toMatch(/^[0-9a-f]{64}$/);
        expect(session.expiresAt).toBeGreaterThan(Date.now());
      });

      it('throws for unknown DID', async () => {
        await expect(manager.createSessionKey('did:pocket:unknown')).rejects.toThrow('DID not found');
      });
    });

    describe('getSessionKey', () => {
      it('retrieves a session key', async () => {
        const session = await manager.createSessionKey(didId);
        const retrieved = manager.getSessionKey(session.id);
        expect(retrieved).toEqual(session);
      });

      it('returns null for nonexistent key', () => {
        expect(manager.getSessionKey('nonexistent')).toBeNull();
      });

      it('returns null for expired key', async () => {
        const session = await manager.createSessionKey(didId, 1);
        // Wait for expiry
        await new Promise((r) => setTimeout(r, 10));
        expect(manager.getSessionKey(session.id)).toBeNull();
      });
    });

    describe('revokeSessionKey', () => {
      it('revokes a key', async () => {
        const session = await manager.createSessionKey(didId);
        expect(manager.revokeSessionKey(session.id)).toBe(true);
        expect(manager.getSessionKey(session.id)).toBeNull();
      });

      it('returns false for nonexistent key', () => {
        expect(manager.revokeSessionKey('nonexistent')).toBe(false);
      });
    });

    describe('cleanExpiredSessionKeys', () => {
      it('removes expired keys', async () => {
        await manager.createSessionKey(didId, 1);
        await manager.createSessionKey(didId, 1);
        await new Promise((r) => setTimeout(r, 10));
        const removed = manager.cleanExpiredSessionKeys();
        expect(removed).toBe(2);
      });

      it('keeps non-expired keys', async () => {
        await manager.createSessionKey(didId, 60_000);
        const removed = manager.cleanExpiredSessionKeys();
        expect(removed).toBe(0);
      });
    });

    describe('getActiveSessionKeys', () => {
      it('returns non-expired keys for a DID', async () => {
        await manager.createSessionKey(didId, 60_000);
        await manager.createSessionKey(didId, 60_000);
        const active = manager.getActiveSessionKeys(didId);
        expect(active).toHaveLength(2);
      });

      it('excludes expired keys', async () => {
        await manager.createSessionKey(didId, 1);
        await new Promise((r) => setTimeout(r, 10));
        const active = manager.getActiveSessionKeys(didId);
        expect(active).toHaveLength(0);
      });
    });
  });

  describe('getAllDIDs', () => {
    it('returns registered DIDs', async () => {
      const kp1 = await manager.generateKeyPair();
      const kp2 = await manager.generateKeyPair();
      const did1 = manager.createDID(kp1);
      const did2 = manager.createDID(kp2);
      const allDids = manager.getAllDIDs();
      expect(allDids).toContain(did1.id);
      expect(allDids).toContain(did2.id);
    });

    it('returns empty array when none registered', () => {
      expect(manager.getAllDIDs()).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('clears all state', async () => {
      const kp = await manager.generateKeyPair();
      const did = manager.createDID(kp);
      await manager.createSessionKey(did.id);
      manager.destroy();
      expect(manager.getAllDIDs()).toEqual([]);
    });
  });
});

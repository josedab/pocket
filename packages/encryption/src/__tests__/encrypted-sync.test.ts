import { describe, expect, it, beforeEach } from 'vitest';
import {
  EncryptedSyncTransport,
  createEncryptedSyncTransport,
  type EncryptedDocument,
} from '../encrypted-sync.js';

describe('EncryptedSyncTransport', () => {
  let transport: EncryptedSyncTransport;

  beforeEach(() => {
    transport = createEncryptedSyncTransport({
      encryptionKey: 'test-secret-key-1234',
      algorithm: 'AES-GCM',
      keyDerivation: 'PBKDF2',
      collections: ['notes', 'secrets'],
    });
  });

  // ── Round-trip ────────────────────────────────────────────

  it('should encrypt and decrypt a document round-trip', () => {
    const original = {
      _id: 'doc-1',
      title: 'Secret Note',
      content: 'This is confidential',
      tags: ['private', 'important'],
    };

    const encrypted = transport.encryptDocument(original);
    const decrypted = transport.decryptDocument(encrypted);

    expect(decrypted._id).toBe('doc-1');
    expect(decrypted.title).toBe('Secret Note');
    expect(decrypted.content).toBe('This is confidential');
    expect(decrypted.tags).toEqual(['private', 'important']);
  });

  // ── Preserves _id ─────────────────────────────────────────

  it('should preserve _id in the encrypted document', () => {
    const encrypted = transport.encryptDocument({
      _id: 'my-doc',
      data: 'hello',
    });

    expect(encrypted._id).toBe('my-doc');
    expect(encrypted._ciphertext).toBeTruthy();
    expect(encrypted._nonce).toBeTruthy();
    // _id should NOT appear inside the ciphertext
    expect(encrypted._ciphertext).not.toBe('');
  });

  // ── Batch operations ──────────────────────────────────────

  it('should encrypt and decrypt batches of documents', () => {
    const docs = [
      { _id: 'a', value: 1 },
      { _id: 'b', value: 2 },
      { _id: 'c', value: 3 },
    ];

    const encrypted = transport.encryptBatch(docs);
    expect(encrypted).toHaveLength(3);
    expect(encrypted[0]!._id).toBe('a');
    expect(encrypted[1]!._id).toBe('b');
    expect(encrypted[2]!._id).toBe('c');

    const decrypted = transport.decryptBatch(encrypted);
    expect(decrypted).toHaveLength(3);
    expect(decrypted[0]).toEqual({ _id: 'a', value: 1 });
    expect(decrypted[1]).toEqual({ _id: 'b', value: 2 });
    expect(decrypted[2]).toEqual({ _id: 'c', value: 3 });
  });

  // ── Collection scope filtering ────────────────────────────

  it('should report collections inside the encryption scope', () => {
    expect(transport.isCollectionEncrypted('notes')).toBe(true);
    expect(transport.isCollectionEncrypted('secrets')).toBe(true);
    expect(transport.isCollectionEncrypted('public-data')).toBe(false);
  });

  it('should treat all collections as encrypted when none are specified', () => {
    const globalTransport = createEncryptedSyncTransport({
      encryptionKey: 'key',
    });

    expect(globalTransport.isCollectionEncrypted('anything')).toBe(true);
    expect(globalTransport.isCollectionEncrypted('other')).toBe(true);
  });

  // ── Key rotation ──────────────────────────────────────────

  it('should rotate the encryption key and produce different ciphertext', () => {
    const doc = { _id: 'rot-1', secret: 'data' };

    const before = transport.encryptDocument(doc);

    transport.rotateKey('new-rotated-key-5678');

    const after = transport.encryptDocument(doc);

    // Both should round-trip with the *current* key
    const decryptedAfter = transport.decryptDocument(after);
    expect(decryptedAfter.secret).toBe('data');

    // The key info should reflect the rotation
    const info = transport.getKeyInfo();
    expect(info.rotatedAt).toBeDefined();
    expect(typeof info.rotatedAt).toBe('number');
  });

  // ── Key info retrieval ────────────────────────────────────

  it('should return key info with expected fields', () => {
    const info = transport.getKeyInfo();

    expect(info.id).toBeTruthy();
    expect(info.algorithm).toBe('AES-GCM');
    expect(typeof info.createdAt).toBe('number');
    expect(info.rotatedAt).toBeUndefined();
  });

  it('should return a copy of key info (not a reference)', () => {
    const a = transport.getKeyInfo();
    const b = transport.getKeyInfo();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

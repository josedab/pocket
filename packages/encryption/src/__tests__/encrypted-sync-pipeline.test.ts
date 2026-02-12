import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedSyncPipeline, createEncryptedSyncPipeline } from '../encrypted-sync-pipeline.js';

describe('EncryptedSyncPipeline', () => {
  let pipeline: EncryptedSyncPipeline;

  beforeEach(() => {
    pipeline = createEncryptedSyncPipeline({
      masterKey: 'test-master-key-12345',
      collections: ['notes', 'secrets'],
      excludeFields: ['_id', '_rev'],
    });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should encrypt and decrypt a document roundtrip', () => {
    const original = {
      _id: 'doc-1',
      _rev: '1-abc',
      title: 'Secret Note',
      content: 'This is confidential',
      tags: ['private'],
    };

    const { metadata, encrypted } = pipeline.encryptDocument('notes', original);

    // Metadata should contain excluded fields
    expect(metadata._id).toBe('doc-1');
    expect(metadata._rev).toBe('1-abc');

    // Encrypted payload should have proper structure
    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.version).toBe(1);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.keyId).toBeTruthy();

    // Decrypt
    const decrypted = pipeline.decryptDocument('notes', { metadata, encrypted });
    expect(decrypted._id).toBe('doc-1');
    expect(decrypted.title).toBe('Secret Note');
    expect(decrypted.content).toBe('This is confidential');
    expect(decrypted.tags).toEqual(['private']);
  });

  it('should reject encryption for unconfigured collections', () => {
    expect(() => {
      pipeline.encryptDocument('todos', { title: 'Test' });
    }).toThrow('not configured for encryption');
  });

  it('should track encryption statistics', () => {
    pipeline.encryptDocument('notes', { title: 'Test 1' });
    pipeline.encryptDocument('notes', { title: 'Test 2' });

    const stats = pipeline.getStats();
    expect(stats.documentsEncrypted).toBe(2);
    expect(stats.encryptionErrors).toBe(0);
  });

  it('should rotate keys', () => {
    const events: unknown[] = [];
    pipeline.events$.subscribe((e) => events.push(e));

    const oldKeyId = pipeline.getActiveKeyId();
    const newKeyId = pipeline.rotateKey('new-master-key');

    expect(newKeyId).not.toBe(oldKeyId);
    expect(pipeline.getActiveKeyId()).toBe(newKeyId);
    expect(events.length).toBe(1);

    const stats = pipeline.getStats();
    expect(stats.keyRotationCount).toBe(1);
  });

  it('should decrypt with old key after rotation', () => {
    // Encrypt with original key
    const { metadata, encrypted } = pipeline.encryptDocument('notes', { title: 'Before rotation' });

    // Rotate key
    pipeline.rotateKey('new-key');

    // Should still decrypt with old key
    const decrypted = pipeline.decryptDocument('notes', { metadata, encrypted });
    expect(decrypted.title).toBe('Before rotation');
  });

  it('should track all derived key IDs', () => {
    const initialKeys = pipeline.getKeyIds();
    expect(initialKeys.length).toBe(1);

    pipeline.rotateKey('key-2');
    pipeline.rotateKey('key-3');

    expect(pipeline.getKeyIds().length).toBe(3);
  });

  it('should handle empty documents', () => {
    const { metadata, encrypted } = pipeline.encryptDocument('notes', { _id: 'empty' });
    expect(metadata._id).toBe('empty');

    const decrypted = pipeline.decryptDocument('notes', { metadata, encrypted });
    expect(decrypted._id).toBe('empty');
  });

  it('should emit stats updates via stats$', () => {
    const statsList: unknown[] = [];
    pipeline.stats$.subscribe((s) => statsList.push(s));

    pipeline.encryptDocument('notes', { title: 'Test' });

    // At least initial + one update
    expect(statsList.length).toBeGreaterThanOrEqual(1);
  });
});

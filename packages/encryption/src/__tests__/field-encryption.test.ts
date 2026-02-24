import { describe, expect, it } from 'vitest';
import { FieldEncryptionEngine, SimpleFieldCryptoProvider } from '../field-encryption.js';

describe('FieldEncryptionEngine', () => {
  const crypto = new SimpleFieldCryptoProvider();

  it('should initialize and generate a key', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    const keyId = await engine.initialize();
    expect(keyId).toBeTruthy();
    expect(engine.listKeys()).toHaveLength(1);
  });

  it('should encrypt specified fields', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email', 'ssn'] });
    await engine.initialize();

    const doc = { _id: '1', name: 'Alice', email: 'alice@test.com', ssn: '123-45-6789' };
    const encrypted = await engine.encryptDocument(doc);

    expect(encrypted._encrypted).toBe(true);
    expect(typeof encrypted.email).toBe('string');
    expect((encrypted.email as string).startsWith('enc:')).toBe(true);
    expect(encrypted.name).toBe('Alice'); // not encrypted
  });

  it('should decrypt back to original values', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    await engine.initialize();

    const original = { _id: '1', name: 'Alice', email: 'alice@test.com' };
    const encrypted = await engine.encryptDocument(original);
    const decrypted = await engine.decryptDocument(encrypted);

    expect(decrypted.email).toBe('alice@test.com');
    expect(decrypted.name).toBe('Alice');
    expect(decrypted._encrypted).toBeUndefined();
  });

  it('should initialize from passphrase', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['data'] });
    await engine.initializeFromPassphrase('my-secret-password');

    const doc = { _id: '1', data: 'sensitive' };
    const encrypted = await engine.encryptDocument(doc);
    const decrypted = await engine.decryptDocument(encrypted);
    expect(decrypted.data).toBe('sensitive');
  });

  it('should rotate keys', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    const key1 = await engine.initialize();
    const key2 = await engine.rotateKey();

    expect(key1).not.toBe(key2);
    expect(engine.listKeys()).toHaveLength(2);
    expect(engine.listKeys().filter((k) => k.active)).toHaveLength(1);
  });

  it('should decrypt with old key after rotation', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    await engine.initialize();

    const encrypted = await engine.encryptDocument({ _id: '1', email: 'test@test.com' });
    await engine.rotateKey();

    const decrypted = await engine.decryptDocument(encrypted);
    expect(decrypted.email).toBe('test@test.com');
  });

  it('should detect encrypted documents', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    await engine.initialize();

    const plain = { _id: '1', email: 'test@test.com' };
    const encrypted = await engine.encryptDocument(plain);

    expect(engine.isEncrypted(plain)).toBe(false);
    expect(engine.isEncrypted(encrypted)).toBe(true);
  });

  it('should track encryption stats', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    await engine.initialize();

    await engine.encryptDocument({ _id: '1', email: 'a@b.com' });
    await engine.encryptDocument({ _id: '2', email: 'c@d.com' });

    const stats = engine.getStats();
    expect(stats.documentsEncrypted).toBe(2);
    expect(stats.fieldsEncrypted).toBe(2);
    expect(stats.keyCount).toBe(1);
  });

  it('should throw when not initialized', async () => {
    const engine = new FieldEncryptionEngine(crypto, { encryptedFields: ['email'] });
    await expect(engine.encryptDocument({ _id: '1', email: 'x' })).rejects.toThrow(
      'not initialized'
    );
  });
});

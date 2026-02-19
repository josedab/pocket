import { describe, expect, it, beforeEach } from 'vitest';
import {
  WebCryptoProvider,
  createWebCryptoProvider,
  toBase64,
  fromBase64,
} from '../web-crypto-provider.js';

describe('WebCryptoProvider', () => {
  let provider: WebCryptoProvider;

  beforeEach(() => {
    provider = createWebCryptoProvider();
  });

  it('should generate a CryptoKey', async () => {
    const key = await provider.generateKey();
    expect(key).toBeDefined();
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('should encrypt and decrypt round-trip', async () => {
    const key = await provider.generateKey();
    const plaintext = 'Hello, world! 🌍';

    const encrypted = await provider.encrypt(plaintext, key);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.nonce).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();

    const decrypted = await provider.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      key,
      encrypted.tag,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext (nonce randomness)', async () => {
    const key = await provider.generateKey();
    const plaintext = 'same message';

    const encrypted1 = await provider.encrypt(plaintext, key);
    const encrypted2 = await provider.encrypt(plaintext, key);

    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    expect(encrypted1.nonce).not.toBe(encrypted2.nonce);
  });

  it('should derive a key from a password', async () => {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const key = await provider.deriveKeyFromPassword({
      password: 'my-secret-password',
      salt,
      iterations: 10_000,
    });

    expect(key).toBeDefined();
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });

    // Derived key should work for encrypt/decrypt
    const plaintext = 'derived key test';
    const encrypted = await provider.encrypt(plaintext, key);
    const decrypted = await provider.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      key,
      encrypted.tag,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('should export and import a key round-trip', async () => {
    const originalKey = await provider.generateKey();
    const plaintext = 'key export test';

    const exported = await provider.exportKey(originalKey);
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);

    const importedKey = await provider.importKey(exported);
    const encrypted = await provider.encrypt(plaintext, originalKey);
    const decrypted = await provider.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      importedKey,
      encrypted.tag,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('should fail to decrypt with a wrong key', async () => {
    const key1 = await provider.generateKey();
    const key2 = await provider.generateKey();
    const plaintext = 'secret data';

    const encrypted = await provider.encrypt(plaintext, key1);

    await expect(
      provider.decrypt(encrypted.ciphertext, encrypted.nonce, key2, encrypted.tag),
    ).rejects.toThrow();
  });

  it('should encrypt and decrypt an empty string', async () => {
    const key = await provider.generateKey();
    const plaintext = '';

    const encrypted = await provider.encrypt(plaintext, key);
    const decrypted = await provider.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      key,
      encrypted.tag,
    );
    expect(decrypted).toBe('');
  });

  it('should accept a custom nonce', async () => {
    const key = await provider.generateKey();
    const nonce = provider.generateNonce();
    const plaintext = 'custom nonce test';

    const encrypted = await provider.encrypt(plaintext, key, nonce);
    expect(fromBase64(encrypted.nonce)).toEqual(nonce);

    const decrypted = await provider.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      key,
      encrypted.tag,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('toBase64 and fromBase64 should round-trip', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });
});

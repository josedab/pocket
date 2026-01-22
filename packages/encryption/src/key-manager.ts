import { fromBase64, getSubtleCrypto, randomBytes, randomUUID, toBase64 } from './crypto-utils.js';
import type {
  EncryptionAlgorithm,
  EncryptionKey,
  EncryptionKeyConfig,
  KeyManager,
} from './types.js';

/**
 * Default key derivation iterations
 */
const DEFAULT_ITERATIONS = 100000;
const DEFAULT_KEY_LENGTH = 256;
const DEFAULT_SALT_LENGTH = 16;

/**
 * Web Crypto key manager implementation
 */
export class WebCryptoKeyManager implements KeyManager {
  private readonly keys = new Map<string, EncryptionKey>();

  /**
   * Derive a key from a password using PBKDF2
   */
  async deriveKey(password: string, config: EncryptionKeyConfig): Promise<EncryptionKey> {
    const subtle = getSubtleCrypto();
    const iterations = config.iterations ?? DEFAULT_ITERATIONS;
    const keyLength = config.keyLength ?? DEFAULT_KEY_LENGTH;

    // Generate or use provided salt
    const salt = config.salt ? fromBase64(config.salt) : randomBytes(DEFAULT_SALT_LENGTH);

    // Import password as key material
    const passwordKey = await subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive the encryption key
    const derivedKey = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: keyLength,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const keyId = randomUUID();
    const encryptionKey: EncryptionKey = {
      key: derivedKey,
      keyId,
      salt,
      algorithm: 'AES-GCM',
    };

    this.keys.set(keyId, encryptionKey);
    return encryptionKey;
  }

  /**
   * Generate a new random key
   */
  async generateKey(algorithm: EncryptionAlgorithm): Promise<EncryptionKey> {
    const subtle = getSubtleCrypto();

    const key = await subtle.generateKey(
      {
        name: algorithm,
        length: DEFAULT_KEY_LENGTH,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const keyId = randomUUID();
    const salt = randomBytes(DEFAULT_SALT_LENGTH);

    const encryptionKey: EncryptionKey = {
      key,
      keyId,
      salt,
      algorithm,
    };

    this.keys.set(keyId, encryptionKey);
    return encryptionKey;
  }

  /**
   * Export a key for secure storage
   */
  async exportKey(key: EncryptionKey): Promise<string> {
    const subtle = getSubtleCrypto();

    const exported = await subtle.exportKey('raw', key.key);
    const keyBytes = new Uint8Array(exported);

    const envelope = {
      keyId: key.keyId,
      key: toBase64(keyBytes),
      salt: toBase64(key.salt),
      algorithm: key.algorithm,
      version: 1,
    };

    return JSON.stringify(envelope);
  }

  /**
   * Import a key from storage
   */
  async importKey(exported: string, algorithm: EncryptionAlgorithm): Promise<EncryptionKey> {
    const subtle = getSubtleCrypto();
    const envelope = JSON.parse(exported) as {
      keyId: string;
      key: string;
      salt: string;
      algorithm: EncryptionAlgorithm;
      version: number;
    };

    const keyBytes = fromBase64(envelope.key);
    const salt = fromBase64(envelope.salt);

    const key = await subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      {
        name: algorithm,
        length: keyBytes.length * 8,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const encryptionKey: EncryptionKey = {
      key,
      keyId: envelope.keyId,
      salt,
      algorithm: envelope.algorithm || algorithm,
    };

    this.keys.set(encryptionKey.keyId, encryptionKey);
    return encryptionKey;
  }

  /**
   * Get a key by ID
   */
  getKey(keyId: string): EncryptionKey | undefined {
    return this.keys.get(keyId);
  }

  /**
   * Store a key
   */
  storeKey(key: EncryptionKey): void {
    this.keys.set(key.keyId, key);
  }

  /**
   * Remove a key
   */
  removeKey(keyId: string): boolean {
    return this.keys.delete(keyId);
  }

  /**
   * Clear all keys
   */
  clearKeys(): void {
    this.keys.clear();
  }

  /**
   * Get all key IDs
   */
  getKeyIds(): string[] {
    return Array.from(this.keys.keys());
  }
}

/**
 * Create a key manager instance
 */
export function createKeyManager(): KeyManager {
  return new WebCryptoKeyManager();
}

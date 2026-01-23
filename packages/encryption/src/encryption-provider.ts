import { concatBytes, fromBase64, getSubtleCrypto, randomBytes, toBase64 } from './crypto-utils.js';
import type {
  EncryptedEnvelope,
  EncryptionAlgorithm,
  EncryptionKey,
  EncryptionProvider,
} from './types.js';

/**
 * IV sizes for different algorithms
 */
const IV_SIZES: Record<EncryptionAlgorithm, number> = {
  'AES-GCM': 12,
  'AES-CBC': 16,
};

/**
 * Tag size for AES-GCM (128 bits)
 */
const GCM_TAG_LENGTH = 128;

/**
 * Current encryption version
 */
const ENCRYPTION_VERSION = 1;

/**
 * AES-GCM encryption provider
 */
export class AESGCMProvider implements EncryptionProvider {
  /**
   * Encrypt data using AES-GCM
   */
  async encrypt(data: Uint8Array, key: EncryptionKey): Promise<EncryptedEnvelope> {
    const subtle = getSubtleCrypto();
    const iv = this.generateIV();

    const encrypted = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        tagLength: GCM_TAG_LENGTH,
      },
      key.key,
      data as unknown as BufferSource
    );

    const encryptedBytes = new Uint8Array(encrypted);

    // In Web Crypto, the tag is appended to the ciphertext
    // Extract it for explicit storage
    const tagStart = encryptedBytes.length - GCM_TAG_LENGTH / 8;
    const ciphertext = encryptedBytes.slice(0, tagStart);
    const tag = encryptedBytes.slice(tagStart);

    return {
      data: toBase64(ciphertext),
      iv: toBase64(iv),
      tag: toBase64(tag),
      algorithm: 'AES-GCM',
      version: ENCRYPTION_VERSION,
    };
  }

  /**
   * Decrypt data using AES-GCM
   */
  async decrypt(envelope: EncryptedEnvelope, key: EncryptionKey): Promise<Uint8Array> {
    const subtle = getSubtleCrypto();

    const ciphertext = fromBase64(envelope.data);
    const iv = fromBase64(envelope.iv);
    const tag = envelope.tag ? fromBase64(envelope.tag) : new Uint8Array(0);

    // Web Crypto expects tag appended to ciphertext
    const encrypted = concatBytes(ciphertext, tag);

    const decrypted = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        tagLength: GCM_TAG_LENGTH,
      },
      key.key,
      encrypted as unknown as BufferSource
    );

    return new Uint8Array(decrypted);
  }

  /**
   * Generate a random IV for AES-GCM
   */
  generateIV(): Uint8Array {
    return randomBytes(IV_SIZES['AES-GCM']);
  }
}

/**
 * AES-CBC encryption provider
 */
export class AESCBCProvider implements EncryptionProvider {
  /**
   * Encrypt data using AES-CBC
   */
  async encrypt(data: Uint8Array, key: EncryptionKey): Promise<EncryptedEnvelope> {
    const subtle = getSubtleCrypto();
    const iv = this.generateIV();

    // AES-CBC requires padding - Web Crypto handles PKCS#7 padding
    const encrypted = await subtle.encrypt(
      {
        name: 'AES-CBC',
        iv: iv as unknown as BufferSource,
      },
      key.key,
      data as unknown as BufferSource
    );

    return {
      data: toBase64(new Uint8Array(encrypted)),
      iv: toBase64(iv),
      algorithm: 'AES-CBC',
      version: ENCRYPTION_VERSION,
    };
  }

  /**
   * Decrypt data using AES-CBC
   */
  async decrypt(envelope: EncryptedEnvelope, key: EncryptionKey): Promise<Uint8Array> {
    const subtle = getSubtleCrypto();

    const ciphertext = fromBase64(envelope.data);
    const iv = fromBase64(envelope.iv);

    const decrypted = await subtle.decrypt(
      {
        name: 'AES-CBC',
        iv: iv as unknown as BufferSource,
      },
      key.key,
      ciphertext as unknown as BufferSource
    );

    return new Uint8Array(decrypted);
  }

  /**
   * Generate a random IV for AES-CBC
   */
  generateIV(): Uint8Array {
    return randomBytes(IV_SIZES['AES-CBC']);
  }
}

/**
 * Get an encryption provider for the specified algorithm
 */
export function getEncryptionProvider(algorithm: EncryptionAlgorithm): EncryptionProvider {
  switch (algorithm) {
    case 'AES-GCM':
      return new AESGCMProvider();
    case 'AES-CBC':
      return new AESCBCProvider();
    default:
      throw new Error(`Unsupported encryption algorithm: ${algorithm as string}`);
  }
}

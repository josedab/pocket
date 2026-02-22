/**
 * Production-ready AES-GCM encryption provider using the Web Crypto API.
 *
 * Uses `globalThis.crypto.subtle` for portability across Node.js 20+ and browsers.
 *
 * @module @pocket/encryption
 */

// ── Types ─────────────────────────────────────────────────

export interface CryptoProvider {
  encrypt(
    plaintext: string,
    key: CryptoKey,
    nonce?: Uint8Array,
  ): Promise<{ ciphertext: string; nonce: string; tag: string }>;
  decrypt(ciphertext: string, nonce: string, key: CryptoKey, tag?: string): Promise<string>;
}

export interface WebCryptoConfig {
  keyLength?: 128 | 256;
  nonceLength?: number;
}

export interface KeyDerivationParams {
  password: string;
  salt?: Uint8Array;
  iterations?: number;
}

// ── Helpers ───────────────────────────────────────────────

export function toBase64(buffer: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Constants ─────────────────────────────────────────────

const DEFAULT_KEY_LENGTH = 256;
const DEFAULT_NONCE_LENGTH = 12;
const GCM_TAG_LENGTH = 128;
const DEFAULT_PBKDF2_ITERATIONS = 100_000;
const DEFAULT_SALT_LENGTH = 16;

// ── WebCryptoProvider ─────────────────────────────────────

export class WebCryptoProvider implements CryptoProvider {
  private readonly keyLength: 128 | 256;
  private readonly nonceLength: number;

  constructor(config?: WebCryptoConfig) {
    this.keyLength = config?.keyLength ?? DEFAULT_KEY_LENGTH;
    this.nonceLength = config?.nonceLength ?? DEFAULT_NONCE_LENGTH;
  }

  private get subtle(): SubtleCrypto {
    return globalThis.crypto.subtle;
  }

  /** AES-GCM encrypt. Returns base64-encoded ciphertext, nonce, and tag. */
  async encrypt(
    plaintext: string,
    key: CryptoKey,
    nonce?: Uint8Array,
  ): Promise<{ ciphertext: string; nonce: string; tag: string }> {
    const iv = nonce ?? this.generateNonce();
    const encoded = new TextEncoder().encode(plaintext);

    const encrypted = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: GCM_TAG_LENGTH },
      key,
      encoded as unknown as BufferSource,
    );

    const encryptedBytes = new Uint8Array(encrypted);
    const tagStart = encryptedBytes.length - GCM_TAG_LENGTH / 8;
    const ciphertextBytes = encryptedBytes.slice(0, tagStart);
    const tagBytes = encryptedBytes.slice(tagStart);

    return {
      ciphertext: toBase64(ciphertextBytes),
      nonce: toBase64(iv),
      tag: toBase64(tagBytes),
    };
  }

  /** AES-GCM decrypt. Accepts base64-encoded ciphertext, nonce, and optional tag. */
  async decrypt(
    ciphertext: string,
    nonce: string,
    key: CryptoKey,
    tag?: string,
  ): Promise<string> {
    const ciphertextBytes = fromBase64(ciphertext);
    const iv = fromBase64(nonce);
    const tagBytes = tag ? fromBase64(tag) : new Uint8Array(0);

    // Web Crypto expects the tag appended to the ciphertext
    const combined = new Uint8Array(ciphertextBytes.length + tagBytes.length);
    combined.set(ciphertextBytes, 0);
    combined.set(tagBytes, ciphertextBytes.length);

    const decrypted = await this.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: GCM_TAG_LENGTH },
      key,
      combined as unknown as BufferSource,
    );

    return new TextDecoder().decode(decrypted);
  }

  /** Generate a new AES-GCM CryptoKey. */
  async generateKey(): Promise<CryptoKey> {
    return this.subtle.generateKey(
      { name: 'AES-GCM', length: this.keyLength },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /** Derive an AES-GCM key from a password using PBKDF2. */
  async deriveKeyFromPassword(params: KeyDerivationParams): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await this.subtle.importKey(
      'raw',
      encoder.encode(params.password) as unknown as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    const salt = params.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(DEFAULT_SALT_LENGTH));
    const iterations = params.iterations ?? DEFAULT_PBKDF2_ITERATIONS;

    return this.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
      passwordKey,
      { name: 'AES-GCM', length: this.keyLength },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /** Export a CryptoKey to a base64 string. */
  async exportKey(key: CryptoKey): Promise<string> {
    const raw = await this.subtle.exportKey('raw', key);
    return toBase64(new Uint8Array(raw));
  }

  /** Import a base64 string as a CryptoKey. */
  async importKey(base64: string): Promise<CryptoKey> {
    const raw = fromBase64(base64);
    return this.subtle.importKey(
      'raw',
      raw as unknown as BufferSource,
      { name: 'AES-GCM', length: this.keyLength },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /** Generate a random nonce (IV) of the configured length. */
  generateNonce(): Uint8Array {
    const nonce = new Uint8Array(this.nonceLength);
    globalThis.crypto.getRandomValues(nonce);
    return nonce;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a WebCryptoProvider instance. */
export function createWebCryptoProvider(config?: WebCryptoConfig): WebCryptoProvider {
  return new WebCryptoProvider(config);
}

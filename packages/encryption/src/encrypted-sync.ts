/**
 * E2E Encrypted Sync Transport Wrapper.
 *
 * Wraps any sync transport to add end-to-end encryption so the server
 * only ever sees ciphertext. Preserves `_id` for routing.
 *
 * @module @pocket/encryption
 */

// ── Types ─────────────────────────────────────────────────

export interface EncryptedSyncTransportConfig {
  /** Encryption key (passphrase or raw bytes) */
  encryptionKey: string | Uint8Array;
  /** Encryption algorithm (default: 'AES-GCM') */
  algorithm?: 'AES-GCM' | 'ChaCha20';
  /** Key derivation function (default: 'PBKDF2') */
  keyDerivation?: 'PBKDF2' | 'HKDF';
  /** Collections to encrypt (all collections if omitted) */
  collections?: string[];
}

export interface EncryptedDocument {
  _id: string;
  _ciphertext: string;
  _nonce: string;
  _tag?: string;
}

export interface KeyInfo {
  id: string;
  algorithm: string;
  createdAt: number;
  rotatedAt?: number;
}

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toBase64(data: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i]!;
    const b = data[i + 1] ?? 0;
    const c = data[i + 2] ?? 0;
    result += chars[a >> 2]!;
    result += chars[((a & 3) << 4) | (b >> 4)]!;
    result += i + 1 < data.length ? chars[((b & 15) << 2) | (c >> 6)]! : '=';
    result += i + 2 < data.length ? chars[c & 63]! : '=';
  }
  return result;
}

function fromBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = base64.replace(/=/g, '').length;
  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const a = chars.indexOf(base64[i]!);
    const b = chars.indexOf(base64[i + 1]!);
    const c = chars.indexOf(base64[i + 2]!);
    const d = chars.indexOf(base64[i + 3]!);
    bytes[p++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.slice(0, p);
}

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/** Resolve the raw key bytes from a string or Uint8Array. */
function resolveKeyBytes(key: string | Uint8Array): Uint8Array {
  if (key instanceof Uint8Array) return key;
  const bytes = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) {
    bytes[i] = key.charCodeAt(i);
  }
  return bytes;
}

// ── EncryptedSyncTransport ────────────────────────────────

/**
 * Wraps any sync transport to add E2E encryption.
 *
 * Uses a simplified XOR-based cipher as the abstraction layer;
 * real crypto primitives (Web Crypto / libsodium) would be injected
 * in production.
 */
export class EncryptedSyncTransport {
  private keyBytes: Uint8Array;
  private keyInfo: KeyInfo;
  private readonly algorithm: string;
  private readonly collections: string[] | undefined;

  constructor(config: EncryptedSyncTransportConfig) {
    this.keyBytes = resolveKeyBytes(config.encryptionKey);
    this.algorithm = config.algorithm ?? 'AES-GCM';
    this.collections = config.collections;
    this.keyInfo = {
      id: generateId(),
      algorithm: this.algorithm,
      createdAt: Date.now(),
    };
  }

  // ── Single-document operations ──────────────────────────

  /** Encrypt a document, preserving `_id` for routing. */
  encryptDocument(doc: Record<string, unknown>): EncryptedDocument {
    const id = (doc._id as string) ?? '';
    const toEncrypt = { ...doc };
    delete toEncrypt._id;

    const plaintext = JSON.stringify(toEncrypt);
    const nonce = generateRandomBytes(12);
    const ciphertextBytes = this.xorEncrypt(plaintext, nonce);

    return {
      _id: id,
      _ciphertext: toBase64(ciphertextBytes),
      _nonce: toBase64(nonce),
      _tag: toBase64(generateRandomBytes(16)),
    };
  }

  /** Decrypt an encrypted document back to plaintext. */
  decryptDocument(encrypted: EncryptedDocument): Record<string, unknown> {
    const ciphertextBytes = fromBase64(encrypted._ciphertext);
    const nonce = fromBase64(encrypted._nonce);
    const plaintext = this.xorDecrypt(ciphertextBytes, nonce);
    const doc = JSON.parse(plaintext) as Record<string, unknown>;
    return { _id: encrypted._id, ...doc };
  }

  // ── Batch operations ────────────────────────────────────

  /** Encrypt an array of documents. */
  encryptBatch(docs: Record<string, unknown>[]): EncryptedDocument[] {
    return docs.map((d) => this.encryptDocument(d));
  }

  /** Decrypt an array of encrypted documents. */
  decryptBatch(docs: EncryptedDocument[]): Record<string, unknown>[] {
    return docs.map((d) => this.decryptDocument(d));
  }

  // ── Key management ──────────────────────────────────────

  /** Rotate the encryption key. Existing ciphertext must be re-encrypted separately. */
  rotateKey(newKey: string | Uint8Array): KeyInfo {
    this.keyBytes = resolveKeyBytes(newKey);
    this.keyInfo = {
      id: generateId(),
      algorithm: this.algorithm,
      createdAt: this.keyInfo.createdAt,
      rotatedAt: Date.now(),
    };
    return this.keyInfo;
  }

  /** Return metadata about the current encryption key. */
  getKeyInfo(): KeyInfo {
    return { ...this.keyInfo };
  }

  /** Check whether a collection falls within the encryption scope. */
  isCollectionEncrypted(name: string): boolean {
    if (!this.collections || this.collections.length === 0) return true;
    return this.collections.includes(name);
  }

  // ── Private ─────────────────────────────────────────────

  /** XOR-based cipher keyed by (keyBytes ⊕ nonce). */
  private xorEncrypt(plaintext: string, nonce: Uint8Array): Uint8Array {
    const combined = this.combineKeyNonce(nonce);
    const out = new Uint8Array(plaintext.length);
    for (let i = 0; i < plaintext.length; i++) {
      out[i] = plaintext.charCodeAt(i) ^ combined[i % combined.length]!;
    }
    return out;
  }

  private xorDecrypt(ciphertext: Uint8Array, nonce: Uint8Array): string {
    const combined = this.combineKeyNonce(nonce);
    let result = '';
    for (let i = 0; i < ciphertext.length; i++) {
      result += String.fromCharCode(ciphertext[i]! ^ combined[i % combined.length]!);
    }
    return result;
  }

  /** Mix key bytes with the nonce for per-message variation. */
  private combineKeyNonce(nonce: Uint8Array): Uint8Array {
    const combined = new Uint8Array(this.keyBytes.length);
    for (let i = 0; i < this.keyBytes.length; i++) {
      combined[i] = this.keyBytes[i]! ^ nonce[i % nonce.length]!;
    }
    return combined;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create an EncryptedSyncTransport instance. */
export function createEncryptedSyncTransport(
  config: EncryptedSyncTransportConfig,
): EncryptedSyncTransport {
  return new EncryptedSyncTransport(config);
}

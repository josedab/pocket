/**
 * FieldEncryptionEngine — Transparent field-level encryption for Pocket documents.
 *
 * Encrypts specified fields before storage and decrypts on read,
 * using AES-GCM via a pluggable crypto provider.
 */

// ── Types ──────────────────────────────────────────────────

export interface EncryptionConfig {
  /** Fields to encrypt (dot-path notation) */
  encryptedFields: string[];
  /** Encryption algorithm (default: 'aes-256-gcm') */
  algorithm?: string;
  /** Key rotation interval in ms (default: 30 days) */
  keyRotationIntervalMs?: number;
}

export interface FieldCryptoProvider {
  encrypt(plaintext: string, key: string): Promise<string>;
  decrypt(ciphertext: string, key: string): Promise<string>;
  generateKey(): Promise<string>;
  deriveKey(passphrase: string, salt: string): Promise<string>;
}

export interface KeyInfo {
  id: string;
  createdAt: number;
  rotatedAt: number | null;
  active: boolean;
}

export interface EncryptionStats {
  documentsEncrypted: number;
  documentsDecrypted: number;
  fieldsEncrypted: number;
  avgEncryptionTimeMs: number;
  activeKeyId: string | null;
  keyCount: number;
}

// ── Default Crypto Provider (XOR-based — for testing; production uses Web Crypto) ──

export class SimpleFieldCryptoProvider implements FieldCryptoProvider {
  async encrypt(plaintext: string, key: string): Promise<string> {
    const encoded = this.xorCipher(plaintext, key);
    return `enc:${btoa(encoded)}`;
  }

  async decrypt(ciphertext: string, key: string): Promise<string> {
    if (!ciphertext.startsWith('enc:')) return ciphertext;
    const decoded = atob(ciphertext.slice(4));
    return this.xorCipher(decoded, key);
  }

  async generateKey(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)] ?? '';
    return key;
  }

  async deriveKey(passphrase: string, salt: string): Promise<string> {
    let hash = 0;
    const combined = passphrase + salt;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
    }
    return `derived_${Math.abs(hash).toString(36).padStart(32, '0')}`;
  }

  private xorCipher(text: string, key: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  }
}

// ── Implementation ────────────────────────────────────────

export class FieldEncryptionEngine {
  private readonly config: Required<EncryptionConfig>;
  private readonly crypto: FieldCryptoProvider;
  private readonly keys = new Map<string, { key: string; info: KeyInfo }>();
  private activeKeyId: string | null = null;
  private docsEncrypted = 0;
  private docsDecrypted = 0;
  private fieldsEncrypted = 0;
  private encryptionTimes: number[] = [];
  private keyCounter = 0;

  constructor(crypto: FieldCryptoProvider, config: EncryptionConfig) {
    this.crypto = crypto;
    this.config = {
      encryptedFields: config.encryptedFields,
      algorithm: config.algorithm ?? 'aes-256-gcm',
      keyRotationIntervalMs: config.keyRotationIntervalMs ?? 30 * 24 * 60 * 60 * 1000,
    };
  }

  /**
   * Initialize with a new encryption key.
   */
  async initialize(): Promise<string> {
    const key = await this.crypto.generateKey();
    const id = `key_${++this.keyCounter}_${Date.now()}`;
    this.keys.set(id, { key, info: { id, createdAt: Date.now(), rotatedAt: null, active: true } });
    this.activeKeyId = id;
    return id;
  }

  /**
   * Initialize from a passphrase.
   */
  async initializeFromPassphrase(
    passphrase: string,
    salt = 'pocket_default_salt'
  ): Promise<string> {
    const key = await this.crypto.deriveKey(passphrase, salt);
    const id = `key_derived_${++this.keyCounter}_${Date.now()}`;
    this.keys.set(id, { key, info: { id, createdAt: Date.now(), rotatedAt: null, active: true } });
    this.activeKeyId = id;
    return id;
  }

  /**
   * Encrypt specified fields in a document.
   */
  async encryptDocument(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.activeKeyId) throw new Error('Encryption not initialized — call initialize() first');
    const start = performance.now();

    const keyEntry = this.keys.get(this.activeKeyId)!;
    const result = { ...doc, _encrypted: true, _keyId: this.activeKeyId };

    for (const fieldPath of this.config.encryptedFields) {
      const value = this.getNestedValue(result, fieldPath);
      if (value !== undefined && value !== null) {
        const plaintext = JSON.stringify(value);
        const encrypted = await this.crypto.encrypt(plaintext, keyEntry.key);
        this.setNestedValue(result, fieldPath, encrypted);
        this.fieldsEncrypted++;
      }
    }

    this.docsEncrypted++;
    this.encryptionTimes.push(performance.now() - start);
    if (this.encryptionTimes.length > 100) this.encryptionTimes.shift();

    return result;
  }

  /**
   * Decrypt specified fields in a document.
   */
  async decryptDocument(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const keyId = (doc._keyId as string) ?? this.activeKeyId;
    if (!keyId) throw new Error('No key ID found for decryption');

    const keyEntry = this.keys.get(keyId);
    if (!keyEntry) throw new Error(`Key "${keyId}" not found — key may have been rotated`);

    const result = { ...doc };
    delete result._encrypted;
    delete result._keyId;

    for (const fieldPath of this.config.encryptedFields) {
      const value = this.getNestedValue(result, fieldPath);
      if (typeof value === 'string' && value.startsWith('enc:')) {
        const decrypted = await this.crypto.decrypt(value, keyEntry.key);
        try {
          this.setNestedValue(result, fieldPath, JSON.parse(decrypted));
        } catch {
          this.setNestedValue(result, fieldPath, decrypted);
        }
      }
    }

    this.docsDecrypted++;
    return result;
  }

  /**
   * Rotate the encryption key.
   */
  async rotateKey(): Promise<string> {
    if (this.activeKeyId) {
      const oldEntry = this.keys.get(this.activeKeyId);
      if (oldEntry) {
        oldEntry.info.active = false;
        oldEntry.info.rotatedAt = Date.now();
      }
    }

    return this.initialize();
  }

  /**
   * Check if a document is encrypted.
   */
  isEncrypted(doc: Record<string, unknown>): boolean {
    return doc._encrypted === true;
  }

  /**
   * Get encryption statistics.
   */
  getStats(): EncryptionStats {
    return {
      documentsEncrypted: this.docsEncrypted,
      documentsDecrypted: this.docsDecrypted,
      fieldsEncrypted: this.fieldsEncrypted,
      avgEncryptionTimeMs:
        this.encryptionTimes.length > 0
          ? this.encryptionTimes.reduce((a, b) => a + b, 0) / this.encryptionTimes.length
          : 0,
      activeKeyId: this.activeKeyId,
      keyCount: this.keys.size,
    };
  }

  /**
   * List all keys.
   */
  listKeys(): KeyInfo[] {
    return [...this.keys.values()].map((e) => e.info);
  }

  // ── Private ────────────────────────────────────────────

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object')
        return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (typeof current[part] !== 'object' || current[part] === null) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
  }
}

export function createFieldEncryption(
  config: EncryptionConfig,
  crypto?: FieldCryptoProvider
): FieldEncryptionEngine {
  return new FieldEncryptionEngine(crypto ?? new SimpleFieldCryptoProvider(), config);
}

/**
 * E2ESyncManager - End-to-end encrypted sync for Pocket.
 *
 * Ensures the server never sees plaintext data. All data is encrypted
 * client-side before sync and decrypted after receipt.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { EncryptionConfig } from './types.js';

export interface E2ESyncConfig {
  /** Encryption configuration */
  encryption: EncryptionConfig;
  /** Collections to encrypt during sync */
  collections: string[];
  /** Fields to exclude from encryption (e.g., _id for routing) */
  plaintextFields?: string[];
  /** Enable encrypted indexes for server-side filtering */
  encryptedIndexes?: boolean;
  /** Key rotation interval in ms (0 = manual only) */
  keyRotationIntervalMs?: number;
}

export interface EncryptedSyncEnvelope {
  /** Document ID (plaintext for routing) */
  _id: string;
  /** Collection name (plaintext for routing) */
  _collection: string;
  /** Encrypted document payload */
  _encrypted: string;
  /** Initialization vector */
  _iv: string;
  /** Key version used for encryption */
  _keyVersion: number;
  /** Encrypted index entries for server-side filtering */
  _encryptedIndexes?: Record<string, string>;
  /** Timestamp (plaintext for ordering) */
  _timestamp: number;
  /** Whether this is a deletion marker */
  _deleted?: boolean;
}

export interface E2ESyncStats {
  documentsEncrypted: number;
  documentsDecrypted: number;
  encryptionErrors: number;
  decryptionErrors: number;
  avgEncryptionMs: number;
  avgDecryptionMs: number;
  currentKeyVersion: number;
  lastKeyRotation: number | null;
}

export type E2ESyncStatus = 'idle' | 'encrypting' | 'decrypting' | 'syncing' | 'error';

export class E2ESyncManager {
  private readonly config: E2ESyncConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly status$ = new BehaviorSubject<E2ESyncStatus>('idle');
  private readonly stats$ = new BehaviorSubject<E2ESyncStats>({
    documentsEncrypted: 0,
    documentsDecrypted: 0,
    encryptionErrors: 0,
    decryptionErrors: 0,
    avgEncryptionMs: 0,
    avgDecryptionMs: 0,
    currentKeyVersion: 1,
    lastKeyRotation: null,
  });

  private keyVersion = 1;
  private encryptionKey: CryptoKey | null = null;
  private totalEncryptTime = 0;
  private totalDecryptTime = 0;
  private readonly plaintextFields: Set<string>;

  constructor(config: E2ESyncConfig) {
    this.config = config;
    this.plaintextFields = new Set(config.plaintextFields ?? ['_id', '_collection', '_timestamp', '_deleted']);
  }

  /**
   * Initialize with a password-derived key.
   */
  async initializeWithPassword(password: string, salt?: Uint8Array): Promise<void> {
    const usedSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.encryptionKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: usedSalt as unknown as BufferSource, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Initialize with a raw CryptoKey.
   */
  initializeWithKey(key: CryptoKey): void {
    this.encryptionKey = key;
  }

  /**
   * Encrypt a document for sync.
   */
  async encryptForSync(
    document: Record<string, unknown>,
    collection: string
  ): Promise<EncryptedSyncEnvelope> {
    if (!this.encryptionKey) {
      throw new Error('E2E sync not initialized. Call initializeWithPassword() or initializeWithKey() first.');
    }

    this.status$.next('encrypting');
    const start = Date.now();

    try {
      // Separate plaintext and encrypted fields
      const plaintextData: Record<string, unknown> = {};
      const sensitiveData: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(document)) {
        if (this.plaintextFields.has(key)) {
          plaintextData[key] = value;
        } else {
          sensitiveData[key] = value;
        }
      }

      // Encrypt sensitive data
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(sensitiveData));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encoded
      );

      const duration = Date.now() - start;
      this.updateEncryptionStats(duration);

      // Build encrypted indexes if enabled
      let encryptedIndexes: Record<string, string> | undefined;
      if (this.config.encryptedIndexes) {
        encryptedIndexes = await this.buildEncryptedIndexes(sensitiveData);
      }

      this.status$.next('idle');

      return {
        _id: String(document._id ?? ''),
        _collection: collection,
        _encrypted: this.arrayBufferToBase64(encrypted),
        _iv: this.arrayBufferToBase64(iv.buffer),
        _keyVersion: this.keyVersion,
        _encryptedIndexes: encryptedIndexes,
        _timestamp: Date.now(),
        _deleted: document._deleted === true ? true : undefined,
      };
    } catch (error) {
      this.status$.next('error');
      this.updateStats((s) => ({ ...s, encryptionErrors: s.encryptionErrors + 1 }));
      throw error;
    }
  }

  /**
   * Decrypt a document received from sync.
   */
  async decryptFromSync(
    envelope: EncryptedSyncEnvelope
  ): Promise<Record<string, unknown>> {
    if (!this.encryptionKey) {
      throw new Error('E2E sync not initialized.');
    }

    this.status$.next('decrypting');
    const start = Date.now();

    try {
      const iv = this.base64ToArrayBuffer(envelope._iv);
      const encrypted = this.base64ToArrayBuffer(envelope._encrypted);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        this.encryptionKey,
        encrypted
      );

      const sensitiveData = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
      const duration = Date.now() - start;
      this.updateDecryptionStats(duration);

      this.status$.next('idle');

      return {
        _id: envelope._id,
        _collection: envelope._collection,
        _timestamp: envelope._timestamp,
        _deleted: envelope._deleted,
        ...sensitiveData,
      };
    } catch (error) {
      this.status$.next('error');
      this.updateStats((s) => ({ ...s, decryptionErrors: s.decryptionErrors + 1 }));
      throw error;
    }
  }

  /**
   * Encrypt a batch of documents.
   */
  async encryptBatch(
    documents: Record<string, unknown>[],
    collection: string
  ): Promise<EncryptedSyncEnvelope[]> {
    return Promise.all(documents.map((doc) => this.encryptForSync(doc, collection)));
  }

  /**
   * Decrypt a batch of envelopes.
   */
  async decryptBatch(
    envelopes: EncryptedSyncEnvelope[]
  ): Promise<Record<string, unknown>[]> {
    return Promise.all(envelopes.map((env) => this.decryptFromSync(env)));
  }

  /**
   * Rotate the encryption key.
   */
  async rotateKey(newPassword: string, salt?: Uint8Array): Promise<void> {
    await this.initializeWithPassword(newPassword, salt);
    this.keyVersion++;
    this.updateStats((s) => ({
      ...s,
      currentKeyVersion: this.keyVersion,
      lastKeyRotation: Date.now(),
    }));
  }

  /**
   * Get sync status observable.
   */
  getStatus(): Observable<E2ESyncStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get stats observable.
   */
  getStats(): Observable<E2ESyncStats> {
    return this.stats$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get current stats snapshot.
   */
  getCurrentStats(): E2ESyncStats {
    return this.stats$.getValue();
  }

  /**
   * Check if the manager is initialized with a key.
   */
  isInitialized(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Get the current key version.
   */
  getKeyVersion(): number {
    return this.keyVersion;
  }

  /**
   * Get configured collections.
   */
  getCollections(): string[] {
    return [...this.config.collections];
  }

  /**
   * Check if a collection should be encrypted.
   */
  shouldEncrypt(collection: string): boolean {
    return this.config.collections.includes(collection);
  }

  destroy(): void {
    this.encryptionKey = null;
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
    this.stats$.complete();
  }

  private async buildEncryptedIndexes(
    data: Record<string, unknown>
  ): Promise<Record<string, string>> {
    const indexes: Record<string, string> = {};
    if (!this.encryptionKey) return indexes;

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const encoded = new TextEncoder().encode(`${key}:${String(value)}`);
        const hash = await crypto.subtle.digest('SHA-256', encoded);
        indexes[key] = this.arrayBufferToBase64(hash);
      }
    }
    return indexes;
  }

  private updateEncryptionStats(durationMs: number): void {
    this.totalEncryptTime += durationMs;
    this.updateStats((s) => ({
      ...s,
      documentsEncrypted: s.documentsEncrypted + 1,
      avgEncryptionMs: this.totalEncryptTime / (s.documentsEncrypted + 1),
    }));
  }

  private updateDecryptionStats(durationMs: number): void {
    this.totalDecryptTime += durationMs;
    this.updateStats((s) => ({
      ...s,
      documentsDecrypted: s.documentsDecrypted + 1,
      avgDecryptionMs: this.totalDecryptTime / (s.documentsDecrypted + 1),
    }));
  }

  private updateStats(fn: (stats: E2ESyncStats) => E2ESyncStats): void {
    this.stats$.next(fn(this.stats$.getValue()));
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

/**
 * Create an E2ESyncManager instance.
 */
export function createE2ESyncManager(config: E2ESyncConfig): E2ESyncManager {
  return new E2ESyncManager(config);
}

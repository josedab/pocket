import type { ChangeEvent, Collection, Document } from '@pocket/core';
import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { DocumentEncryptor } from './document-encryptor.js';
import { createKeyManager, type WebCryptoKeyManager } from './key-manager.js';
import type {
  EncryptedCollectionConfig,
  EncryptedDocument,
  EncryptionConfig,
  EncryptionEvent,
  EncryptionKey,
  KeyRotationInfo,
} from './types.js';

/**
 * Encrypted collection state
 */
export interface EncryptedCollectionState {
  /** Whether encryption is initialized */
  initialized: boolean;
  /** Current key ID */
  currentKeyId: string | null;
  /** Number of encrypted documents */
  encryptedCount: number;
  /** Key rotation info */
  keyRotation: KeyRotationInfo | null;
}

/**
 * Wraps a Pocket collection with encryption capabilities
 */
export class EncryptedCollection<T extends Document = Document> {
  private readonly collection: Collection<T>;
  private readonly encryptor: DocumentEncryptor;
  private readonly keyManager: WebCryptoKeyManager;
  private readonly config: EncryptedCollectionConfig;

  private readonly state$ = new BehaviorSubject<EncryptedCollectionState>({
    initialized: false,
    currentKeyId: null,
    encryptedCount: 0,
    keyRotation: null,
  });

  private changeSubscription: Subscription | null = null;
  private keyRotationTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(collection: Collection<T>, config: EncryptedCollectionConfig) {
    this.collection = collection;
    this.config = config;
    this.keyManager = createKeyManager() as WebCryptoKeyManager;
    this.encryptor = new DocumentEncryptor(config.encryption, this.keyManager);
  }

  /**
   * Initialize encryption with a password
   */
  async initializeWithPassword(password: string): Promise<void> {
    const key = await this.keyManager.deriveKey(password, this.config.encryption.keyConfig);
    this.encryptor.setCurrentKey(key.keyId);

    this.updateState({
      initialized: true,
      currentKeyId: key.keyId,
      keyRotation: this.createKeyRotationInfo(key.keyId),
    });

    if (this.config.autoKeyRotation && this.config.keyRotationInterval) {
      this.startKeyRotationTimer();
    }
  }

  /**
   * Initialize encryption with an existing key
   */
  async initializeWithKey(exportedKey: string): Promise<void> {
    const key = await this.keyManager.importKey(exportedKey, this.config.encryption.algorithm);
    this.encryptor.setCurrentKey(key.keyId);

    this.updateState({
      initialized: true,
      currentKeyId: key.keyId,
      keyRotation: this.createKeyRotationInfo(key.keyId),
    });

    if (this.config.autoKeyRotation && this.config.keyRotationInterval) {
      this.startKeyRotationTimer();
    }
  }

  /**
   * Export the current key for backup
   */
  async exportCurrentKey(): Promise<string> {
    const keyId = this.encryptor.getCurrentKeyId();
    if (!keyId) {
      throw new Error('No encryption key set');
    }

    const key = this.keyManager.getKey(keyId);
    if (!key) {
      throw new Error('Key not found');
    }

    return this.keyManager.exportKey(key);
  }

  /**
   * Insert an encrypted document
   */
  async insert(doc: Omit<T, '_id' | '_rev' | '_createdAt' | '_updatedAt' | '_nodeId'>): Promise<T> {
    this.ensureInitialized();

    // First insert unencrypted to get system fields populated
    const inserted = await this.collection.insert(doc as T);

    // Now encrypt the document
    const encrypted = await this.encryptor.encrypt(inserted);

    // Store the encrypted version (this replaces the original)
    await this.collection.update(inserted._id, encrypted as unknown as Partial<T>);

    this.incrementEncryptedCount();
    return inserted;
  }

  /**
   * Get and decrypt a document by ID
   */
  async get(id: string): Promise<T | null> {
    this.ensureInitialized();

    const doc = await this.collection.get(id);
    if (!doc) {
      return null;
    }

    if (this.encryptor.isEncrypted(doc as unknown as Document)) {
      return this.encryptor.decrypt<T>(doc as unknown as EncryptedDocument);
    }

    return doc;
  }

  /**
   * Get and decrypt multiple documents
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    this.ensureInitialized();

    const docs = await this.collection.getMany(ids);
    const results: (T | null)[] = [];

    for (const doc of docs) {
      if (!doc) {
        results.push(null);
        continue;
      }

      if (this.encryptor.isEncrypted(doc as unknown as Document)) {
        results.push(await this.encryptor.decrypt<T>(doc as unknown as EncryptedDocument));
      } else {
        results.push(doc);
      }
    }

    return results;
  }

  /**
   * Get and decrypt all documents
   */
  async getAll(): Promise<T[]> {
    this.ensureInitialized();

    const docs = await this.collection.getAll();
    const results: T[] = [];

    for (const doc of docs) {
      if (this.encryptor.isEncrypted(doc as unknown as Document)) {
        results.push(await this.encryptor.decrypt<T>(doc as unknown as EncryptedDocument));
      } else {
        results.push(doc);
      }
    }

    return results;
  }

  /**
   * Update and re-encrypt a document
   */
  async update(id: string, changes: Partial<T>): Promise<T> {
    this.ensureInitialized();

    // Get and decrypt the current document
    const current = await this.get(id);
    if (!current) {
      throw new Error(`Document not found: ${id}`);
    }

    // Merge changes
    const updated = { ...current, ...changes } as T;

    // Encrypt and store
    const encrypted = await this.encryptor.encrypt(updated);
    await this.collection.update(id, encrypted as unknown as Partial<T>);

    return updated;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    await this.collection.delete(id);
  }

  /**
   * Encrypt all unencrypted documents in the collection
   */
  async encryptAll(): Promise<{ encrypted: number; failed: number }> {
    this.ensureInitialized();

    const docs = await this.collection.getAll();
    let encrypted = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        if (!this.encryptor.isEncrypted(doc as unknown as Document)) {
          const encryptedDoc = await this.encryptor.encrypt(doc);
          await this.collection.update(doc._id, encryptedDoc as unknown as Partial<T>);
          encrypted++;
        }
      } catch {
        failed++;
      }
    }

    this.updateState({ encryptedCount: encrypted });
    return { encrypted, failed };
  }

  /**
   * Rotate encryption key
   */
  async rotateKey(newPassword?: string): Promise<void> {
    this.ensureInitialized();

    // Generate or derive new key
    let newKey: EncryptionKey;
    if (newPassword) {
      newKey = await this.keyManager.deriveKey(newPassword, this.config.encryption.keyConfig);
    } else {
      newKey = await this.keyManager.generateKey(this.config.encryption.algorithm);
    }

    const oldKeyId = this.encryptor.getCurrentKeyId();

    // Re-encrypt all documents
    const docs = await this.collection.getAll();
    for (const doc of docs) {
      if (this.encryptor.isEncrypted(doc as unknown as Document)) {
        const reencrypted = await this.encryptor.reencrypt<T>(
          doc as unknown as EncryptedDocument,
          newKey.keyId,
          oldKeyId ?? undefined
        );
        await this.collection.update(doc._id, reencrypted as unknown as Partial<T>);
      }
    }

    // Switch to new key
    this.encryptor.setCurrentKey(newKey.keyId);

    this.updateState({
      currentKeyId: newKey.keyId,
      keyRotation: this.createKeyRotationInfo(newKey.keyId, oldKeyId),
    });
  }

  /**
   * Get encryption events
   */
  events(): Observable<EncryptionEvent> {
    return this.encryptor.events();
  }

  /**
   * Get collection state
   */
  state(): Observable<EncryptedCollectionState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state
   */
  getState(): EncryptedCollectionState {
    return this.state$.getValue();
  }

  /**
   * Get the underlying collection
   */
  getCollection(): Collection<T> {
    return this.collection;
  }

  /**
   * Get the encryption config
   */
  getEncryptionConfig(): EncryptionConfig {
    return this.config.encryption;
  }

  /**
   * Observe changes (decrypted)
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.collection.changes().pipe(
      map((event: ChangeEvent<T>) => {
        // Note: For full decryption, you'd need to use switchMap or similar
        // This is a simplified version that returns the raw event
        return event;
      })
    );
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.isDisposed = true;

    if (this.changeSubscription) {
      this.changeSubscription.unsubscribe();
      this.changeSubscription = null;
    }

    if (this.keyRotationTimer) {
      clearTimeout(this.keyRotationTimer);
      this.keyRotationTimer = null;
    }

    this.encryptor.dispose();
    this.state$.complete();
  }

  /**
   * Ensure encryption is initialized
   */
  private ensureInitialized(): void {
    if (!this.state$.getValue().initialized) {
      throw new Error(
        'Encryption not initialized. Call initializeWithPassword() or initializeWithKey() first.'
      );
    }
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<EncryptedCollectionState>): void {
    this.state$.next({
      ...this.state$.getValue(),
      ...partial,
    });
  }

  /**
   * Increment encrypted count
   */
  private incrementEncryptedCount(): void {
    const current = this.state$.getValue();
    this.updateState({ encryptedCount: current.encryptedCount + 1 });
  }

  /**
   * Create key rotation info
   */
  private createKeyRotationInfo(
    currentKeyId: string,
    previousKeyId?: string | null
  ): KeyRotationInfo {
    const now = Date.now();
    const rotateAfter = this.config.keyRotationInterval
      ? now + this.config.keyRotationInterval
      : now + 90 * 24 * 60 * 60 * 1000; // 90 days default

    return {
      currentKeyId,
      previousKeyIds: previousKeyId ? [previousKeyId] : [],
      keyCreatedAt: now,
      rotateAfter,
    };
  }

  /**
   * Start key rotation timer
   */
  private startKeyRotationTimer(): void {
    if (this.keyRotationTimer) {
      clearTimeout(this.keyRotationTimer);
    }

    if (!this.config.keyRotationInterval) {
      return;
    }

    this.keyRotationTimer = setTimeout(() => {
      if (this.isDisposed) return;

      void (async () => {
        try {
          await this.rotateKey();
          this.startKeyRotationTimer(); // Schedule next rotation
        } catch (error) {
          console.error('Key rotation failed:', error);
        }
      })();
    }, this.config.keyRotationInterval);
  }
}

/**
 * Create an encrypted collection wrapper
 */
export function createEncryptedCollection<T extends Document>(
  collection: Collection<T>,
  config: EncryptedCollectionConfig
): EncryptedCollection<T> {
  return new EncryptedCollection(collection, config);
}

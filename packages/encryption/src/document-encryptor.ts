import type { Document } from '@pocket/core';
import { StorageError } from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import { bytesToString, compress, decompress, stringToBytes } from './crypto-utils.js';
import { getEncryptionProvider } from './encryption-provider.js';
import type { WebCryptoKeyManager } from './key-manager.js';
import type {
  DocumentEncryptionOptions,
  EncryptedDocument,
  EncryptedEnvelope,
  EncryptionConfig,
  EncryptionEvent,
  EncryptionKey,
  KeyManager,
} from './types.js';

/**
 * System fields that should never be encrypted
 */
const SYSTEM_FIELDS = [
  '_id',
  '_rev',
  '_deleted',
  '_createdAt',
  '_updatedAt',
  '_nodeId',
  '_encrypted',
  '_unencrypted',
];

/**
 * Document encryptor for encrypting/decrypting documents
 */
export class DocumentEncryptor {
  private readonly config: EncryptionConfig;
  private readonly keyManager: KeyManager;
  private readonly events$ = new Subject<EncryptionEvent>();
  private currentKeyId: string | null = null;

  constructor(config: EncryptionConfig, keyManager: KeyManager) {
    this.config = config;
    this.keyManager = keyManager;
  }

  /**
   * Set the current encryption key
   */
  setCurrentKey(keyId: string): void {
    const key = this.keyManager.getKey(keyId);
    if (!key) {
      throw new StorageError('POCKET_S300', `Key not found: ${keyId}`, { keyId });
    }
    this.currentKeyId = keyId;
  }

  /**
   * Get the current key ID
   */
  getCurrentKeyId(): string | null {
    return this.currentKeyId;
  }

  /**
   * Encrypt a document
   */
  async encrypt(doc: Document, options?: DocumentEncryptionOptions): Promise<EncryptedDocument> {
    const keyId = options?.keyId ?? this.currentKeyId;
    if (!keyId) {
      throw new StorageError('POCKET_S300', 'No encryption key set', { operation: 'encrypt' });
    }

    const key = this.keyManager.getKey(keyId);
    if (!key) {
      throw new StorageError('POCKET_S300', `Key not found: ${keyId}`, { keyId });
    }

    const { toEncrypt, unencrypted } = this.splitDocument(doc, options?.fields);

    // Serialize the data to encrypt
    let data = stringToBytes(JSON.stringify(toEncrypt));

    // Optionally compress
    if (this.config.compress) {
      data = await compress(data);
    }

    // Encrypt
    const provider = getEncryptionProvider(this.config.algorithm);
    const envelope = await provider.encrypt(data, key);

    if (this.config.compress) {
      envelope.compressed = true;
    }

    // Emit event
    this.emitEvent({
      type: 'document:encrypted',
      keyId,
      documentId: doc._id,
      timestamp: Date.now(),
    });

    // Build encrypted document
    const encryptedDoc: EncryptedDocument = {
      _id: doc._id,
      _rev: doc._rev,
      _deleted: doc._deleted,
      _updatedAt: doc._updatedAt,
      _encrypted: envelope,
    };

    if (Object.keys(unencrypted).length > 0) {
      encryptedDoc._unencrypted = unencrypted;
    }

    return encryptedDoc;
  }

  /**
   * Decrypt a document
   */
  async decrypt<T extends Document>(encryptedDoc: EncryptedDocument, keyId?: string): Promise<T> {
    const envelope = encryptedDoc._encrypted;
    if (!envelope) {
      throw new StorageError('POCKET_S300', 'Document is not encrypted', {
        documentId: encryptedDoc._id,
      });
    }

    // Try provided key, then try to find the right key
    const key = this.findDecryptionKey(envelope, keyId);
    if (!key) {
      throw new StorageError('POCKET_S300', 'No valid decryption key found', {
        documentId: encryptedDoc._id,
        algorithm: envelope.algorithm,
      });
    }

    // Decrypt
    const provider = getEncryptionProvider(envelope.algorithm);
    let data = await provider.decrypt(envelope, key);

    // Optionally decompress
    if (envelope.compressed) {
      data = await decompress(data);
    }

    // Parse the decrypted data
    const decrypted = JSON.parse(bytesToString(data)) as Record<string, unknown>;

    // Merge back with unencrypted fields
    const result = {
      _id: encryptedDoc._id,
      _rev: encryptedDoc._rev,
      _deleted: encryptedDoc._deleted,
      _updatedAt: encryptedDoc._updatedAt,
      ...encryptedDoc._unencrypted,
      ...decrypted,
    } as unknown as T;

    // Emit event
    this.emitEvent({
      type: 'document:decrypted',
      keyId: key.keyId,
      documentId: encryptedDoc._id,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Re-encrypt a document with a new key
   */
  async reencrypt(
    encryptedDoc: EncryptedDocument,
    newKeyId: string,
    oldKeyId?: string
  ): Promise<EncryptedDocument> {
    // Decrypt with old key
    const decrypted = await this.decrypt(encryptedDoc, oldKeyId);

    // Encrypt with new key
    return this.encrypt(decrypted, { keyId: newKeyId });
  }

  /**
   * Check if a document is encrypted
   */
  isEncrypted(doc: Document): doc is EncryptedDocument {
    return '_encrypted' in doc && doc._encrypted !== undefined;
  }

  /**
   * Get encryption events observable
   */
  events(): Observable<EncryptionEvent> {
    return this.events$.asObservable();
  }

  /**
   * Split a document into encrypted and unencrypted parts
   */
  private splitDocument(
    doc: Document,
    fieldsToEncrypt?: string[]
  ): {
    toEncrypt: Record<string, unknown>;
    unencrypted: Record<string, unknown>;
  } {
    const toEncrypt: Record<string, unknown> = {};
    const unencrypted: Record<string, unknown> = {};

    // Determine which fields to encrypt
    const encryptFields = new Set(fieldsToEncrypt ?? this.config.encryptedFields);
    const excludeFields = new Set(this.config.excludedFields ?? []);

    for (const [key, value] of Object.entries(doc)) {
      // Skip system fields
      if (SYSTEM_FIELDS.includes(key)) {
        continue;
      }

      // Check if field should be encrypted
      const shouldEncrypt =
        encryptFields.size > 0 ? encryptFields.has(key) : !excludeFields.has(key);

      if (shouldEncrypt) {
        toEncrypt[key] = value;
      } else {
        unencrypted[key] = value;
      }
    }

    return { toEncrypt, unencrypted };
  }

  /**
   * Find a valid decryption key
   */
  private findDecryptionKey(
    envelope: EncryptedEnvelope,
    preferredKeyId?: string
  ): EncryptionKey | null {
    // Try preferred key first
    if (preferredKeyId) {
      const key = this.keyManager.getKey(preferredKeyId);
      if (key?.algorithm === envelope.algorithm) {
        return key;
      }
    }

    // Try current key
    if (this.currentKeyId) {
      const key = this.keyManager.getKey(this.currentKeyId);
      if (key?.algorithm === envelope.algorithm) {
        return key;
      }
    }

    // Try all stored keys
    const allKeyIds = (this.keyManager as WebCryptoKeyManager).getKeyIds?.() ?? [];
    for (const keyId of allKeyIds) {
      const key = this.keyManager.getKey(keyId);
      if (key?.algorithm === envelope.algorithm) {
        return key;
      }
    }

    return null;
  }

  /**
   * Emit an encryption event
   */
  private emitEvent(event: EncryptionEvent): void {
    this.events$.next(event);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.events$.complete();
  }
}

/**
 * Create a document encryptor
 */
export function createDocumentEncryptor(
  config: EncryptionConfig,
  keyManager: KeyManager
): DocumentEncryptor {
  return new DocumentEncryptor(config, keyManager);
}

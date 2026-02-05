/**
 * EncryptedIndexManager - Deterministic encryption for indexing.
 *
 * Provides deterministic encryption using HMAC so that equality queries
 * can be performed on encrypted data without revealing plaintext values.
 *
 * **Limitation:** Only equality queries are supported. Range queries, prefix
 * matching, and ordering are not possible with deterministic encryption.
 *
 * @module @pocket/encryption
 */

/**
 * A single encrypted index entry mapping encrypted value to document IDs.
 */
export interface EncryptedIndexEntry {
  /** The deterministically encrypted field value */
  encryptedValue: string;
  /** Document IDs that match this value */
  documentIds: string[];
}

/**
 * An encrypted index for a collection field.
 */
export interface EncryptedIndex {
  /** Collection name */
  collection: string;
  /** Field name */
  field: string;
  /** Index entries */
  entries: Map<string, EncryptedIndexEntry>;
}

/**
 * EncryptedIndexManager manages deterministic encryption for indexed fields.
 *
 * Uses HMAC-SHA256 to produce consistent ciphertext for the same input,
 * enabling equality lookups on encrypted data.
 *
 * **Note:** Only equality queries are supported. Range queries, prefix
 * matching, and ordering cannot be performed on deterministically encrypted
 * values. This is an inherent limitation of deterministic encryption.
 */
export class EncryptedIndexManager {
  private readonly indexes = new Map<string, EncryptedIndex>();

  /**
   * Deterministically encrypt a value for indexing.
   *
   * Always produces the same ciphertext for the same (value, key) pair,
   * using HMAC-SHA256. This allows equality comparisons without
   * revealing the plaintext.
   *
   * @param value - The plaintext value to encrypt
   * @param key - The encryption key (used as HMAC key)
   * @returns The deterministically encrypted value as a base64 string
   */
  async encryptForIndex(value: string, key: string): Promise<string> {
    const encoder = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      hmacKey,
      encoder.encode(value)
    );

    return this.arrayBufferToBase64(signature);
  }

  /**
   * Create an encrypted index for a collection field.
   *
   * Indexes the provided documents by deterministically encrypting
   * the specified field value and mapping it to document IDs.
   *
   * @param collection - Collection name
   * @param field - Field name to index
   * @param encryptionKey - Key used for deterministic encryption
   * @param documents - Documents to index
   */
  async createIndex(
    collection: string,
    field: string,
    encryptionKey: string,
    documents?: { _id: string; [key: string]: unknown }[]
  ): Promise<EncryptedIndex> {
    const indexKey = `${collection}:${field}`;
    const entries = new Map<string, EncryptedIndexEntry>();

    if (documents) {
      for (const doc of documents) {
        const fieldValue = doc[field];
        if (fieldValue === undefined || fieldValue === null) continue;

        const encrypted = await this.encryptForIndex(String(fieldValue), encryptionKey);

        const existing = entries.get(encrypted);
        if (existing) {
          existing.documentIds.push(doc._id);
        } else {
          entries.set(encrypted, {
            encryptedValue: encrypted,
            documentIds: [doc._id],
          });
        }
      }
    }

    const index: EncryptedIndex = { collection, field, entries };
    this.indexes.set(indexKey, index);
    return index;
  }

  /**
   * Query an encrypted index for documents matching an encrypted value.
   *
   * Only equality queries are supported — the encrypted value must match
   * exactly. Range queries are not possible with deterministic encryption.
   *
   * @param collection - Collection name
   * @param field - Indexed field name
   * @param encryptedValue - The deterministically encrypted value to look up
   * @returns Array of matching document IDs
   */
  queryIndex(collection: string, field: string, encryptedValue: string): string[] {
    const indexKey = `${collection}:${field}`;
    const index = this.indexes.get(indexKey);

    if (!index) {
      return [];
    }

    const entry = index.entries.get(encryptedValue);
    return entry ? [...entry.documentIds] : [];
  }

  /**
   * Rebuild an encrypted index for a collection field.
   *
   * Use this after key rotation to re-encrypt all index entries
   * with a new key.
   *
   * @param collection - Collection name
   * @param field - Field name to re-index
   * @param encryptionKey - New encryption key
   * @param documents - Documents to re-index
   */
  async rebuildIndex(
    collection: string,
    field: string,
    encryptionKey: string,
    documents: { _id: string; [key: string]: unknown }[]
  ): Promise<EncryptedIndex> {
    const indexKey = `${collection}:${field}`;
    this.indexes.delete(indexKey);
    return this.createIndex(collection, field, encryptionKey, documents);
  }

  /**
   * Check whether an index exists for a collection field.
   */
  hasIndex(collection: string, field: string): boolean {
    return this.indexes.has(`${collection}:${field}`);
  }

  /**
   * Remove an index.
   */
  removeIndex(collection: string, field: string): void {
    this.indexes.delete(`${collection}:${field}`);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
}

/**
 * Create an EncryptedIndexManager instance.
 */
export function createEncryptedIndexManager(): EncryptedIndexManager {
  return new EncryptedIndexManager();
}

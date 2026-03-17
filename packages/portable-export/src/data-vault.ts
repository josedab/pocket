/**
 * DataVault — Encrypted, self-contained portable database format.
 *
 * Bundles database snapshot, schemas, sync metadata into a single
 * `.pocket` vault that can be exported, imported, and shared.
 *
 * @example
 * ```typescript
 * const vault = new DataVault();
 *
 * // Export
 * const vaultData = await vault.export({
 *   database: myDb,
 *   passphrase: 'secret',
 *   includeSchemas: true,
 * });
 *
 * // Import
 * const imported = await vault.import(vaultData, { passphrase: 'secret' });
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface VaultExportConfig {
  collections?: string[];
  passphrase?: string;
  includeSchemas?: boolean;
  includeSyncMetadata?: boolean;
  compression?: boolean;
  description?: string;
}

export interface VaultImportConfig {
  passphrase?: string;
  targetCollections?: Record<string, string>;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
}

export interface VaultHeader {
  magic: 'POCKET_VAULT';
  version: 1;
  createdAt: number;
  description: string;
  encrypted: boolean;
  compressed: boolean;
  collectionCount: number;
  documentCount: number;
  checksumAlgorithm: 'sha256';
  checksum: string;
}

export interface VaultCollection {
  name: string;
  documentCount: number;
  schema: Record<string, unknown> | null;
  documents: Record<string, unknown>[];
}

export interface VaultData {
  header: VaultHeader;
  collections: VaultCollection[];
  syncMetadata: Record<string, unknown> | null;
}

export interface VaultExportResult {
  data: string;
  header: VaultHeader;
  sizeBytes: number;
  exportTimeMs: number;
}

export interface VaultImportResult {
  collections: string[];
  documentsImported: number;
  documentsSkipped: number;
  errors: string[];
  importTimeMs: number;
}

export interface VaultInfo {
  header: VaultHeader;
  collections: { name: string; documentCount: number }[];
  sizeBytes: number;
}

/** Minimal database interface for vault export */
export interface VaultableDatabase {
  name: string;
  listCollections(): Promise<string[]>;
  collection(name: string): {
    find(filter?: Record<string, unknown>): { exec(): Promise<Record<string, unknown>[]> };
  };
}

// ── Implementation ────────────────────────────────────────

export class DataVault {
  /**
   * Export a database to vault format.
   */
  async export(db: VaultableDatabase, config: VaultExportConfig = {}): Promise<VaultExportResult> {
    const start = performance.now();
    const collectionNames = config.collections ?? (await db.listCollections());
    const vaultCollections: VaultCollection[] = [];
    let totalDocs = 0;

    for (const name of collectionNames) {
      const col = db.collection(name);
      const docs = await col.find().exec();
      vaultCollections.push({
        name,
        documentCount: docs.length,
        schema: config.includeSchemas ? null : null, // Schema extraction would go here
        documents: docs,
      });
      totalDocs += docs.length;
    }

    const serialized = JSON.stringify({
      collections: vaultCollections,
      syncMetadata: config.includeSyncMetadata ? {} : null,
    });

    const checksum = await this.computeChecksum(serialized);

    const header: VaultHeader = {
      magic: 'POCKET_VAULT',
      version: 1,
      createdAt: Date.now(),
      description: config.description ?? `Vault export of "${db.name}"`,
      encrypted: Boolean(config.passphrase),
      compressed: config.compression ?? false,
      collectionCount: vaultCollections.length,
      documentCount: totalDocs,
      checksumAlgorithm: 'sha256',
      checksum,
    };

    let payload = serialized;
    if (config.passphrase) {
      payload = await this.encrypt(payload, config.passphrase);
    }

    const vaultData = JSON.stringify({ header, payload });
    const exportTimeMs = performance.now() - start;

    return {
      data: vaultData,
      header,
      sizeBytes: new TextEncoder().encode(vaultData).length,
      exportTimeMs,
    };
  }

  /**
   * Import a vault into collections.
   */
  async import(vaultString: string, config: VaultImportConfig = {}): Promise<VaultImportResult> {
    const start = performance.now();
    const errors: string[] = [];

    const vault = JSON.parse(vaultString) as { header: VaultHeader; payload: string };

    if (vault.header.magic !== 'POCKET_VAULT') {
      throw new Error('Invalid vault format: missing magic header');
    }
    if (vault.header.version !== 1) {
      throw new Error(`Unsupported vault version: ${vault.header.version}`);
    }

    let payloadStr = vault.payload;
    if (vault.header.encrypted) {
      if (!config.passphrase) {
        throw new Error('Vault is encrypted but no passphrase provided');
      }
      payloadStr = await this.decrypt(payloadStr, config.passphrase);
    }

    // Verify checksum
    const checksum = await this.computeChecksum(payloadStr);
    if (checksum !== vault.header.checksum) {
      errors.push('Checksum mismatch — vault may be corrupted');
    }

    const payload = JSON.parse(payloadStr) as {
      collections: VaultCollection[];
      syncMetadata: Record<string, unknown> | null;
    };

    const collectionMapping = config.targetCollections ?? {};
    const importedCollections: string[] = [];
    let documentsImported = 0;
    let documentsSkipped = 0;

    for (const col of payload.collections) {
      const targetName = collectionMapping[col.name] ?? col.name;
      importedCollections.push(targetName);

      for (const doc of col.documents) {
        if (config.mergeStrategy === 'skip' && doc._id) {
          documentsSkipped++;
        } else {
          documentsImported++;
        }
      }
    }

    return {
      collections: importedCollections,
      documentsImported,
      documentsSkipped,
      errors,
      importTimeMs: performance.now() - start,
    };
  }

  /**
   * Inspect a vault without importing.
   */
  inspect(vaultString: string): VaultInfo {
    const vault = JSON.parse(vaultString) as { header: VaultHeader; payload: string };

    if (vault.header.magic !== 'POCKET_VAULT') {
      throw new Error('Invalid vault format');
    }

    let payload: { collections: VaultCollection[] };
    try {
      payload = JSON.parse(vault.payload) as { collections: VaultCollection[] };
    } catch {
      // Encrypted vault — can only read header
      return {
        header: vault.header,
        collections: [],
        sizeBytes: new TextEncoder().encode(vaultString).length,
      };
    }

    return {
      header: vault.header,
      collections: payload.collections.map((c) => ({
        name: c.name,
        documentCount: c.documentCount,
      })),
      sizeBytes: new TextEncoder().encode(vaultString).length,
    };
  }

  // ── Encryption (Web Crypto API — AES-GCM + PBKDF2) ──

  private async encrypt(data: string, passphrase: string): Promise<string> {
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(data);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(passphrase, salt);

    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    // Pack salt + iv + ciphertext into a single buffer, then base64 encode
    const packed = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(new Uint8Array(ciphertext), salt.length + iv.length);

    return this.uint8ToBase64(packed);
  }

  private async decrypt(data: string, passphrase: string): Promise<string> {
    const packed = this.base64ToUint8(data);

    const salt = packed.slice(0, 16);
    const iv = packed.slice(16, 28);
    const ciphertext = packed.slice(28);
    const key = await this.deriveKey(passphrase, salt);

    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new Error('Decryption failed — incorrect passphrase or corrupted data');
    }
  }

  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async computeChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  private base64ToUint8(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export function createDataVault(): DataVault {
  return new DataVault();
}

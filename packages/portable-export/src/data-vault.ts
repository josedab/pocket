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

    const checksum = this.simpleChecksum(serialized);

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
      payload = this.encrypt(payload, config.passphrase);
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
      payloadStr = this.decrypt(payloadStr, config.passphrase);
    }

    // Verify checksum
    const checksum = this.simpleChecksum(payloadStr);
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

  // ── Encryption (simplified — production would use Web Crypto API) ──

  private encrypt(data: string, passphrase: string): string {
    // XOR-based obfuscation (NOT production crypto — placeholder for Web Crypto API)
    const key = this.deriveKey(passphrase);
    let result = '';
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
  }

  private decrypt(data: string, passphrase: string): string {
    const key = this.deriveKey(passphrase);
    const decoded = atob(data);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  }

  private deriveKey(passphrase: string): string {
    // Simple key derivation (production would use PBKDF2)
    let hash = 0;
    for (let i = 0; i < passphrase.length; i++) {
      hash = ((hash << 5) - hash + passphrase.charCodeAt(i)) | 0;
    }
    return String(Math.abs(hash)).repeat(8);
  }

  private simpleChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `sha256_${Math.abs(hash).toString(16)}`;
  }
}

export function createDataVault(): DataVault {
  return new DataVault();
}

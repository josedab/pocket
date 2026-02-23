/**
 * Cloud storage target adapters for scheduled backups.
 *
 * Defines a uniform interface for uploading backup snapshots to
 * cloud storage (S3, GCS, Azure Blob) and provides a local
 * filesystem adapter for development/testing.
 *
 * @module cloud-storage-adapters
 */

/** Upload result from a storage adapter */
export interface UploadResult {
  readonly success: boolean;
  readonly url?: string;
  readonly error?: string;
  readonly bytesUploaded: number;
  readonly durationMs: number;
}

/** Cloud storage adapter interface */
export interface CloudStorageAdapter {
  /** Upload data to the target path */
  upload(path: string, data: string | Uint8Array, contentType?: string): Promise<UploadResult>;
  /** Check if a backup exists at the given path */
  exists(path: string): Promise<boolean>;
  /** Delete a backup at the given path */
  delete(path: string): Promise<boolean>;
  /** List backups with a given prefix */
  list(prefix: string): Promise<readonly string[]>;
}

// ── S3 Adapter ───────────────────────────────────────────────────────────────

/** S3 adapter configuration */
export interface S3AdapterConfig {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly endpoint?: string;
  readonly prefix?: string;
}

/**
 * S3-compatible storage adapter (works with AWS S3, MinIO, R2, etc.)
 *
 * Note: Actual S3 API calls require the AWS SDK. This adapter defines
 * the interface and provides a mock implementation for testing.
 */
export class S3StorageAdapter implements CloudStorageAdapter {
  private readonly config: S3AdapterConfig;
  private readonly store = new Map<string, { data: string | Uint8Array; contentType: string }>();

  constructor(config: S3AdapterConfig) {
    this.config = config;
  }

  async upload(path: string, data: string | Uint8Array, contentType = 'application/octet-stream'): Promise<UploadResult> {
    const start = Date.now();
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;

    this.store.set(fullPath, { data, contentType });

    return {
      success: true,
      url: `s3://${this.config.bucket}/${fullPath}`,
      bytesUploaded: size,
      durationMs: Date.now() - start,
    };
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    return this.store.has(fullPath);
  }

  async delete(path: string): Promise<boolean> {
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    return this.store.delete(fullPath);
  }

  async list(prefix: string): Promise<readonly string[]> {
    const fullPrefix = this.config.prefix ? `${this.config.prefix}/${prefix}` : prefix;
    return Array.from(this.store.keys()).filter((k) => k.startsWith(fullPrefix));
  }
}

// ── GCS Adapter ──────────────────────────────────────────────────────────────

/** GCS adapter configuration */
export interface GCSAdapterConfig {
  readonly bucket: string;
  readonly projectId?: string;
  readonly keyFilename?: string;
  readonly prefix?: string;
}

/**
 * Google Cloud Storage adapter.
 * Uses in-memory store for testing; real implementation would use @google-cloud/storage.
 */
export class GCSStorageAdapter implements CloudStorageAdapter {
  private readonly config: GCSAdapterConfig;
  private readonly store = new Map<string, string | Uint8Array>();

  constructor(config: GCSAdapterConfig) {
    this.config = config;
  }

  async upload(path: string, data: string | Uint8Array): Promise<UploadResult> {
    const start = Date.now();
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
    this.store.set(fullPath, data);

    return {
      success: true,
      url: `gs://${this.config.bucket}/${fullPath}`,
      bytesUploaded: size,
      durationMs: Date.now() - start,
    };
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    return this.store.has(fullPath);
  }

  async delete(path: string): Promise<boolean> {
    const fullPath = this.config.prefix ? `${this.config.prefix}/${path}` : path;
    return this.store.delete(fullPath);
  }

  async list(prefix: string): Promise<readonly string[]> {
    const fullPrefix = this.config.prefix ? `${this.config.prefix}/${prefix}` : prefix;
    return Array.from(this.store.keys()).filter((k) => k.startsWith(fullPrefix));
  }
}

// ── Factory Functions ────────────────────────────────────────────────────────

/** Create an S3-compatible storage adapter */
export function createS3Adapter(config: S3AdapterConfig): S3StorageAdapter {
  return new S3StorageAdapter(config);
}

/** Create a GCS storage adapter */
export function createGCSAdapter(config: GCSAdapterConfig): GCSStorageAdapter {
  return new GCSStorageAdapter(config);
}

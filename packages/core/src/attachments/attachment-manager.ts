/**
 * Binary/blob attachment system for documents.
 *
 * Provides a storage-agnostic way to attach binary data (files, images, etc.)
 * to documents in any collection. The actual storage backend is injected via
 * the {@link AttachmentStore} interface.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Attachment {
  id: string;
  documentId: string;
  collection: string;
  name: string;
  mimeType: string;
  size: number;
  hash: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface AttachmentData {
  content: Uint8Array | string;
  mimeType: string;
  name: string;
}

export interface AttachmentStore {
  put(attachment: Attachment, data: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
  list(documentId: string): Promise<Attachment[]>;
  getUsage(): Promise<{ totalSize: number; count: number }>;
}

export interface AttachmentManagerConfig {
  maxSizeBytes?: number;
  maxAttachmentsPerDocument?: number;
  allowedMimeTypes?: string[];
}

export interface AttachmentStats {
  totalAttachments: number;
  totalSizeBytes: number;
  byCollection: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toUint8Array(content: Uint8Array | string): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  return content;
}

async function computeHash(data: Uint8Array): Promise<string> {
  // Simple FNV-1a 32-bit hash – fast, no crypto dependency
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// AttachmentManager
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<AttachmentManagerConfig> = {
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxAttachmentsPerDocument: 50,
  allowedMimeTypes: [],
};

export class AttachmentManager {
  private readonly store: AttachmentStore;
  private readonly config: Required<AttachmentManagerConfig>;

  constructor(store: AttachmentStore, config: AttachmentManagerConfig = {}) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Validate attachment data against the configured constraints. */
  validateAttachment(data: AttachmentData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const bytes = toUint8Array(data.content);

    if (!data.name || data.name.trim().length === 0) {
      errors.push('Attachment name is required');
    }

    if (!data.mimeType || data.mimeType.trim().length === 0) {
      errors.push('MIME type is required');
    }

    if (this.config.maxSizeBytes > 0 && bytes.length > this.config.maxSizeBytes) {
      errors.push(
        `Attachment size ${bytes.length} bytes exceeds maximum of ${this.config.maxSizeBytes} bytes`,
      );
    }

    if (
      this.config.allowedMimeTypes.length > 0 &&
      !this.config.allowedMimeTypes.includes(data.mimeType)
    ) {
      errors.push(
        `MIME type '${data.mimeType}' is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`,
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /** Attach binary data to a document. */
  async attach(
    collection: string,
    documentId: string,
    data: AttachmentData,
  ): Promise<Attachment> {
    const validation = this.validateAttachment(data);
    if (!validation.valid) {
      throw new Error(`Invalid attachment: ${validation.errors.join('; ')}`);
    }

    // Check per-document limit
    if (this.config.maxAttachmentsPerDocument > 0) {
      const existing = await this.store.list(documentId);
      if (existing.length >= this.config.maxAttachmentsPerDocument) {
        throw new Error(
          `Document '${documentId}' already has ${existing.length} attachments (max ${this.config.maxAttachmentsPerDocument})`,
        );
      }
    }

    const bytes = toUint8Array(data.content);
    const hash = await computeHash(bytes);

    const attachment: Attachment = {
      id: generateId(),
      documentId,
      collection,
      name: data.name,
      mimeType: data.mimeType,
      size: bytes.length,
      hash,
      createdAt: Date.now(),
    };

    await this.store.put(attachment, bytes);
    this.metadataCache.set(attachment.id, attachment);
    return attachment;
  }

  /** Retrieve an attachment and its binary data by id. */
  async getAttachment(
    attachmentId: string,
  ): Promise<{ attachment: Attachment; data: Uint8Array } | null> {
    const data = await this.store.get(attachmentId);
    if (!data) return null;

    const meta = this.metadataCache.get(attachmentId);
    if (!meta) return null;

    return { attachment: meta, data };
  }

  /** List all attachments for a specific document in a collection. */
  async listAttachments(collection: string, documentId: string): Promise<Attachment[]> {
    const all = await this.store.list(documentId);
    return all.filter((a) => a.collection === collection);
  }

  /** Remove a single attachment by id. Returns true if it existed. */
  async removeAttachment(attachmentId: string): Promise<boolean> {
    const meta = this.metadataCache.get(attachmentId);
    if (!meta) return false;

    await this.store.delete(attachmentId);
    this.metadataCache.delete(attachmentId);
    return true;
  }

  /** Remove all attachments for a document. Returns the count removed. */
  async removeAllAttachments(collection: string, documentId: string): Promise<number> {
    const attachments = await this.listAttachments(collection, documentId);
    for (const att of attachments) {
      await this.store.delete(att.id);
      this.metadataCache.delete(att.id);
    }
    return attachments.length;
  }

  /** Get aggregate statistics across all attachments. */
  async getStats(): Promise<AttachmentStats> {
    const usage = await this.store.getUsage();
    const byCollection = new Map<string, number>();

    for (const meta of this.metadataCache.values()) {
      byCollection.set(meta.collection, (byCollection.get(meta.collection) ?? 0) + 1);
    }

    return {
      totalAttachments: usage.count,
      totalSizeBytes: usage.totalSize,
      byCollection,
    };
  }

  // Internal metadata cache keyed by attachment id.
  private metadataCache = new Map<string, Attachment>();
}

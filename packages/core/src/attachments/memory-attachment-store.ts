import type { Attachment, AttachmentStore } from './attachment-manager.js';

/**
 * Simple in-memory implementation of {@link AttachmentStore} for testing.
 */
export class MemoryAttachmentStore implements AttachmentStore {
  private data = new Map<string, Uint8Array>();
  private metadata = new Map<string, Attachment>();

  async put(attachment: Attachment, data: Uint8Array): Promise<void> {
    this.data.set(attachment.id, data);
    this.metadata.set(attachment.id, { ...attachment });
  }

  async get(id: string): Promise<Uint8Array | null> {
    return this.data.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
    this.metadata.delete(id);
  }

  async list(documentId: string): Promise<Attachment[]> {
    const results: Attachment[] = [];
    for (const att of this.metadata.values()) {
      if (att.documentId === documentId) {
        results.push({ ...att });
      }
    }
    return results;
  }

  async getUsage(): Promise<{ totalSize: number; count: number }> {
    let totalSize = 0;
    for (const buf of this.data.values()) {
      totalSize += buf.length;
    }
    return { totalSize, count: this.data.size };
  }
}

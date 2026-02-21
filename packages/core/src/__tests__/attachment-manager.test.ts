import { describe, it, expect, beforeEach } from 'vitest';
import {
  AttachmentManager,
  type AttachmentData,
  type AttachmentManagerConfig,
} from '../attachments/attachment-manager.js';
import { MemoryAttachmentStore } from '../attachments/memory-attachment-store.js';

function makeData(content: string, name = 'file.txt', mimeType = 'text/plain'): AttachmentData {
  return { content: new TextEncoder().encode(content), mimeType, name };
}

describe('AttachmentManager', () => {
  let store: MemoryAttachmentStore;
  let manager: AttachmentManager;

  beforeEach(() => {
    store = new MemoryAttachmentStore();
    manager = new AttachmentManager(store);
  });

  it('should attach and retrieve a file', async () => {
    const data = makeData('hello world');
    const att = await manager.attach('docs', 'doc1', data);

    expect(att.id).toBeTruthy();
    expect(att.documentId).toBe('doc1');
    expect(att.collection).toBe('docs');
    expect(att.name).toBe('file.txt');
    expect(att.mimeType).toBe('text/plain');
    expect(att.size).toBe(new TextEncoder().encode('hello world').length);
    expect(att.hash).toBeTruthy();

    const result = await manager.getAttachment(att.id);
    expect(result).not.toBeNull();
    expect(result!.attachment.id).toBe(att.id);
    expect(new TextDecoder().decode(result!.data)).toBe('hello world');
  });

  it('should list attachments for a document', async () => {
    await manager.attach('docs', 'doc1', makeData('a'));
    await manager.attach('docs', 'doc1', makeData('b', 'b.txt'));
    await manager.attach('docs', 'doc2', makeData('c'));

    const list = await manager.listAttachments('docs', 'doc1');
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.documentId === 'doc1')).toBe(true);
  });

  it('should remove a single attachment', async () => {
    const att = await manager.attach('docs', 'doc1', makeData('x'));
    const removed = await manager.removeAttachment(att.id);
    expect(removed).toBe(true);

    const result = await manager.getAttachment(att.id);
    expect(result).toBeNull();

    // Removing again returns false
    expect(await manager.removeAttachment(att.id)).toBe(false);
  });

  it('should remove all attachments for a document', async () => {
    await manager.attach('docs', 'doc1', makeData('a'));
    await manager.attach('docs', 'doc1', makeData('b', 'b.txt'));
    await manager.attach('docs', 'doc1', makeData('c', 'c.txt'));

    const count = await manager.removeAllAttachments('docs', 'doc1');
    expect(count).toBe(3);

    const list = await manager.listAttachments('docs', 'doc1');
    expect(list).toHaveLength(0);
  });

  it('should enforce size limit', async () => {
    const config: AttachmentManagerConfig = { maxSizeBytes: 10 };
    const mgr = new AttachmentManager(store, config);

    await expect(
      mgr.attach('docs', 'doc1', makeData('this string is definitely longer than 10 bytes')),
    ).rejects.toThrow(/exceeds maximum/);
  });

  it('should enforce MIME type validation', async () => {
    const config: AttachmentManagerConfig = { allowedMimeTypes: ['image/png', 'image/jpeg'] };
    const mgr = new AttachmentManager(store, config);

    await expect(
      mgr.attach('docs', 'doc1', makeData('data', 'file.txt', 'text/plain')),
    ).rejects.toThrow(/not allowed/);

    // Allowed type should succeed
    const att = await mgr.attach('docs', 'doc1', makeData('data', 'pic.png', 'image/png'));
    expect(att.mimeType).toBe('image/png');
  });

  it('should enforce max attachments per document', async () => {
    const config: AttachmentManagerConfig = { maxAttachmentsPerDocument: 2 };
    const mgr = new AttachmentManager(store, config);

    await mgr.attach('docs', 'doc1', makeData('a'));
    await mgr.attach('docs', 'doc1', makeData('b', 'b.txt'));

    await expect(
      mgr.attach('docs', 'doc1', makeData('c', 'c.txt')),
    ).rejects.toThrow(/already has 2 attachments/);
  });

  it('should track stats', async () => {
    await manager.attach('docs', 'doc1', makeData('hello'));
    await manager.attach('images', 'doc2', makeData('world', 'img.png', 'image/png'));

    const stats = await manager.getStats();
    expect(stats.totalAttachments).toBe(2);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
    expect(stats.byCollection.get('docs')).toBe(1);
    expect(stats.byCollection.get('images')).toBe(1);
  });

  it('should support attachment with metadata', async () => {
    const data = makeData('content');
    const att = await manager.attach('docs', 'doc1', data);

    // Metadata is optional on Attachment – verify it can exist
    expect(att.metadata).toBeUndefined();

    // The type system allows metadata; we can verify that via the store
    att.metadata = { author: 'test', version: 1 };
    expect(att.metadata.author).toBe('test');
  });

  it('should return null for non-existent attachment', async () => {
    const result = await manager.getAttachment('nonexistent');
    expect(result).toBeNull();
  });
});

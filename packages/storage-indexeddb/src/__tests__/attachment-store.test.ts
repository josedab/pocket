import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Attachment } from '@pocket/core';
import {
  IndexedDBAttachmentStore,
  createIndexedDBAttachmentStore,
} from '../attachment-store.js';

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att_1',
    documentId: 'doc_1',
    collection: 'notes',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 4,
    hash: 'abcd1234',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('IndexedDBAttachmentStore', () => {
  let store: IndexedDBAttachmentStore;

  beforeEach(async () => {
    store = await createIndexedDBAttachmentStore(`test_${Date.now()}`);
  });

  afterEach(() => {
    store.close();
  });

  it('should initialize and close without errors', async () => {
    const s = new IndexedDBAttachmentStore(`init_test_${Date.now()}`);
    await s.initialize();
    s.close();
  });

  it('should put and get an attachment round-trip', async () => {
    const attachment = makeAttachment();
    const data = new Uint8Array([1, 2, 3, 4]);

    await store.put(attachment, data);
    const result = await store.get(attachment.id);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(data);
  });

  it('should delete an attachment', async () => {
    const attachment = makeAttachment();
    const data = new Uint8Array([10, 20]);

    await store.put(attachment, data);
    await store.delete(attachment.id);

    const result = await store.get(attachment.id);
    expect(result).toBeNull();

    const list = await store.list(attachment.documentId);
    expect(list).toHaveLength(0);
  });

  it('should list attachments by documentId', async () => {
    const a1 = makeAttachment({ id: 'att_a', documentId: 'doc_x' });
    const a2 = makeAttachment({ id: 'att_b', documentId: 'doc_y' });

    await store.put(a1, new Uint8Array([1]));
    await store.put(a2, new Uint8Array([2]));

    const list = await store.list('doc_x');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('att_a');
  });

  it('should return usage stats', async () => {
    const a1 = makeAttachment({ id: 'att_1', size: 100 });
    const a2 = makeAttachment({ id: 'att_2', size: 250 });

    await store.put(a1, new Uint8Array(100));
    await store.put(a2, new Uint8Array(250));

    const usage = await store.getUsage();
    expect(usage.count).toBe(2);
    expect(usage.totalSize).toBe(350);
  });

  it('should return null for a non-existent attachment', async () => {
    const result = await store.get('does_not_exist');
    expect(result).toBeNull();
  });

  it('should handle multiple attachments for the same document', async () => {
    const a1 = makeAttachment({ id: 'att_m1', documentId: 'doc_shared', size: 10 });
    const a2 = makeAttachment({ id: 'att_m2', documentId: 'doc_shared', size: 20 });
    const a3 = makeAttachment({ id: 'att_m3', documentId: 'doc_other', size: 30 });

    await store.put(a1, new Uint8Array(10));
    await store.put(a2, new Uint8Array(20));
    await store.put(a3, new Uint8Array(30));

    const shared = await store.list('doc_shared');
    expect(shared).toHaveLength(2);

    const ids = shared.map((a) => a.id).sort();
    expect(ids).toEqual(['att_m1', 'att_m2']);
  });
});

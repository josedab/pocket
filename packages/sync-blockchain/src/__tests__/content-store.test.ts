import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ContentStore, createContentStore } from '../content-store.js';

describe('ContentStore', () => {
  let store: ContentStore;
  const encoder = new TextEncoder();

  beforeEach(() => {
    store = createContentStore({
      pinning: { autoPinNew: false },
      storage: { enableAutoGc: false },
    });
  });

  afterEach(() => {
    store.destroy();
  });

  describe('createContentStore factory', () => {
    it('creates a ContentStore instance', () => {
      expect(store).toBeInstanceOf(ContentStore);
    });

    it('accepts custom pinning config', () => {
      const custom = createContentStore({ pinning: { autoPinNew: true, maxPinned: 5 } });
      expect(custom).toBeInstanceOf(ContentStore);
      custom.destroy();
    });
  });

  describe('computeHash', () => {
    it('produces consistent hash for same data', async () => {
      const data = encoder.encode('hello');
      const hash1 = await store.computeHash(data);
      const hash2 = await store.computeHash(data);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different data', async () => {
      const hash1 = await store.computeHash(encoder.encode('hello'));
      const hash2 = await store.computeHash(encoder.encode('world'));
      expect(hash1).not.toBe(hash2);
    });

    it('returns a 64-char hex string', async () => {
      const hash = await store.computeHash(encoder.encode('test'));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('generateCID', () => {
    it('creates a valid CID', async () => {
      const data = encoder.encode('hello');
      const cid = await store.generateCID(data);
      expect(cid).toMatchObject({
        algorithm: 'sha-256',
        codec: 'json',
        version: 1,
      });
      expect(cid.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uses specified codec', async () => {
      const cid = await store.generateCID(encoder.encode('data'), 'raw');
      expect(cid.codec).toBe('raw');
    });
  });

  describe('validateCID', () => {
    it('validates content against its CID', async () => {
      const data = encoder.encode('hello');
      const cid = await store.generateCID(data);
      const valid = await store.validateCID(cid, data);
      expect(valid).toBe(true);
    });

    it('rejects mismatched content', async () => {
      const cid = await store.generateCID(encoder.encode('hello'));
      const valid = await store.validateCID(cid, encoder.encode('different'));
      expect(valid).toBe(false);
    });
  });

  describe('put', () => {
    it('stores content and returns CID', async () => {
      const data = encoder.encode('hello');
      const cid = await store.put(data);
      expect(cid.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('deduplicates identical content', async () => {
      const data = encoder.encode('hello');
      const cid1 = await store.put(data);
      const cid2 = await store.put(data);
      expect(cid1.hash).toBe(cid2.hash);
      expect(store.getAllHashes()).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('retrieves stored content', async () => {
      const data = encoder.encode('hello');
      const cid = await store.put(data);
      const retrieved = store.get(cid.hash);
      expect(retrieved).toEqual(data);
    });

    it('returns null for missing content', () => {
      const result = store.get('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('has', () => {
    it('returns true for stored content', async () => {
      const cid = await store.put(encoder.encode('hello'));
      expect(store.has(cid.hash)).toBe(true);
    });

    it('returns false for missing content', () => {
      expect(store.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes unpinned content', async () => {
      const cid = await store.put(encoder.encode('hello'));
      const deleted = store.delete(cid.hash);
      expect(deleted).toBe(true);
      expect(store.has(cid.hash)).toBe(false);
    });

    it('returns false for nonexistent content', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });

    it('refuses to delete pinned content without force', async () => {
      const cid = await store.put(encoder.encode('pinned'));
      store.pin(cid.hash);
      const deleted = store.delete(cid.hash);
      expect(deleted).toBe(false);
      expect(store.has(cid.hash)).toBe(true);
    });

    it('deletes pinned content with force', async () => {
      const cid = await store.put(encoder.encode('pinned'));
      store.pin(cid.hash);
      const deleted = store.delete(cid.hash, true);
      expect(deleted).toBe(true);
      expect(store.has(cid.hash)).toBe(false);
    });
  });

  describe('pin / unpin / isPinned', () => {
    it('pins content', async () => {
      const cid = await store.put(encoder.encode('data'));
      expect(store.isPinned(cid.hash)).toBe(false);
      store.pin(cid.hash);
      expect(store.isPinned(cid.hash)).toBe(true);
    });

    it('unpins content', async () => {
      const cid = await store.put(encoder.encode('data'));
      store.pin(cid.hash);
      store.unpin(cid.hash);
      expect(store.isPinned(cid.hash)).toBe(false);
    });

    it('pin returns false for nonexistent hash', () => {
      expect(store.pin('nonexistent')).toBe(false);
    });

    it('unpin returns false for nonexistent hash', () => {
      expect(store.unpin('nonexistent')).toBe(false);
    });

    it('isPinned returns false for nonexistent hash', () => {
      expect(store.isPinned('nonexistent')).toBe(false);
    });
  });

  describe('gc', () => {
    it('removes unpinned content when storage exceeds 80%', async () => {
      const smallStore = createContentStore({
        pinning: { autoPinNew: false },
        storage: { maxStorageBytes: 100, enableAutoGc: false },
      });

      // Fill over 80% capacity
      const data = new Uint8Array(85);
      await smallStore.put(data);

      const freed = smallStore.gc();
      expect(freed).toBeGreaterThan(0);
      expect(smallStore.getAllHashes()).toHaveLength(0);
      smallStore.destroy();
    });

    it('does not remove pinned content', async () => {
      const smallStore = createContentStore({
        pinning: { autoPinNew: false },
        storage: { maxStorageBytes: 100, enableAutoGc: false },
      });

      const data = new Uint8Array(85);
      const cid = await smallStore.put(data);
      smallStore.pin(cid.hash);

      smallStore.gc();
      expect(smallStore.has(cid.hash)).toBe(true);
      smallStore.destroy();
    });
  });

  describe('getAllHashes', () => {
    it('returns all stored hashes', async () => {
      await store.put(encoder.encode('one'));
      await store.put(encoder.encode('two'));
      await store.put(encoder.encode('three'));
      expect(store.getAllHashes()).toHaveLength(3);
    });

    it('returns empty array when empty', () => {
      expect(store.getAllHashes()).toEqual([]);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips data', () => {
      const original = { name: 'test', value: 42 };
      const bytes = store.serialize(original);
      const result = store.deserialize(bytes);
      expect(result).toEqual(original);
    });
  });

  describe('destroy', () => {
    it('clears all blocks', async () => {
      await store.put(encoder.encode('data'));
      store.destroy();
      expect(store.getAllHashes()).toEqual([]);
    });
  });
});

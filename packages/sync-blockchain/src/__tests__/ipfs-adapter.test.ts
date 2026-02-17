import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IPFSAdapter, createIPFSAdapter } from '../ipfs-adapter.js';

describe('IPFSAdapter', () => {
  let adapter: IPFSAdapter;

  beforeEach(() => {
    adapter = createIPFSAdapter({ autoPinning: true });
  });

  afterEach(() => {
    adapter.dispose();
  });

  describe('content operations', () => {
    it('should add and retrieve string content', async () => {
      const cid = await adapter.add('hello world');
      expect(cid).toMatch(/^bafy/);

      const result = await adapter.getString(cid);
      expect(result).toBe('hello world');
    });

    it('should add and retrieve binary content', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const cid = await adapter.add(data);
      const result = await adapter.get(cid);
      expect(result).toEqual(data);
    });

    it('should add and retrieve JSON', async () => {
      const obj = { name: 'test', value: 42 };
      const cid = await adapter.addJSON(obj);
      const result = await adapter.getJSON(cid);
      expect(result).toEqual(obj);
    });

    it('should return null for missing CID', async () => {
      const result = await adapter.get('bafynotfound');
      expect(result).toBeNull();
    });

    it('should deduplicate identical content', async () => {
      const cid1 = await adapter.add('same content');
      const cid2 = await adapter.add('same content');
      expect(cid1).toBe(cid2);
      expect(adapter.getStats().totalObjects).toBe(1);
    });

    it('should check existence', async () => {
      const cid = await adapter.add('exists');
      expect(adapter.has(cid)).toBe(true);
      expect(adapter.has('bafymissing')).toBe(false);
    });

    it('should reject oversized content', async () => {
      const small = createIPFSAdapter({ maxContentSize: 10 });
      await expect(small.add('this is way too long for the limit')).rejects.toThrow('exceeds maximum');
      small.dispose();
    });
  });

  describe('pinning', () => {
    it('should auto-pin when configured', async () => {
      const cid = await adapter.add('pinned');
      expect(adapter.isPinned(cid)).toBe(true);
    });

    it('should not auto-pin when disabled', async () => {
      const noPinAdapter = createIPFSAdapter({ autoPinning: false });
      const cid = await noPinAdapter.add('not pinned');
      expect(noPinAdapter.isPinned(cid)).toBe(false);
      noPinAdapter.dispose();
    });

    it('should pin and unpin', async () => {
      const noPinAdapter = createIPFSAdapter({ autoPinning: false });
      const cid = await noPinAdapter.add('toggle');

      const pinResult = noPinAdapter.pin(cid);
      expect(pinResult.status).toBe('pinned');
      expect(noPinAdapter.isPinned(cid)).toBe(true);

      const unpinResult = noPinAdapter.unpin(cid);
      expect(unpinResult.status).toBe('unpinned');
      expect(noPinAdapter.isPinned(cid)).toBe(false);

      noPinAdapter.dispose();
    });

    it('should list pinned CIDs', async () => {
      await adapter.add('a');
      await adapter.add('b');
      expect(adapter.getPinnedCIDs().length).toBe(2);
    });
  });

  describe('DAG operations', () => {
    it('should create and retrieve DAG nodes', async () => {
      const cid = await adapter.dagPut({ title: 'root' }, []);
      const node = adapter.dagGet(cid);
      expect(node).toBeDefined();
      expect(node?.data).toEqual({ title: 'root' });
    });

    it('should create DAG with links', async () => {
      const childCid = await adapter.dagPut({ value: 'child' });
      const parentCid = await adapter.dagPut(
        { value: 'parent' },
        [{ name: 'child', cid: childCid, size: 10 }],
      );

      const parent = adapter.dagGet(parentCid);
      expect(parent?.links).toHaveLength(1);
      expect(parent?.links[0]?.name).toBe('child');
    });

    it('should resolve DAG paths', async () => {
      const leafCid = await adapter.dagPut({ leaf: true });
      const midCid = await adapter.dagPut(
        { mid: true },
        [{ name: 'leaf', cid: leafCid, size: 5 }],
      );
      const rootCid = await adapter.dagPut(
        { root: true },
        [{ name: 'mid', cid: midCid, size: 10 }],
      );

      const resolved = adapter.dagResolve(rootCid, ['mid', 'leaf']);
      expect(resolved?.data).toEqual({ leaf: true });
    });

    it('should return null for invalid path', async () => {
      const cid = await adapter.dagPut({ data: 1 });
      expect(adapter.dagResolve(cid, ['nonexistent'])).toBeNull();
    });
  });

  describe('garbage collection', () => {
    it('should remove unpinned content', async () => {
      const noPinAdapter = createIPFSAdapter({ autoPinning: false });
      await noPinAdapter.add('will be removed');
      await noPinAdapter.add('also removed');

      const removed = noPinAdapter.gc();
      expect(removed).toBe(2);
      expect(noPinAdapter.getStats().totalObjects).toBe(0);
      noPinAdapter.dispose();
    });

    it('should keep pinned content', async () => {
      await adapter.add('kept');
      const removed = adapter.gc();
      expect(removed).toBe(0);
      expect(adapter.getStats().totalObjects).toBe(1);
    });
  });

  describe('stats', () => {
    it('should track statistics', async () => {
      await adapter.add('data1');
      await adapter.add('data2');

      const stats = adapter.getStats();
      expect(stats.totalObjects).toBe(2);
      expect(stats.pinnedObjects).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.operationCount).toBe(2);
    });
  });

  describe('events', () => {
    it('should emit events', async () => {
      const events: unknown[] = [];
      adapter.events$.subscribe((e) => events.push(e));

      await adapter.add('test');

      expect(events.length).toBeGreaterThan(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Document } from '@pocket/core';
import { OPFSAdapter, createOPFSStorage } from './adapter.js';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
}

// Mock Worker class
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private messageHandler: (data: unknown) => unknown;

  constructor(_url: string, _options?: object) {
    // Default message handler that echoes back success
    this.messageHandler = (data) => data;
  }

  postMessage(data: { type: string; requestId: number; [key: string]: unknown }) {
    // Simulate async worker response
    setTimeout(() => {
      if (this.onmessage) {
        let responseData: unknown = null;

        switch (data.type) {
          case 'init':
            responseData = { success: true };
            break;
          case 'close':
            responseData = { success: true };
            break;
          case 'get':
            responseData = null;
            break;
          case 'getAll':
            responseData = [];
            break;
          case 'put':
            responseData = data.doc;
            break;
          case 'bulkPut':
            responseData = data.docs;
            break;
          case 'delete':
            responseData = undefined;
            break;
          case 'clear':
            responseData = undefined;
            break;
          default:
            responseData = null;
        }

        this.onmessage({
          data: {
            type: 'success',
            data: responseData,
            requestId: data.requestId,
          },
        } as MessageEvent);
      }
    }, 0);
  }

  terminate() {
    // No-op
  }

  setResponseHandler(handler: (data: unknown) => unknown) {
    this.messageHandler = handler;
  }
}

// Mock navigator.storage
const mockNavigator = {
  storage: {
    getDirectory: vi.fn().mockResolvedValue({
      getDirectoryHandle: vi.fn().mockResolvedValue({}),
    }),
    estimate: vi.fn().mockResolvedValue({ usage: 1024 }),
  },
};

describe('OPFSAdapter', () => {
  let originalNavigator: typeof global.navigator;
  let originalWorker: typeof global.Worker;

  beforeEach(() => {
    // Save originals
    originalNavigator = global.navigator;
    originalWorker = global.Worker;

    // Mock navigator
    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });

    // Mock Worker
    (global as unknown as { Worker: typeof MockWorker }).Worker = MockWorker as unknown as typeof Worker;

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore originals
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    (global as unknown as { Worker: typeof Worker }).Worker = originalWorker;
  });

  describe('createOPFSStorage', () => {
    it('should create an OPFS adapter instance', () => {
      const adapter = createOPFSStorage();
      expect(adapter).toBeInstanceOf(OPFSAdapter);
    });

    it('should create adapter with options', () => {
      const adapter = createOPFSStorage({
        workerUrl: '/worker.js',
        useWorker: true,
      });
      expect(adapter).toBeInstanceOf(OPFSAdapter);
    });
  });

  describe('isAvailable', () => {
    it('should return true when OPFS is available', () => {
      const adapter = createOPFSStorage();
      expect(adapter.isAvailable()).toBe(true);
    });

    it('should return false when navigator is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const adapter = createOPFSStorage();
      expect(adapter.isAvailable()).toBe(false);
    });

    it('should return false when storage is not in navigator', () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const adapter = createOPFSStorage();
      expect(adapter.isAvailable()).toBe(false);
    });
  });

  describe('name property', () => {
    it('should have name "opfs"', () => {
      const adapter = createOPFSStorage();
      expect(adapter.name).toBe('opfs');
    });
  });

  describe('initialize', () => {
    it('should initialize with worker URL', async () => {
      const adapter = createOPFSStorage({ workerUrl: '/worker.js', useWorker: true });
      await adapter.initialize({ name: 'test-db' });
      // Should not throw
    });

    it('should initialize without worker (direct access)', async () => {
      const adapter = createOPFSStorage({ useWorker: false });
      await adapter.initialize({ name: 'test-db' });
      expect(mockNavigator.storage.getDirectory).toHaveBeenCalled();
    });
  });

  describe('getStore', () => {
    it('should return a document store', () => {
      const adapter = createOPFSStorage();
      const store = adapter.getStore<TestDoc>('test-collection');

      expect(store.name).toBe('test-collection');
    });

    it('should return the same store for the same name', () => {
      const adapter = createOPFSStorage();
      const store1 = adapter.getStore('test-collection');
      const store2 = adapter.getStore('test-collection');

      expect(store1).toBe(store2);
    });

    it('should return different stores for different names', () => {
      const adapter = createOPFSStorage();
      const store1 = adapter.getStore('collection-1');
      const store2 = adapter.getStore('collection-2');

      expect(store1).not.toBe(store2);
    });
  });

  describe('hasStore', () => {
    it('should return false for non-existent store', () => {
      const adapter = createOPFSStorage();
      expect(adapter.hasStore('non-existent')).toBe(false);
    });

    it('should return true for existing store', () => {
      const adapter = createOPFSStorage();
      adapter.getStore('test-collection');
      expect(adapter.hasStore('test-collection')).toBe(true);
    });
  });

  describe('listStores', () => {
    it('should return empty array initially', async () => {
      const adapter = createOPFSStorage();
      const stores = await adapter.listStores();
      expect(stores).toEqual([]);
    });

    it('should return store names', async () => {
      const adapter = createOPFSStorage();
      adapter.getStore('collection-1');
      adapter.getStore('collection-2');

      const stores = await adapter.listStores();
      expect(stores).toContain('collection-1');
      expect(stores).toContain('collection-2');
    });
  });

  describe('close', () => {
    it('should close adapter without error', async () => {
      const adapter = createOPFSStorage({ workerUrl: '/worker.js', useWorker: true });
      await adapter.initialize({ name: 'test-db' });
      await adapter.close();
      // Should not throw
    });

    it('should clear stores on close', async () => {
      const adapter = createOPFSStorage({ workerUrl: '/worker.js', useWorker: true });
      await adapter.initialize({ name: 'test-db' });

      adapter.getStore('test-collection');
      expect(adapter.hasStore('test-collection')).toBe(true);

      await adapter.close();
      expect(adapter.hasStore('test-collection')).toBe(false);
    });
  });

  describe('transaction', () => {
    it('should execute function and return result', async () => {
      const adapter = createOPFSStorage();
      const result = await adapter.transaction(
        ['test-collection'],
        'readwrite',
        async () => 'result'
      );
      expect(result).toBe('result');
    });
  });

  describe('getStats', () => {
    it('should return storage stats', async () => {
      const adapter = createOPFSStorage();
      const stats = await adapter.getStats();

      expect(stats).toHaveProperty('documentCount');
      expect(stats).toHaveProperty('storageSize');
      expect(stats).toHaveProperty('storeCount');
      expect(stats).toHaveProperty('indexCount');
    });

    it('should count documents across stores', async () => {
      const adapter = createOPFSStorage({ workerUrl: '/worker.js', useWorker: true });
      await adapter.initialize({ name: 'test-db' });

      adapter.getStore('collection-1');
      adapter.getStore('collection-2');

      const stats = await adapter.getStats();
      expect(stats.storeCount).toBe(2);

      await adapter.close();
    });
  });
});

describe('OPFSDocumentStore', () => {
  let adapter: OPFSAdapter;
  let originalWorker: typeof global.Worker;

  beforeEach(async () => {
    originalWorker = global.Worker;
    (global as unknown as { Worker: typeof MockWorker }).Worker = MockWorker as unknown as typeof Worker;

    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });

    adapter = createOPFSStorage({ workerUrl: '/worker.js', useWorker: true });
    await adapter.initialize({ name: 'test-db' });
  });

  afterEach(async () => {
    await adapter.close();
    (global as unknown as { Worker: typeof Worker }).Worker = originalWorker;
  });

  describe('name property', () => {
    it('should have the correct collection name', () => {
      const store = adapter.getStore<TestDoc>('my-collection');
      expect(store.name).toBe('my-collection');
    });
  });

  describe('changes', () => {
    it('should return an observable', () => {
      const store = adapter.getStore<TestDoc>('test-collection');
      const changes$ = store.changes();

      expect(changes$).toBeDefined();
      expect(typeof changes$.subscribe).toBe('function');
    });
  });

  describe('index operations', () => {
    it('should create and list indexes', async () => {
      const store = adapter.getStore<TestDoc>('test-collection');

      await store.createIndex({ fields: ['title'] });
      await store.createIndex({ name: 'count-idx', fields: ['count'] });

      const indexes = await store.getIndexes();
      expect(indexes.length).toBe(2);
      expect(indexes.some((i) => i.fields.some((f) => f.field === 'title'))).toBe(true);
      expect(indexes.some((i) => i.name === 'count-idx')).toBe(true);
    });

    it('should drop an index', async () => {
      const store = adapter.getStore<TestDoc>('test-collection');

      await store.createIndex({ name: 'to-drop', fields: ['title'] });
      let indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'to-drop')).toBe(true);

      await store.dropIndex('to-drop');
      indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'to-drop')).toBe(false);
    });

    it('should normalize index fields', async () => {
      const store = adapter.getStore<TestDoc>('test-collection');

      await store.createIndex({
        fields: ['title', { field: 'count', direction: 'desc' }],
      });

      const indexes = await store.getIndexes();
      expect(indexes[0].fields).toEqual([
        { field: 'title', direction: 'asc' },
        { field: 'count', direction: 'desc' },
      ]);
    });
  });
});

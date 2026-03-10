import { createMemoryStorage } from '@pocket/storage-memory';
import { afterEach, describe, expect, it } from 'vitest';

describe('@pocket/angular', () => {
  let service: InstanceType<Awaited<ReturnType<typeof importService>>>;

  async function importService() {
    const { PocketService } = await import('../pocket.service.js');
    return PocketService;
  }

  afterEach(async () => {
    if (service) {
      try {
        const db = await service.getDatabase();
        await db.close();
      } catch {
        // not initialized — ignore
      }
    }
  });

  describe('uninitialized service', () => {
    it('should be instantiable without arguments', async () => {
      const PocketService = await importService();
      service = new PocketService();
      expect(service).toBeDefined();
    });

    it('should throw when getDatabase called before initialize', async () => {
      const PocketService = await importService();
      service = new PocketService();
      await expect(service.getDatabase()).rejects.toThrow('PocketService not initialized');
    });

    it('should throw when collection called before initialize', async () => {
      const PocketService = await importService();
      service = new PocketService();
      await expect(service.collection('users')).rejects.toThrow('PocketService not initialized');
    });

    it('should throw when insert called before initialize', async () => {
      const PocketService = await importService();
      service = new PocketService();
      await expect(service.insert('users', { name: 'Alice' } as never)).rejects.toThrow(
        'PocketService not initialized'
      );
    });

    it('should throw when update called before initialize', async () => {
      const PocketService = await importService();
      service = new PocketService();
      await expect(service.update('users', 'id', {})).rejects.toThrow(
        'PocketService not initialized'
      );
    });

    it('should throw when delete called before initialize', async () => {
      const PocketService = await importService();
      service = new PocketService();
      await expect(service.delete('users', 'id')).rejects.toThrow('PocketService not initialized');
    });

    it('should expose db$ observable', async () => {
      const PocketService = await importService();
      service = new PocketService();
      expect(service.db$).toBeDefined();
      expect(typeof service.db$.subscribe).toBe('function');
    });

    it('should return Observable from liveQuery without init', async () => {
      const PocketService = await importService();
      service = new PocketService();
      const result = service.liveQuery('users');
      expect(typeof result.subscribe).toBe('function');
    });

    it('should return Observable from document without init', async () => {
      const PocketService = await importService();
      service = new PocketService();
      const result = service.document('users', 'user-1');
      expect(typeof result.subscribe).toBe('function');
    });
  });

  describe('initialized service with custom storage', () => {
    it('should initialize with a custom StorageAdapter', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular', storage: createMemoryStorage() });

      const db = await service.getDatabase();
      expect(db).toBeDefined();
      expect(db.name).toBe('test-angular');
    });

    it('should return a collection after initialization', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular-coll', storage: createMemoryStorage() });

      const coll = await service.collection('users');
      expect(coll).toBeDefined();
    });

    it('should insert and retrieve a document', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular-crud', storage: createMemoryStorage() });

      const result = await service.insert('todos', { title: 'Buy milk', done: false } as never);
      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect((result as unknown as Record<string, unknown>).title).toBe('Buy milk');
    });

    it('should update a document', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular-update', storage: createMemoryStorage() });

      const doc = await service.insert('todos', { title: 'Original', done: false } as never);
      const updated = await service.update('todos', doc._id, { done: true } as never);
      expect(updated).not.toBeNull();
      expect((updated as unknown as Record<string, unknown>).done).toBe(true);
    });

    it('should delete a document', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular-del', storage: createMemoryStorage() });

      const doc = await service.insert('todos', { title: 'To delete' } as never);
      await service.delete('todos', doc._id);

      const coll = await service.collection('todos');
      const found = await coll.get(doc._id);
      expect(found).toBeNull();
    });

    it('should report database as open', async () => {
      const PocketService = await importService();
      service = new PocketService();
      service.initialize({ name: 'test-angular-open', storage: createMemoryStorage() });

      const db = await service.getDatabase();
      expect(db.isOpen).toBe(true);
    });
  });
});

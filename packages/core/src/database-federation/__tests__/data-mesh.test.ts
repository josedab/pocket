import { describe, expect, it } from 'vitest';
import type { MeshQueryExecutor } from '../data-mesh.js';
import { createDataMeshRegistry } from '../data-mesh.js';

function createMockExecutor(data: Record<string, Record<string, unknown>[]>): MeshQueryExecutor {
  return {
    async query(collection, filter) {
      let docs = data[collection] ?? [];
      if (filter) {
        docs = docs.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      }
      return docs;
    },
    async getCollections() {
      return Object.keys(data);
    },
  };
}

describe('DataMeshRegistry', () => {
  it('should register and list databases', () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'App DB', collections: ['users', 'posts'], location: 'local' },
      createMockExecutor({ users: [], posts: [] })
    );
    expect(mesh.listDatabases()).toHaveLength(1);
  });

  it('should find databases for collection', () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['users'], location: 'local' },
      createMockExecutor({ users: [] })
    );
    mesh.register(
      { id: 'db2', name: 'DB2', collections: ['users', 'posts'], location: 'remote' },
      createMockExecutor({ users: [], posts: [] })
    );

    const dbs = mesh.findDatabasesForCollection('users');
    expect(dbs).toHaveLength(2);
  });

  it('should query across databases', async () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['todos'], location: 'local' },
      createMockExecutor({ todos: [{ _id: '1', title: 'A' }] })
    );
    mesh.register(
      { id: 'db2', name: 'DB2', collections: ['todos'], location: 'remote' },
      createMockExecutor({ todos: [{ _id: '2', title: 'B' }] })
    );

    const result = await mesh.query({ collection: 'todos' });
    expect(result.documents).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    expect(result.totalCount).toBe(2);
  });

  it('should apply filters to federated queries', async () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['todos'], location: 'local' },
      createMockExecutor({
        todos: [
          { _id: '1', status: 'active' },
          { _id: '2', status: 'done' },
        ],
      })
    );

    const result = await mesh.query({
      collection: 'todos',
      filter: { status: 'active' },
    });
    expect(result.documents).toHaveLength(1);
  });

  it('should apply limit across merged results', async () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['items'], location: 'local' },
      createMockExecutor({ items: [{ _id: '1' }, { _id: '2' }, { _id: '3' }] })
    );
    mesh.register(
      { id: 'db2', name: 'DB2', collections: ['items'], location: 'remote' },
      createMockExecutor({ items: [{ _id: '4' }, { _id: '5' }] })
    );

    const result = await mesh.query({ collection: 'items', limit: 3 });
    expect(result.documents).toHaveLength(3);
    expect(result.totalCount).toBe(5);
  });

  it('should execute cross-database inner join', async () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['users'], location: 'local' },
      createMockExecutor({
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      })
    );
    mesh.register(
      { id: 'db2', name: 'DB2', collections: ['orders'], location: 'remote' },
      createMockExecutor({ orders: [{ _id: 'o1', userId: 'u1', total: 100 }] })
    );

    const results = await mesh.join({
      left: { database: 'db1', collection: 'users', field: '_id' },
      right: { database: 'db2', collection: 'orders', field: 'userId' },
      type: 'inner',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.left['name']).toBe('Alice');
    expect(results[0]!.right!['total']).toBe(100);
  });

  it('should execute left join (include unmatched left)', async () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['users'], location: 'local' },
      createMockExecutor({
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      })
    );
    mesh.register(
      { id: 'db2', name: 'DB2', collections: ['orders'], location: 'remote' },
      createMockExecutor({ orders: [{ _id: 'o1', userId: 'u1', total: 100 }] })
    );

    const results = await mesh.join({
      left: { database: 'db1', collection: 'users', field: '_id' },
      right: { database: 'db2', collection: 'orders', field: 'userId' },
      type: 'left',
    });

    expect(results).toHaveLength(2);
    expect(results[1]!.right).toBeNull();
  });

  it('should return catalog of all databases', () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['users', 'posts'], location: 'local' },
      createMockExecutor({})
    );
    const catalog = mesh.getCatalog();
    expect(catalog['db1']).toEqual(['users', 'posts']);
  });

  it('should handle empty mesh gracefully', async () => {
    const mesh = createDataMeshRegistry();
    const result = await mesh.query({ collection: 'nonexistent' });
    expect(result.documents).toHaveLength(0);
  });

  it('should unregister databases', () => {
    const mesh = createDataMeshRegistry();
    mesh.register(
      { id: 'db1', name: 'DB1', collections: ['a'], location: 'local' },
      createMockExecutor({})
    );
    mesh.unregister('db1');
    expect(mesh.listDatabases()).toHaveLength(0);
  });
});

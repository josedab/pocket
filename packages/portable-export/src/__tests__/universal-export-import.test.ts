import { describe, expect, it } from 'vitest';
import { UniversalExporter, UniversalImporter } from '../universal-export-import.js';

describe('UniversalExporter', () => {
  const mockDb = {
    name: 'test-db',
    listCollections: async () => ['users', 'orders'],
    collection: (name: string) => ({
      find: () => ({
        exec: async () =>
          name === 'users'
            ? [
                { _id: 'u1', name: 'Alice' },
                { _id: 'u2', name: 'Bob' },
              ]
            : [{ _id: 'o1', amount: 100 }],
      }),
    }),
  };

  const exporter = new UniversalExporter();

  it('should export to JSONL format', async () => {
    const result = await exporter.export(mockDb, { format: 'jsonl' });
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(3);
    expect(JSON.parse(lines[0]!)._type).toBe('header');
    const docs = lines.filter((l) => JSON.parse(l)._type === 'document');
    expect(docs.length).toBe(3);
  });

  it('should export to SQL dump format', async () => {
    const result = await exporter.export(mockDb, { format: 'sql-dump' });
    expect(result).toContain('CREATE TABLE');
    expect(result).toContain('INSERT INTO');
    expect(result).toContain('Alice');
  });

  it('should export to structured JSON', async () => {
    const result = await exporter.export(mockDb, { format: 'structured-json' });
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.collections).toHaveLength(2);
    expect(parsed.collections[0].documents).toHaveLength(2);
  });

  it('should filter collections', async () => {
    const result = await exporter.export(mockDb, {
      format: 'structured-json',
      collections: ['users'],
    });
    const parsed = JSON.parse(result);
    expect(parsed.collections).toHaveLength(1);
    expect(parsed.collections[0].name).toBe('users');
  });
});

describe('UniversalImporter', () => {
  const importer = new UniversalImporter();

  it('should import Pocket/RxDB format', async () => {
    const data = JSON.stringify({
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: [{ name: 'users', documents: [{ _id: 'u1', name: 'Alice' }] }],
    });

    const { collections, result } = await importer.import(data, { source: 'pocket' });
    expect(collections).toHaveLength(1);
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should import PouchDB format', async () => {
    const data = JSON.stringify({
      db_name: 'pouchdb-users',
      rows: [{ doc: { _id: 'p1', _rev: '1-abc', name: 'Pouch User' } }],
    });

    const { collections, result } = await importer.import(data, { source: 'pouchdb' });
    expect(collections).toHaveLength(1);
    expect(result.imported).toBe(1);
  });

  it('should import MongoDB NDJSON format', async () => {
    const data = [
      JSON.stringify({ _id: { $oid: 'abc123' }, name: 'Mongo User' }),
      JSON.stringify({ _id: { $oid: 'def456' }, name: 'Another' }),
    ].join('\n');

    const { collections, result } = await importer.import(data, { source: 'mongodb' });
    expect(result.imported).toBe(2);
    expect(collections[0]!.documents[0]!._id).toBe('abc123');
  });

  it('should import Firestore format', async () => {
    const data = JSON.stringify({
      collections: {
        users: [{ _id: 'f1', name: 'Firebase User' }],
        orders: [{ _id: 'f2', amount: 50 }],
      },
    });

    const { collections, result } = await importer.import(data, { source: 'firestore' });
    expect(collections).toHaveLength(2);
    expect(result.imported).toBe(2);
  });

  it('should apply schema mapping', async () => {
    const data = JSON.stringify({
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: [{ name: 'old_users', documents: [{ _id: '1' }] }],
    });

    const { collections } = await importer.import(data, {
      source: 'pocket',
      schemaMapping: { old_users: 'users' },
    });
    expect(collections[0]!.name).toBe('users');
  });

  it('should apply document transform', async () => {
    const data = JSON.stringify({
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: [{ name: 'items', documents: [{ _id: '1', value: 10 }] }],
    });

    const { collections } = await importer.import(data, {
      source: 'pocket',
      transformDocument: (doc) => ({ ...doc, value: (doc.value as number) * 2 }),
    });
    expect(collections[0]!.documents[0]!.value).toBe(20);
  });
});

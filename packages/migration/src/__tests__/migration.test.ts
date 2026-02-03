import { describe, it, expect, beforeEach } from 'vitest';

import { MigrationEngine, createMigrationEngine } from '../migration-engine.js';
import { PouchDBAdapter, type PouchDBData } from '../adapters/pouchdb-adapter.js';
import { DexieAdapter, type DexieData } from '../adapters/dexie-adapter.js';
import { FirestoreAdapter, type FirestoreData } from '../adapters/firestore-adapter.js';

// ---------------------------------------------------------------------------
// MigrationEngine
// ---------------------------------------------------------------------------

describe('MigrationEngine', () => {
  it('should create engine with config', () => {
    const engine = createMigrationEngine({ source: 'pouchdb' });
    expect(engine).toBeInstanceOf(MigrationEngine);
  });

  it('should create engine with custom batchSize', () => {
    const engine = createMigrationEngine({ source: 'dexie', batchSize: 50 });
    expect(engine).toBeInstanceOf(MigrationEngine);
  });

  it('should analyze source data structure', async () => {
    const engine = createMigrationEngine({ source: 'pouchdb' });
    const data: PouchDBData = {
      rows: [
        { id: 'doc-1', key: 'doc-1', value: { rev: '1-a' }, doc: { _id: 'doc-1', title: 'A' } },
        { id: 'doc-2', key: 'doc-2', value: { rev: '1-b' }, doc: { _id: 'doc-2', title: 'B' } },
      ],
      total_rows: 2,
      offset: 0,
    };

    const analysis = await engine.analyze(data);

    expect(analysis.collections).toEqual(['default']);
    expect(analysis.totalDocuments).toBe(2);
    expect(analysis.estimatedSizeBytes).toBeGreaterThan(0);
  });

  it('should perform dry run without modifying data', async () => {
    const engine = createMigrationEngine({ source: 'pouchdb' });
    const data: PouchDBData = {
      rows: [
        { id: 'doc-1', key: 'doc-1', value: { rev: '1-a' }, doc: { _id: 'doc-1', name: 'Alice' } },
        { id: 'doc-2', key: 'doc-2', value: { rev: '1-b' }, doc: { _id: 'doc-2', name: 'Bob' } },
      ],
    };

    const result = await engine.dryRun(data);

    expect(result.totalDocuments).toBe(2);
    expect(result.migratedDocuments).toBe(2);
    expect(result.failedDocuments).toBe(0);
    expect(result.skippedDocuments).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.collections).toHaveProperty('default');
  });

  it('should respect skipCollections config', async () => {
    const engine = createMigrationEngine({
      source: 'dexie',
      skipCollections: ['logs'],
    });
    const data: DexieData = {
      tables: {
        users: { schema: '++id, name', docs: [{ id: 1, name: 'Alice' }] },
        logs: { schema: '++id, message', docs: [{ id: 1, message: 'test' }] },
      },
    };

    const result = await engine.dryRun(data);

    expect(result.collections).toHaveProperty('users');
    expect(result.collections).not.toHaveProperty('logs');
  });

  it('should respect includeCollections config', async () => {
    const engine = createMigrationEngine({
      source: 'dexie',
      includeCollections: ['users'],
    });
    const data: DexieData = {
      tables: {
        users: { schema: '++id, name', docs: [{ id: 1, name: 'Alice' }] },
        logs: { schema: '++id, message', docs: [{ id: 1, message: 'test' }] },
      },
    };

    const result = await engine.dryRun(data);

    expect(result.collections).toHaveProperty('users');
    expect(result.collections).not.toHaveProperty('logs');
  });

  it('should apply transformDocument to each document', async () => {
    const transformed: string[] = [];
    const engine = createMigrationEngine({
      source: 'pouchdb',
      transformDocument: (doc) => {
        transformed.push(doc._id);
        return doc;
      },
    });
    const data: PouchDBData = {
      rows: [
        { id: 'a', key: 'a', value: { rev: '1-x' }, doc: { _id: 'a', v: 1 } },
        { id: 'b', key: 'b', value: { rev: '1-y' }, doc: { _id: 'b', v: 2 } },
      ],
    };

    await engine.dryRun(data);

    expect(transformed).toEqual(['a', 'b']);
  });

  it('should skip documents when transformDocument returns null', async () => {
    const engine = createMigrationEngine({
      source: 'pouchdb',
      transformDocument: (doc) => (doc._id === 'skip-me' ? null : doc),
    });
    const data: PouchDBData = {
      rows: [
        { id: 'keep', key: 'keep', value: { rev: '1-a' }, doc: { _id: 'keep', v: 1 } },
        { id: 'skip-me', key: 'skip-me', value: { rev: '1-b' }, doc: { _id: 'skip-me', v: 2 } },
      ],
    };

    const result = await engine.dryRun(data);

    expect(result.migratedDocuments).toBe(1);
    expect(result.skippedDocuments).toBe(1);
  });

  it('should emit progress events via progress$', async () => {
    const engine = createMigrationEngine({ source: 'pouchdb' });
    const phases: string[] = [];
    engine.progress$.subscribe((p) => phases.push(p.phase));

    const data: PouchDBData = {
      rows: [
        { id: 'd1', key: 'd1', value: { rev: '1-a' }, doc: { _id: 'd1', x: 1 } },
      ],
    };

    await engine.run(data);

    expect(phases).toContain('analyzing');
    expect(phases).toContain('migrating');
    expect(phases).toContain('complete');
  });

  it('should invoke onProgress callback', async () => {
    const progressUpdates: Array<{ phase: string; percent: number }> = [];
    const engine = createMigrationEngine({
      source: 'pouchdb',
      onProgress: (p) => progressUpdates.push({ phase: p.phase, percent: p.percent }),
    });
    const data: PouchDBData = {
      rows: [
        { id: 'd1', key: 'd1', value: { rev: '1-a' }, doc: { _id: 'd1', x: 1 } },
      ],
    };

    await engine.run(data);

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.some((u) => u.phase === 'complete')).toBe(true);
  });

  it('should throw for unsupported source type', async () => {
    const engine = createMigrationEngine({ source: 'unknown' as never });
    await expect(() => engine.analyze({})).rejects.toThrow('Unsupported migration source');
  });
});

// ---------------------------------------------------------------------------
// PouchDBAdapter
// ---------------------------------------------------------------------------

describe('PouchDBAdapter', () => {
  let adapter: PouchDBAdapter;
  const sampleData: PouchDBData = {
    rows: [
      {
        id: 'user-1',
        key: 'user-1',
        value: { rev: '2-abc' },
        doc: {
          _id: 'user-1',
          _rev: '2-abc',
          _attachments: { photo: {} },
          name: 'Alice',
          age: 30,
        },
      },
      {
        id: 'user-2',
        key: 'user-2',
        value: { rev: '1-def' },
        doc: {
          _id: 'user-2',
          _rev: '1-def',
          name: 'Bob',
          age: 25,
          active: true,
        },
      },
      {
        id: '_design/views',
        key: '_design/views',
        value: { rev: '1-xyz' },
        doc: { _id: '_design/views', views: {} },
      },
      {
        id: 'no-doc-row',
        key: 'no-doc-row',
        value: { rev: '1-000' },
        // row without doc property — should be skipped
      },
    ],
    total_rows: 4,
    offset: 0,
  };

  beforeEach(() => {
    adapter = new PouchDBAdapter(sampleData);
  });

  it('should detect PouchDB format (rows with doc property)', async () => {
    const docs = await adapter.getDocuments('default');
    expect(docs.length).toBe(2); // design doc and no-doc row excluded
    expect(docs.every((d) => typeof d._id === 'string')).toBe(true);
  });

  it('should extract collection names', async () => {
    const collections = await adapter.getCollections();
    expect(collections).toEqual(['default']);
  });

  it('should use custom collection name when provided', async () => {
    const customAdapter = new PouchDBAdapter({ ...sampleData, collection: 'users' });
    const collections = await customAdapter.getCollections();
    expect(collections).toEqual(['users']);
  });

  it('should skip design documents (ids starting with _design/)', async () => {
    const docs = await adapter.getDocuments('default');
    const ids = docs.map((d) => d._id);
    expect(ids).not.toContain('_design/views');
  });

  it('should strip CouchDB metadata (_rev, _attachments)', async () => {
    const docs = await adapter.getDocuments('default');
    const alice = docs.find((d) => d._id === 'user-1')!;

    // _rev and _attachments should NOT be top-level fields
    expect(alice).not.toHaveProperty('_rev');
    expect(alice).not.toHaveProperty('_attachments');
  });

  it('should store stripped CouchDB metadata in _meta', async () => {
    const docs = await adapter.getDocuments('default');
    const alice = docs.find((d) => d._id === 'user-1')!;

    expect(alice._meta).toBeDefined();
    expect(alice._meta!._rev).toBe('2-abc');
    expect(alice._meta!._attachments).toEqual({ photo: {} });
  });

  it('should map field types correctly from sample documents', async () => {
    const schema = await adapter.getSchema('default');

    const nameField = schema.fieldMappings.find((f) => f.sourceField === 'name');
    const ageField = schema.fieldMappings.find((f) => f.sourceField === 'age');

    expect(nameField?.type).toBe('string');
    expect(ageField?.type).toBe('number');
  });

  it('should return correct document count', async () => {
    const count = await adapter.getDocumentCount('default');
    expect(count).toBe(2);
  });

  it('should support pagination via skip and limit', async () => {
    const page = await adapter.getDocuments('default', { skip: 1, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]!._id).toBe('user-2');
  });

  it('should return correct analysis', async () => {
    const analysis = await adapter.analyze();

    expect(analysis.collections).toEqual(['default']);
    expect(analysis.totalDocuments).toBe(2);
    expect(analysis.estimatedSizeBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DexieAdapter
// ---------------------------------------------------------------------------

describe('DexieAdapter', () => {
  let adapter: DexieAdapter;
  const sampleData: DexieData = {
    tables: {
      friends: {
        schema: '++id, &email, name, *tags',
        docs: [
          { id: 1, email: 'alice@test.com', name: 'Alice', tags: ['dev', 'js'] },
          { id: 2, email: 'bob@test.com', name: 'Bob', tags: ['design'] },
        ],
      },
      settings: {
        schema: 'key',
        docs: [
          { key: 'theme', value: 'dark' },
        ],
      },
    },
  };

  beforeEach(() => {
    adapter = new DexieAdapter(sampleData);
  });

  it('should parse Dexie index syntax — ++id for auto-increment', async () => {
    const schema = await adapter.getSchema('friends');
    // ++id is the primary key; it gets removed from doc fields and used as _id
    const docs = await adapter.getDocuments('friends');
    expect(docs[0]!._id).toBe('1');
    // id should not remain as a regular field after processing
    expect(docs[0]).not.toHaveProperty('id');
  });

  it('should parse Dexie index syntax — &email for unique', async () => {
    const schema = await adapter.getSchema('friends');
    const emailField = schema.fieldMappings.find((f) => f.sourceField === 'email');
    expect(emailField).toBeDefined();
    expect(emailField!.type).toBe('string');
  });

  it('should parse Dexie index syntax — *tags for multi-entry', async () => {
    const schema = await adapter.getSchema('friends');
    const tagsField = schema.fieldMappings.find((f) => f.sourceField === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.type).toBe('array');
  });

  it('should extract table names', async () => {
    const collections = await adapter.getCollections();
    expect(collections).toContain('friends');
    expect(collections).toContain('settings');
    expect(collections).toHaveLength(2);
  });

  it('should infer schema from sample documents', async () => {
    const schema = await adapter.getSchema('friends');

    expect(schema.sourceCollection).toBe('friends');
    expect(schema.targetCollection).toBe('friends');
    expect(schema.fieldMappings.length).toBeGreaterThan(0);

    const nameField = schema.fieldMappings.find((f) => f.sourceField === 'name');
    expect(nameField?.type).toBe('string');
  });

  it('should return correct document count per table', async () => {
    expect(await adapter.getDocumentCount('friends')).toBe(2);
    expect(await adapter.getDocumentCount('settings')).toBe(1);
  });

  it('should return 0 for unknown collection', async () => {
    expect(await adapter.getDocumentCount('nonexistent')).toBe(0);
  });

  it('should support pagination', async () => {
    const page = await adapter.getDocuments('friends', { skip: 1, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]!._id).toBe('2');
  });

  it('should return correct analysis across all tables', async () => {
    const analysis = await adapter.analyze();

    expect(analysis.collections).toContain('friends');
    expect(analysis.collections).toContain('settings');
    expect(analysis.totalDocuments).toBe(3);
    expect(analysis.estimatedSizeBytes).toBeGreaterThan(0);
  });

  it('should handle table without schema definition', async () => {
    const data: DexieData = {
      tables: {
        notes: {
          docs: [{ id: 'n1', text: 'hello' }],
        },
      },
    };
    const a = new DexieAdapter(data);
    const docs = await a.getDocuments('notes');
    // Without schema, primary key defaults to 'id'
    expect(docs[0]!._id).toBe('n1');
  });
});

// ---------------------------------------------------------------------------
// FirestoreAdapter
// ---------------------------------------------------------------------------

describe('FirestoreAdapter', () => {
  let adapter: FirestoreAdapter;
  const sampleData: FirestoreData = {
    collections: {
      users: {
        docs: [
          {
            id: 'user-1',
            data: {
              name: 'Alice',
              age: 30,
              createdAt: { _seconds: 1700000000, _nanoseconds: 0 },
              location: { _latitude: 40.7128, _longitude: -74.006 },
              profileRef: { _path: 'profiles/user-1' },
            },
            subcollections: {
              posts: {
                docs: [
                  { id: 'post-1', data: { title: 'Hello World', likes: 5 } },
                  { id: 'post-2', data: { title: 'Second Post', likes: 10 } },
                ],
              },
            },
          },
          {
            id: 'user-2',
            data: {
              name: 'Bob',
              age: 25,
              createdAt: { _seconds: 1700100000, _nanoseconds: 500000000 },
            },
          },
        ],
      },
      settings: {
        docs: [
          { id: 'global', data: { theme: 'dark', version: 2 } },
        ],
      },
    },
  };

  beforeEach(() => {
    adapter = new FirestoreAdapter(sampleData);
  });

  it('should handle Firestore timestamp format', async () => {
    const docs = await adapter.getDocuments('users');
    const alice = docs.find((d) => d._id === 'user-1')!;

    // Timestamp should be converted to ISO string
    expect(typeof alice.createdAt).toBe('string');
    const date = new Date(alice.createdAt as string);
    expect(date.getTime()).toBe(1700000000 * 1000);
  });

  it('should handle Firestore timestamp with nanoseconds', async () => {
    const docs = await adapter.getDocuments('users');
    const bob = docs.find((d) => d._id === 'user-2')!;

    expect(typeof bob.createdAt).toBe('string');
    const date = new Date(bob.createdAt as string);
    // 1700100000 * 1000 + 500000000 / 1_000_000 = 1700100000500
    expect(date.getTime()).toBe(1700100000500);
  });

  it('should convert GeoPoint to lat/lng object', async () => {
    const docs = await adapter.getDocuments('users');
    const alice = docs.find((d) => d._id === 'user-1')!;

    expect(alice.location).toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it('should convert DocumentReference to path string', async () => {
    const docs = await adapter.getDocuments('users');
    const alice = docs.find((d) => d._id === 'user-1')!;

    expect(alice.profileRef).toBe('profiles/user-1');
  });

  it('should flatten subcollections', async () => {
    const collections = await adapter.getCollections();

    expect(collections).toContain('users');
    expect(collections).toContain('users/posts');
    expect(collections).toContain('settings');
  });

  it('should provide flattened subcollection documents', async () => {
    const posts = await adapter.getDocuments('users/posts');

    expect(posts).toHaveLength(2);
    expect(posts[0]!._id).toBe('post-1');
    expect(posts[0]!.title).toBe('Hello World');
    expect(posts[1]!._id).toBe('post-2');
  });

  it('should use path prefix as target collection with slash replaced', async () => {
    const schema = await adapter.getSchema('users/posts');

    expect(schema.sourceCollection).toBe('users/posts');
    expect(schema.targetCollection).toBe('users_posts');
  });

  it('should return correct analysis', async () => {
    const analysis = await adapter.analyze();

    // users(2) + users/posts(2) + settings(1) = 5
    expect(analysis.totalDocuments).toBe(5);
    expect(analysis.collections).toContain('users');
    expect(analysis.collections).toContain('users/posts');
    expect(analysis.collections).toContain('settings');
    expect(analysis.estimatedSizeBytes).toBeGreaterThan(0);
  });

  it('should return correct document count per collection', async () => {
    expect(await adapter.getDocumentCount('users')).toBe(2);
    expect(await adapter.getDocumentCount('users/posts')).toBe(2);
    expect(await adapter.getDocumentCount('settings')).toBe(1);
  });

  it('should support pagination', async () => {
    const page = await adapter.getDocuments('users', { skip: 1, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]!._id).toBe('user-2');
  });

  it('should infer field mappings from sample document', async () => {
    const schema = await adapter.getSchema('users');

    const nameField = schema.fieldMappings.find((f) => f.sourceField === 'name');
    const ageField = schema.fieldMappings.find((f) => f.sourceField === 'age');

    expect(nameField?.type).toBe('string');
    expect(ageField?.type).toBe('number');
  });

  it('should return empty docs for unknown collection', async () => {
    const docs = await adapter.getDocuments('nonexistent');
    expect(docs).toEqual([]);
  });

  it('should handle deeply nested subcollections', async () => {
    const deepData: FirestoreData = {
      collections: {
        orgs: {
          docs: [
            {
              id: 'org-1',
              data: { name: 'Acme' },
              subcollections: {
                teams: {
                  docs: [
                    {
                      id: 'team-1',
                      data: { name: 'Engineering' },
                      subcollections: {
                        members: {
                          docs: [
                            { id: 'member-1', data: { name: 'Alice' } },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    const deepAdapter = new FirestoreAdapter(deepData);
    const collections = await deepAdapter.getCollections();

    expect(collections).toContain('orgs');
    expect(collections).toContain('orgs/teams');
    expect(collections).toContain('orgs/teams/members');

    const members = await deepAdapter.getDocuments('orgs/teams/members');
    expect(members).toHaveLength(1);
    expect(members[0]!.name).toBe('Alice');
  });

  it('should convert Firestore types inside arrays', async () => {
    const arrayData: FirestoreData = {
      collections: {
        events: {
          docs: [
            {
              id: 'evt-1',
              data: {
                timestamps: [
                  { _seconds: 1700000000, _nanoseconds: 0 },
                  { _seconds: 1700100000, _nanoseconds: 0 },
                ],
              },
            },
          ],
        },
      },
    };

    const arrayAdapter = new FirestoreAdapter(arrayData);
    const docs = await arrayAdapter.getDocuments('events');
    const timestamps = docs[0]!.timestamps as string[];

    expect(Array.isArray(timestamps)).toBe(true);
    expect(typeof timestamps[0]).toBe('string');
    expect(typeof timestamps[1]).toBe('string');
  });
});

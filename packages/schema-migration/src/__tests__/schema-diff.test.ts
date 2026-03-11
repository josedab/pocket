import { describe, expect, it } from 'vitest';
import { diffSchemas, generateMigrationSteps } from '../schema-diff.js';
import type { CollectionSchema, DatabaseSchema } from '../types.js';

const usersCollection: CollectionSchema = {
  name: 'users',
  version: 1,
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'age', type: 'number' },
  ],
  indexes: [{ name: 'idx_email', fields: ['email'], unique: true }],
};

const todosCollection: CollectionSchema = {
  name: 'todos',
  version: 1,
  fields: [
    { name: 'title', type: 'string', required: true },
    { name: 'completed', type: 'boolean' },
  ],
};

describe('diffSchemas', () => {
  it('detects no changes for identical schemas', () => {
    const schema: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const diff = diffSchemas(schema, schema);
    expect(diff.changes).toHaveLength(0);
    expect(diff.isBreaking).toBe(false);
    expect(diff.summary).toBe('No changes detected');
  });

  it('detects added collection', () => {
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [usersCollection, todosCollection] };

    const diff = diffSchemas(from, to);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]!.type).toBe('collection_added');
    expect(diff.isBreaking).toBe(false);
  });

  it('detects removed collection (breaking)', () => {
    const from: DatabaseSchema = { version: 1, collections: [usersCollection, todosCollection] };
    const to: DatabaseSchema = { version: 2, collections: [usersCollection] };

    const diff = diffSchemas(from, to);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]!.type).toBe('collection_removed');
    expect(diff.isBreaking).toBe(true);
  });

  it('detects added field', () => {
    const updated: CollectionSchema = {
      ...usersCollection,
      fields: [...usersCollection.fields, { name: 'bio', type: 'string' }],
    };
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [updated] };

    const diff = diffSchemas(from, to);
    const addedField = diff.changes.find((c) => c.type === 'field_added');
    expect(addedField).toBeDefined();
    expect(diff.isBreaking).toBe(false);
  });

  it('detects removed field (breaking)', () => {
    const reduced: CollectionSchema = {
      ...usersCollection,
      fields: usersCollection.fields.filter((f) => f.name !== 'age'),
    };
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [reduced] };

    const diff = diffSchemas(from, to);
    const removed = diff.changes.find((c) => c.type === 'field_removed');
    expect(removed).toBeDefined();
    expect(diff.isBreaking).toBe(true);
  });

  it('detects modified field type', () => {
    const modified: CollectionSchema = {
      ...usersCollection,
      fields: usersCollection.fields.map((f) =>
        f.name === 'age' ? { ...f, type: 'string' as const } : f
      ),
    };
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [modified] };

    const diff = diffSchemas(from, to);
    const mod = diff.changes.find((c) => c.type === 'field_modified');
    expect(mod).toBeDefined();
    if (mod?.type === 'field_modified') {
      expect(mod.fieldName).toBe('age');
      expect(mod.changes.type).toBe('string');
    }
  });

  it('detects modified field required flag', () => {
    const modified: CollectionSchema = {
      ...usersCollection,
      fields: usersCollection.fields.map((f) => (f.name === 'age' ? { ...f, required: true } : f)),
    };
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [modified] };

    const diff = diffSchemas(from, to);
    const mod = diff.changes.find((c) => c.type === 'field_modified');
    expect(mod).toBeDefined();
  });

  it('detects added index', () => {
    const withIndex: CollectionSchema = {
      ...todosCollection,
      indexes: [{ name: 'idx_title', fields: ['title'] }],
    };
    const from: DatabaseSchema = { version: 1, collections: [todosCollection] };
    const to: DatabaseSchema = { version: 2, collections: [withIndex] };

    const diff = diffSchemas(from, to);
    const added = diff.changes.find((c) => c.type === 'index_added');
    expect(added).toBeDefined();
  });

  it('detects removed index', () => {
    const noIndex: CollectionSchema = { ...usersCollection, indexes: [] };
    const from: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const to: DatabaseSchema = { version: 2, collections: [noIndex] };

    const diff = diffSchemas(from, to);
    const removed = diff.changes.find((c) => c.type === 'index_removed');
    expect(removed).toBeDefined();
  });

  it('handles collections with no indexes', () => {
    const from: DatabaseSchema = { version: 1, collections: [todosCollection] };
    const to: DatabaseSchema = { version: 2, collections: [todosCollection] };

    const diff = diffSchemas(from, to);
    expect(diff.changes).toHaveLength(0);
  });

  it('includes summary with change count', () => {
    const from: DatabaseSchema = { version: 1, collections: [] };
    const to: DatabaseSchema = { version: 2, collections: [usersCollection, todosCollection] };

    const diff = diffSchemas(from, to);
    expect(diff.summary).toContain('2 change(s)');
  });
});

describe('generateMigrationSteps', () => {
  it('generates createCollection step for added collection', () => {
    const diff = diffSchemas(
      { version: 1, collections: [] },
      { version: 2, collections: [todosCollection] }
    );
    const { up, down } = generateMigrationSteps(diff);

    expect(up).toHaveLength(1);
    expect(up[0]!.type).toBe('createCollection');
    expect(down).toHaveLength(1);
    expect(down[0]!.type).toBe('dropCollection');
  });

  it('generates dropCollection step for removed collection', () => {
    const diff = diffSchemas(
      { version: 1, collections: [todosCollection] },
      { version: 2, collections: [] }
    );
    const { up } = generateMigrationSteps(diff);
    expect(up).toHaveLength(1);
    expect(up[0]!.type).toBe('dropCollection');
  });

  it('generates addField / removeField steps', () => {
    const updated: CollectionSchema = {
      ...usersCollection,
      fields: [...usersCollection.fields, { name: 'bio', type: 'string' }],
    };
    const diff = diffSchemas(
      { version: 1, collections: [usersCollection] },
      { version: 2, collections: [updated] }
    );
    const { up, down } = generateMigrationSteps(diff);
    expect(up.some((s) => s.type === 'addField')).toBe(true);
    expect(down.some((s) => s.type === 'removeField')).toBe(true);
  });

  it('generates index steps', () => {
    const withIndex: CollectionSchema = {
      ...todosCollection,
      indexes: [{ name: 'idx_title', fields: ['title'], unique: false }],
    };
    const diff = diffSchemas(
      { version: 1, collections: [todosCollection] },
      { version: 2, collections: [withIndex] }
    );
    const { up, down } = generateMigrationSteps(diff);
    expect(up.some((s) => s.type === 'addIndex')).toBe(true);
    expect(down.some((s) => s.type === 'removeIndex')).toBe(true);
  });

  it('returns empty steps for no changes', () => {
    const schema: DatabaseSchema = { version: 1, collections: [usersCollection] };
    const diff = diffSchemas(schema, schema);
    const { up, down } = generateMigrationSteps(diff);
    expect(up).toHaveLength(0);
    expect(down).toHaveLength(0);
  });
});

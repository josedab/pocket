import { describe, expect, it } from 'vitest';
import type { DatabaseSchema } from '../schema-design-engine.js';
import { createSchemaDesignEngine, SchemaDesignEngine } from '../schema-design-engine.js';

describe('SchemaDesignEngine', () => {
  it('should add and retrieve collections', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({
      name: 'todos',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'completed', type: 'boolean', required: true },
      ],
      indexes: [],
    });

    const schema = engine.getSchema();
    expect(schema.collections).toHaveLength(1);
    expect(schema.collections[0]!.name).toBe('todos');
  });

  it('should add and remove fields', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({
      name: 'users',
      fields: [{ name: 'name', type: 'string', required: true }],
      indexes: [],
    });

    engine.addField('users', { name: 'email', type: 'string', required: true });
    expect(engine.getSchema().collections[0]!.fields).toHaveLength(2);

    engine.removeField('users', 'email');
    expect(engine.getSchema().collections[0]!.fields).toHaveLength(1);
  });

  it('should add relationships', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({ name: 'posts', fields: [], indexes: [] });
    engine.addCollection({ name: 'comments', fields: [], indexes: [] });
    engine.addRelationship({
      name: 'post_comments',
      sourceCollection: 'posts',
      sourceField: '_id',
      targetCollection: 'comments',
      targetField: 'postId',
      type: 'one-to-many',
    });

    expect(engine.getSchema().relationships).toHaveLength(1);
  });

  it('should add indexes', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({
      name: 'users',
      fields: [{ name: 'email', type: 'string', required: true }],
      indexes: [],
    });

    engine.addIndex('users', { name: 'email_idx', fields: ['email'], unique: true });
    expect(engine.getSchema().collections[0]!.indexes).toHaveLength(1);
  });

  it('should remove collections and cascade relationships', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({ name: 'a', fields: [], indexes: [] });
    engine.addCollection({ name: 'b', fields: [], indexes: [] });
    engine.addRelationship({
      name: 'a_b',
      sourceCollection: 'a',
      sourceField: 'id',
      targetCollection: 'b',
      targetField: 'aId',
      type: 'one-to-many',
    });

    engine.removeCollection('a');
    expect(engine.getSchema().collections).toHaveLength(1);
    expect(engine.getSchema().relationships).toHaveLength(0);
  });

  it('should load and bump version', () => {
    const engine = createSchemaDesignEngine();
    const schema: DatabaseSchema = {
      version: 5,
      collections: [{ name: 'test', fields: [], indexes: [] }],
      relationships: [],
    };
    engine.loadSchema(schema);
    expect(engine.getSchema().version).toBe(5);
    expect(engine.bumpVersion()).toBe(6);
  });
});

describe('SchemaDesignEngine.diff', () => {
  it('should detect added collections', () => {
    const from: DatabaseSchema = { version: 1, collections: [], relationships: [] };
    const to: DatabaseSchema = {
      version: 2,
      collections: [{ name: 'todos', fields: [], indexes: [] }],
      relationships: [],
    };

    const diff = SchemaDesignEngine.diff(from, to);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]!.type).toBe('add-collection');
    expect(diff.changes[0]!.breaking).toBe(false);
  });

  it('should detect removed collections as breaking', () => {
    const from: DatabaseSchema = {
      version: 1,
      collections: [{ name: 'old', fields: [], indexes: [] }],
      relationships: [],
    };
    const to: DatabaseSchema = { version: 2, collections: [], relationships: [] };

    const diff = SchemaDesignEngine.diff(from, to);
    expect(diff.changes[0]!.type).toBe('remove-collection');
    expect(diff.changes[0]!.breaking).toBe(true);
  });

  it('should detect added and removed fields', () => {
    const from: DatabaseSchema = {
      version: 1,
      collections: [
        {
          name: 'users',
          fields: [{ name: 'name', type: 'string', required: true }],
          indexes: [],
        },
      ],
      relationships: [],
    };
    const to: DatabaseSchema = {
      version: 2,
      collections: [
        {
          name: 'users',
          fields: [{ name: 'email', type: 'string', required: true }],
          indexes: [],
        },
      ],
      relationships: [],
    };

    const diff = SchemaDesignEngine.diff(from, to);
    const addField = diff.changes.find((c) => c.type === 'add-field');
    const removeField = diff.changes.find((c) => c.type === 'remove-field');
    expect(addField?.field).toBe('email');
    expect(removeField?.field).toBe('name');
    expect(removeField?.breaking).toBe(true);
  });

  it('should detect modified fields', () => {
    const from: DatabaseSchema = {
      version: 1,
      collections: [
        {
          name: 'items',
          fields: [{ name: 'count', type: 'string', required: true }],
          indexes: [],
        },
      ],
      relationships: [],
    };
    const to: DatabaseSchema = {
      version: 2,
      collections: [
        {
          name: 'items',
          fields: [{ name: 'count', type: 'number', required: true }],
          indexes: [],
        },
      ],
      relationships: [],
    };

    const diff = SchemaDesignEngine.diff(from, to);
    expect(diff.changes[0]!.type).toBe('modify-field');
    expect(diff.changes[0]!.breaking).toBe(true);
  });
});

describe('Code Generation', () => {
  it('should generate TypeScript interfaces', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({
      name: 'todos',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'completed', type: 'boolean', required: true },
        { name: 'tags', type: 'array', required: false, arrayItemType: 'string' },
        { name: 'priority', type: 'enum', required: true, enumValues: ['low', 'medium', 'high'] },
      ],
      indexes: [],
      timestamps: true,
    });

    const ts = engine.generateTypeScript();
    expect(ts).toContain('export interface Todos');
    expect(ts).toContain('title: string');
    expect(ts).toContain('completed: boolean');
    expect(ts).toContain('tags?: string[]');
    expect(ts).toContain("'low' | 'medium' | 'high'");
    expect(ts).toContain('_createdAt: Date');
  });

  it('should generate Zod schemas', () => {
    const engine = createSchemaDesignEngine();
    engine.addCollection({
      name: 'users',
      fields: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number', required: false },
      ],
      indexes: [],
    });

    const zod = engine.generateZodSchemas();
    expect(zod).toContain("import { z } from 'zod'");
    expect(zod).toContain('usersSchema = z.object');
    expect(zod).toContain('z.string()');
    expect(zod).toContain('z.number().optional()');
  });

  it('should generate migration scripts from diff', () => {
    const from: DatabaseSchema = { version: 1, collections: [], relationships: [] };
    const to: DatabaseSchema = {
      version: 2,
      collections: [{ name: 'todos', fields: [], indexes: [] }],
      relationships: [],
    };

    const diff = SchemaDesignEngine.diff(from, to);
    const migration = SchemaDesignEngine.generateMigration(diff);
    expect(migration).toContain('v1 → v2');
    expect(migration).toContain("createCollection('todos')");
  });
});

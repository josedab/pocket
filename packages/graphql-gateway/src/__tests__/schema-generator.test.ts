import { describe, it, expect } from 'vitest';
import { SchemaGenerator, createSchemaGenerator } from '../schema-generator.js';
import type { CollectionMapping } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todoMapping(): CollectionMapping {
  return {
    collection: 'todos',
    typeName: 'Todo',
    fields: { title: 'string', completed: 'boolean', priority: 'number' },
  };
}

/* ================================================================== */
/*  SchemaGenerator                                                    */
/* ================================================================== */

describe('SchemaGenerator', () => {
  describe('generateSchema', () => {
    it('should generate type definitions from collection mappings', () => {
      const gen = createSchemaGenerator({ collections: [todoMapping()] });
      const schema = gen.generateSchema();

      expect(schema.types).toHaveLength(1);
      const todoDef = schema.types[0];
      expect(todoDef.name).toBe('Todo');
      expect(todoDef.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'ID', required: true }),
          expect.objectContaining({ name: 'title', type: 'String', required: false }),
          expect.objectContaining({ name: 'completed', type: 'Boolean', required: false }),
          expect.objectContaining({ name: 'priority', type: 'Float', required: false }),
        ]),
      );
    });

    it('should generate query definitions (findAll, findById)', () => {
      const gen = createSchemaGenerator({ collections: [todoMapping()] });
      const schema = gen.generateSchema();

      const names = schema.queries.map((q) => q.name);
      expect(names).toContain('findAllTodos');
      expect(names).toContain('findTodoById');
      expect(names).toContain('findManyTodos');

      const findAll = schema.queries.find((q) => q.name === 'findAllTodos')!;
      expect(findAll.returnType).toBe('[Todo!]!');
      expect(findAll.args).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'filter' }),
          expect.objectContaining({ name: 'sort' }),
          expect.objectContaining({ name: 'limit' }),
        ]),
      );

      const findById = schema.queries.find((q) => q.name === 'findTodoById')!;
      expect(findById.args).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'ID', required: true }),
        ]),
      );
    });

    it('should generate mutation definitions (create, update, delete)', () => {
      const gen = createSchemaGenerator({
        collections: [todoMapping()],
        enableMutations: true,
      });
      const schema = gen.generateSchema();

      const names = schema.mutations.map((m) => m.name);
      expect(names).toContain('createTodo');
      expect(names).toContain('updateTodo');
      expect(names).toContain('deleteTodo');

      const del = schema.mutations.find((m) => m.name === 'deleteTodo')!;
      expect(del.returnType).toBe('Boolean!');
    });

    it('should generate subscription definitions', () => {
      const gen = createSchemaGenerator({
        collections: [todoMapping()],
        enableSubscriptions: true,
      });
      const schema = gen.generateSchema();

      expect(schema.subscriptions).toHaveLength(1);
      expect(schema.subscriptions[0].name).toBe('onTodoChange');
      expect(schema.subscriptions[0].returnType).toBe('Todo!');
    });

    it('should skip mutations when enableMutations is false', () => {
      const gen = createSchemaGenerator({
        collections: [todoMapping()],
        enableMutations: false,
      });
      const schema = gen.generateSchema();

      expect(schema.mutations).toHaveLength(0);
    });

    it('should skip subscriptions when enableSubscriptions is false', () => {
      const gen = createSchemaGenerator({
        collections: [todoMapping()],
        enableSubscriptions: false,
      });
      const schema = gen.generateSchema();

      expect(schema.subscriptions).toHaveLength(0);
    });
  });

  describe('generateSDL', () => {
    it('should generate a valid SDL string', () => {
      const gen = createSchemaGenerator({ collections: [todoMapping()] });
      const sdl = gen.generateSDL();

      expect(sdl).toContain('type Todo {');
      expect(sdl).toContain('id: ID!');
      expect(sdl).toContain('title: String');
      expect(sdl).toContain('type Query {');
      expect(sdl).toContain('findAllTodos');
      expect(sdl).toContain('type Mutation {');
      expect(sdl).toContain('type Subscription {');
    });

    it('should include custom scalars when configured', () => {
      const gen = createSchemaGenerator({
        collections: [todoMapping()],
        customScalars: ['DateTime', 'JSON'],
      });
      const sdl = gen.generateSDL();

      expect(sdl).toContain('scalar DateTime');
      expect(sdl).toContain('scalar JSON');
    });
  });

  describe('mapFieldType', () => {
    it('should map pocket types to GraphQL types', () => {
      const gen = new SchemaGenerator();

      expect(gen.mapFieldType('string')).toBe('String');
      expect(gen.mapFieldType('number')).toBe('Float');
      expect(gen.mapFieldType('integer')).toBe('Int');
      expect(gen.mapFieldType('boolean')).toBe('Boolean');
      expect(gen.mapFieldType('id')).toBe('ID');
      expect(gen.mapFieldType('json')).toBe('JSON');
      expect(gen.mapFieldType('object')).toBe('JSON');
      expect(gen.mapFieldType('array')).toBe('JSON');
    });

    it('should default unknown types to String', () => {
      const gen = new SchemaGenerator();
      expect(gen.mapFieldType('custom-thing')).toBe('String');
    });
  });

  describe('addCollection', () => {
    it('should add a collection dynamically', () => {
      const gen = createSchemaGenerator();

      expect(gen.generateSchema().types).toHaveLength(0);

      gen.addCollection(todoMapping());

      const schema = gen.generateSchema();
      expect(schema.types).toHaveLength(1);
      expect(schema.types[0].name).toBe('Todo');
    });
  });

  describe('nested object types', () => {
    it('should handle fields that map to JSON for nested objects', () => {
      const gen = createSchemaGenerator({
        collections: [
          {
            collection: 'posts',
            typeName: 'Post',
            fields: { title: 'string', metadata: 'object', tags: 'array' },
          },
        ],
      });

      const schema = gen.generateSchema();
      const postType = schema.types[0];

      const metaField = postType.fields.find((f) => f.name === 'metadata');
      expect(metaField?.type).toBe('JSON');

      const tagsField = postType.fields.find((f) => f.name === 'tags');
      expect(tagsField?.type).toBe('JSON');
    });
  });
});

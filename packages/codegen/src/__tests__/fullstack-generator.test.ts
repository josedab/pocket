import { describe, expect, it } from 'vitest';
import { createFullStackGenerator } from '../generators/fullstack-generator.js';
import type { PocketSchema } from '../types.js';

const testSchema: PocketSchema = {
  version: '1.0.0',
  collections: [
    {
      name: 'todos',
      description: 'Todo items',
      fields: {
        title: { type: 'string', required: true, validation: { min: 1, max: 200 } },
        completed: { type: 'boolean', default: false },
        priority: { type: 'number', validation: { min: 1, max: 5 } },
        tags: { type: 'array', items: { type: 'string' } },
      },
      timestamps: true,
      softDelete: true,
    },
    {
      name: 'users',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true, unique: true },
        role: { type: 'string', validation: { enum: ['admin', 'user'] } },
      },
      timestamps: true,
    },
  ],
};

describe('FullStackGenerator', () => {
  it('should generate all layers by default', () => {
    const gen = createFullStackGenerator({ schema: testSchema });
    const files = gen.generate();

    const paths = files.map((f) => f.path);
    expect(paths).toContainEqual(expect.stringContaining('types.ts'));
    expect(paths).toContainEqual(expect.stringContaining('validators.ts'));
    expect(paths).toContainEqual(expect.stringContaining('hooks.ts'));
    expect(paths).toContainEqual(expect.stringContaining('schema.graphql'));
    expect(paths).toContainEqual(expect.stringContaining('resolvers.ts'));
    expect(paths).toContainEqual(expect.stringContaining('openapi.json'));
    expect(paths).toContainEqual(expect.stringContaining('index.ts'));
  });

  it('should generate correct TypeScript types', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        types: true,
        validators: false,
        reactHooks: false,
        restApi: false,
        graphql: false,
        openapi: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const typesFile = files.find((f) => f.path.endsWith('types.ts'));

    expect(typesFile).toBeDefined();
    expect(typesFile!.content).toContain('export interface Todo');
    expect(typesFile!.content).toContain('title: string');
    expect(typesFile!.content).toContain('completed?: boolean');
    expect(typesFile!.content).toContain('createdAt: Date');
    expect(typesFile!.content).toContain('_deleted?: boolean');
    expect(typesFile!.content).toContain('export interface User');
  });

  it('should generate Zod validators with constraints', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        validators: true,
        types: false,
        reactHooks: false,
        restApi: false,
        graphql: false,
        openapi: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const validatorsFile = files.find((f) => f.path.endsWith('validators.ts'));

    expect(validatorsFile).toBeDefined();
    expect(validatorsFile!.content).toContain('TodoSchema');
    expect(validatorsFile!.content).toContain('z.string().min(1).max(200)');
    expect(validatorsFile!.content).toContain('.default(false)');
    expect(validatorsFile!.content).toContain('UserSchema');
  });

  it('should generate GraphQL schema and resolvers', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        graphql: true,
        types: false,
        validators: false,
        reactHooks: false,
        restApi: false,
        openapi: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const schemaFile = files.find((f) => f.path.endsWith('schema.graphql'));
    const resolversFile = files.find((f) => f.path.endsWith('resolvers.ts'));

    expect(schemaFile).toBeDefined();
    expect(schemaFile!.content).toContain('type Todo {');
    expect(schemaFile!.content).toContain('type Query {');
    expect(schemaFile!.content).toContain('type Mutation {');
    expect(schemaFile!.content).toContain('createTodo');
    expect(schemaFile!.content).toContain('input TodoInput {');

    expect(resolversFile).toBeDefined();
    expect(resolversFile!.content).toContain('Query');
    expect(resolversFile!.content).toContain('Mutation');
  });

  it('should generate valid OpenAPI 3.0 spec', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        openapi: true,
        types: false,
        validators: false,
        reactHooks: false,
        restApi: false,
        graphql: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const openapiFile = files.find((f) => f.path.endsWith('openapi.json'));

    expect(openapiFile).toBeDefined();
    const spec = JSON.parse(openapiFile!.content);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.paths['/todos']).toBeDefined();
    expect(spec.paths['/todos/{id}']).toBeDefined();
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.components.schemas.Todo).toBeDefined();
    expect(spec.components.schemas.User).toBeDefined();
  });

  it('should generate React hooks for each collection', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        reactHooks: true,
        types: false,
        validators: false,
        restApi: false,
        graphql: false,
        openapi: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const hooksFile = files.find((f) => f.path.endsWith('hooks.ts'));

    expect(hooksFile).toBeDefined();
    expect(hooksFile!.content).toContain('useTodos');
    expect(hooksFile!.content).toContain('useTodo');
    expect(hooksFile!.content).toContain('useTodoCollection');
    expect(hooksFile!.content).toContain('useUsers');
  });

  it('should support dryRun to preview generation', () => {
    const gen = createFullStackGenerator({ schema: testSchema });
    const summary = gen.dryRun();

    expect(summary.fileCount).toBeGreaterThan(5);
    expect(summary.layerCount).toBeGreaterThan(3);
  });

  it('should respect custom output directory', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      outputDir: 'src/generated',
    });
    const files = gen.generate();

    for (const file of files) {
      expect(file.path).toMatch(/^src\/generated\//);
    }
  });

  it('should generate REST API routes per collection', () => {
    const gen = createFullStackGenerator({
      schema: testSchema,
      layers: {
        restApi: true,
        types: false,
        validators: false,
        reactHooks: false,
        graphql: false,
        openapi: false,
        migrations: false,
      },
    });
    const files = gen.generate();
    const todoRoutes = files.find((f) => f.path.includes('todos.routes.ts'));

    expect(todoRoutes).toBeDefined();
    expect(todoRoutes!.content).toContain('list');
    expect(todoRoutes!.content).toContain('getById');
    expect(todoRoutes!.content).toContain('create');
    expect(todoRoutes!.content).toContain('update');
    expect(todoRoutes!.content).toContain('delete');
  });
});

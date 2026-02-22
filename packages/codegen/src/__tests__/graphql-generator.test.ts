import { describe, it, expect } from 'vitest';
import { GraphQLGenerator, createGraphQLGenerator } from '../generators/graphql-generator.js';
import type { CollectionSchema } from '../types.js';

const SCHEMAS: CollectionSchema[] = [
  {
    name: 'todos',
    fields: {
      title: { type: 'string', required: true },
      completed: { type: 'boolean' },
      priority: { type: 'number', validation: { min: 1, max: 5 } },
      dueDate: { type: 'date' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
  {
    name: 'users',
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true, unique: true },
      age: { type: 'number' },
    },
  },
];

describe('GraphQLGenerator', () => {
  let generator: GraphQLGenerator;

  beforeEach(() => {
    generator = createGraphQLGenerator();
  });

  describe('generate', () => {
    it('should produce two files (SDL + resolvers)', () => {
      const files = generator.generate(SCHEMAS);
      expect(files).toHaveLength(2);
      expect(files[0]!.path).toBe('schema.graphql');
      expect(files[1]!.path).toBe('resolvers.ts');
    });
  });

  describe('generateSDL', () => {
    it('should produce valid GraphQL SDL', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('type Todo');
      expect(sdl).toContain('type User');
      expect(sdl).toContain('type Query');
      expect(sdl).toContain('type Mutation');
    });

    it('should include scalar types', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('scalar DateTime');
      expect(sdl).toContain('scalar JSON');
    });

    it('should generate correct field types', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('title: String!');
      expect(sdl).toContain('completed: Boolean');
      expect(sdl).toContain('dueDate: DateTime');
    });

    it('should generate query operations', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('todo(id: ID!): Todo');
      expect(sdl).toContain('user(id: ID!): User');
    });

    it('should generate mutation operations', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('createTodo(input: CreateTodoInput!): Todo!');
      expect(sdl).toContain('updateTodo(id: ID!, input: UpdateTodoInput!): Todo');
      expect(sdl).toContain('deleteTodo(id: ID!): Boolean!');
      expect(sdl).toContain('bulkDeleteTodos(ids: [ID!]!): Int!');
    });

    it('should generate input types', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('input CreateTodoInput');
      expect(sdl).toContain('input UpdateTodoInput');
    });

    it('should generate filter input types', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('input TodoFilterInput');
      expect(sdl).toContain('title_contains: String');
      expect(sdl).toContain('priority_gt:');
    });

    it('should generate subscriptions by default', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('type Subscription');
      expect(sdl).toContain('todoCreated: Todo!');
      expect(sdl).toContain('todoUpdated: Todo!');
      expect(sdl).toContain('todoDeleted: ID!');
    });

    it('should skip subscriptions when disabled', () => {
      const g = createGraphQLGenerator({ subscriptions: false });
      const sdl = g.generateSDL(SCHEMAS);
      expect(sdl).not.toContain('type Subscription');
    });

    it('should generate Relay connections by default', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('type TodoConnection');
      expect(sdl).toContain('type TodoEdge');
      expect(sdl).toContain('type PageInfo');
      expect(sdl).toContain('hasNextPage: Boolean!');
    });

    it('should generate array types correctly', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('[String]');
    });

    it('should include timestamp fields', () => {
      const sdl = generator.generateSDL(SCHEMAS);
      expect(sdl).toContain('_createdAt: DateTime');
      expect(sdl).toContain('_updatedAt: DateTime');
    });
  });

  describe('generateResolvers', () => {
    it('should produce TypeScript resolver code', () => {
      const code = generator.generateResolvers(SCHEMAS);
      expect(code).toContain('export const resolvers');
      expect(code).toContain('Query:');
      expect(code).toContain('Mutation:');
    });

    it('should generate query resolvers for each collection', () => {
      const code = generator.generateResolvers(SCHEMAS);
      expect(code).toContain("todo: async");
      expect(code).toContain("user: async");
      expect(code).toContain("db.collection('todos')");
      expect(code).toContain("db.collection('users')");
    });

    it('should generate CRUD mutation resolvers', () => {
      const code = generator.generateResolvers(SCHEMAS);
      expect(code).toContain('createTodo:');
      expect(code).toContain('updateTodo:');
      expect(code).toContain('deleteTodo:');
      expect(code).toContain('bulkDeleteTodos:');
    });

    it('should include Database type import', () => {
      const code = generator.generateResolvers(SCHEMAS);
      expect(code).toContain("import type { Database } from '@pocket/core'");
    });
  });

  describe('configuration', () => {
    it('should accept custom header comment', () => {
      const g = createGraphQLGenerator({ headerComment: '# Custom header' });
      const sdl = g.generateSDL(SCHEMAS);
      expect(sdl).toContain('# Custom header');
    });
  });
});

import { beforeEach } from 'vitest';

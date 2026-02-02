import { describe, it, expect, vi } from 'vitest';
import { generateSchema } from '../schema-generator.js';
import { generateResolvers, createResolverContext } from '../resolver-generator.js';
import type { CollectionDefinition, DatabaseLike } from '../types.js';

const collections: CollectionDefinition[] = [
  {
    name: 'todos',
    description: 'Todo items',
    fields: {
      title: { type: 'string', required: true, description: 'Todo title' },
      completed: { type: 'boolean' },
      priority: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
      dueDate: { type: 'date' },
    },
  },
  {
    name: 'users',
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      active: { type: 'boolean' },
    },
  },
];

describe('generateSchema', () => {
  it('should generate valid GraphQL SDL', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('scalar DateTime');
    expect(schema).toContain('scalar JSON');
    expect(schema).toContain('type Todo {');
    expect(schema).toContain('type User {');
  });

  it('should include _id field in types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('_id: ID!');
  });

  it('should mark required fields with !', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('title: String!');
    expect(schema).toContain('name: String!');
  });

  it('should generate query types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('type Query {');
    expect(schema).toContain('todos(filter: TodoFilter): [Todo!]!');
    expect(schema).toContain('todoById(id: ID!): Todo');
    expect(schema).toContain('users(filter: UserFilter): [User!]!');
  });

  it('should generate mutation types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('type Mutation {');
    expect(schema).toContain('createTodo(input: CreateTodoInput!): Todo!');
    expect(schema).toContain('updateTodo(id: ID!, input: UpdateTodoInput!): Todo!');
    expect(schema).toContain('deleteTodo(id: ID!): Boolean!');
  });

  it('should generate subscription types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('type Subscription {');
    expect(schema).toContain('todosChanged: Todo!');
  });

  it('should omit subscriptions when disabled', () => {
    const schema = generateSchema({ collections, includeSubscriptions: false });
    expect(schema).not.toContain('type Subscription');
  });

  it('should omit mutations when disabled', () => {
    const schema = generateSchema({ collections, includeMutations: false });
    expect(schema).not.toContain('type Mutation');
  });

  it('should generate input types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('input CreateTodoInput {');
    expect(schema).toContain('input UpdateTodoInput {');
    expect(schema).toContain('input TodoFilter {');
  });

  it('should include field descriptions', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('Todo title');
  });

  it('should handle array types', () => {
    const schema = generateSchema({ collections });
    expect(schema).toContain('[String]');
  });
});

describe('generateResolvers', () => {
  function createMockDB(): DatabaseLike {
    const mockCollection = {
      get: vi.fn().mockResolvedValue({ _id: '1', title: 'Test' }),
      find: vi.fn().mockResolvedValue([{ _id: '1', title: 'Test' }]),
      insert: vi.fn().mockImplementation((doc) => Promise.resolve(doc)),
      update: vi.fn().mockResolvedValue({ _id: '1', title: 'Updated' }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    return {
      collection: vi.fn().mockReturnValue(mockCollection),
    };
  }

  it('should generate Query and Mutation resolvers', () => {
    const resolvers = generateResolvers(collections);
    expect(resolvers.Query).toBeDefined();
    expect(resolvers.Mutation).toBeDefined();
  });

  it('should create list resolver for each collection', () => {
    const resolvers = generateResolvers(collections);
    expect(resolvers.Query.todos).toBeTypeOf('function');
    expect(resolvers.Query.users).toBeTypeOf('function');
  });

  it('should create getById resolver', () => {
    const resolvers = generateResolvers(collections);
    expect(resolvers.Query.todoById).toBeTypeOf('function');
    expect(resolvers.Query.userById).toBeTypeOf('function');
  });

  it('should create mutation resolvers', () => {
    const resolvers = generateResolvers(collections);
    expect(resolvers.Mutation.createTodo).toBeTypeOf('function');
    expect(resolvers.Mutation.updateTodo).toBeTypeOf('function');
    expect(resolvers.Mutation.deleteTodo).toBeTypeOf('function');
  });

  it('should execute list query', async () => {
    const db = createMockDB();
    const resolvers = generateResolvers(collections);
    const context = createResolverContext(db);

    const result = await resolvers.Query.todos!(null, { filter: {} }, context);
    expect(result).toEqual([{ _id: '1', title: 'Test' }]);
    expect(db.collection).toHaveBeenCalledWith('todos');
  });

  it('should execute getById query', async () => {
    const db = createMockDB();
    const resolvers = generateResolvers(collections);
    const context = createResolverContext(db);

    const result = await resolvers.Query.todoById!(null, { id: '1' }, context);
    expect(result).toEqual({ _id: '1', title: 'Test' });
  });

  it('should execute create mutation', async () => {
    const db = createMockDB();
    const resolvers = generateResolvers(collections);
    const context = createResolverContext(db);

    const result = await resolvers.Mutation.createTodo!(
      null,
      { input: { title: 'New' } },
      context,
    );
    expect(result).toBeDefined();
  });

  it('should execute delete mutation', async () => {
    const db = createMockDB();
    const resolvers = generateResolvers(collections);
    const context = createResolverContext(db);

    const result = await resolvers.Mutation.deleteTodo!(null, { id: '1' }, context);
    expect(result).toBe(true);
  });

  it('should pass filter args to collection.find', async () => {
    const db = createMockDB();
    const resolvers = generateResolvers(collections);
    const context = createResolverContext(db);

    await resolvers.Query.todos!(null, { filter: { completed: true, _limit: 10 } }, context);
    const col = db.collection('todos');
    expect(col.find).toHaveBeenCalledWith({
      filter: { completed: true },
      limit: 10,
      skip: undefined,
    });
  });
});

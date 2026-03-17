import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ResolverFactory, createResolverFactory } from '../resolver-factory.js';
import type { CollectionAccessor, CollectionChangeEvent, SchemaDefinition } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function mockCollection(overrides: Partial<CollectionAccessor> = {}): CollectionAccessor {
  const subject = new Subject<CollectionChangeEvent>();
  return {
    get: vi.fn().mockResolvedValue({ id: '1', title: 'found' }),
    find: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
    count: vi.fn().mockResolvedValue(42),
    insert: vi.fn().mockImplementation(async (doc) => ({ id: 'new-1', ...doc })),
    update: vi.fn().mockImplementation(async (id, changes) => ({ id, ...changes })),
    delete: vi.fn().mockResolvedValue(undefined),
    changes: vi.fn().mockReturnValue(subject.asObservable()),
    ...overrides,
  };
}

const SCHEMA: SchemaDefinition = {
  types: [],
  queries: [
    { name: 'getTodo', returnType: 'Todo' },
    { name: 'listTodos', returnType: '[Todo!]!' },
    { name: 'countTodos', returnType: 'Int!' },
    { name: 'findAllTodos', returnType: '[Todo!]!' },
    { name: 'findManyTodos', returnType: '[Todo!]!' },
  ],
  mutations: [
    { name: 'createTodo', returnType: 'Todo!' },
    { name: 'updateTodo', returnType: 'Todo!' },
    { name: 'deleteTodo', returnType: 'Boolean!' },
  ],
  subscriptions: [
    { name: 'onTodoCreated', returnType: 'Todo!' },
    { name: 'onTodoUpdated', returnType: 'Todo!' },
    { name: 'onTodoDeleted', returnType: 'Todo!' },
  ],
};

/* ------------------------------------------------------------------ */
/*  Stub-mode tests (no database)                                       */
/* ------------------------------------------------------------------ */

describe('ResolverFactory – stub mode (no database)', () => {
  const factory = new ResolverFactory();
  const resolvers = factory.createResolvers(SCHEMA);

  it('creates query, mutation and subscription maps', () => {
    expect(resolvers.Query).toBeDefined();
    expect(resolvers.Mutation).toBeDefined();
    expect(resolvers.Subscription).toBeDefined();
  });

  it('query stubs return [] for list/findAll/findMany names', async () => {
    expect(await resolvers.Query.listTodos({})).toEqual([]);
    expect(await resolvers.Query.findAllTodos({})).toEqual([]);
    expect(await resolvers.Query.findManyTodos({})).toEqual([]);
  });

  it('query stubs return 0 for count names', async () => {
    expect(await resolvers.Query.countTodos({})).toBe(0);
  });

  it('query stubs return null for get-by-id names', async () => {
    expect(await resolvers.Query.getTodo({ id: '1' })).toBeNull();
  });

  it('mutation stubs return mock object for create/update', async () => {
    const created = (await resolvers.Mutation.createTodo({
      input: { title: 'Test' },
    })) as Record<string, unknown>;
    expect(created.title).toBe('Test');
  });

  it('mutation stubs return true for delete', async () => {
    expect(await resolvers.Mutation.deleteTodo({ id: '1' })).toBe(true);
  });

  it('subscription stubs return an Observable', () => {
    const obs$ = resolvers.Subscription.onTodoCreated({});
    expect(obs$).toBeDefined();
    expect(typeof obs$.subscribe).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/*  Database-backed tests                                               */
/* ------------------------------------------------------------------ */

describe('ResolverFactory – database-backed mode', () => {
  const col = mockCollection();

  const factory = new ResolverFactory({
    collections: [{ collection: 'todos', typeName: 'Todo' }],
    getCollection: (name) => (name === 'todos' ? col : undefined),
  });

  const resolvers = factory.createResolvers(SCHEMA);

  /* -- Queries --------------------------------------------------- */

  it('getTodo delegates to collection.get(id)', async () => {
    const result = await resolvers.Query.getTodo({ id: '1' });
    expect(col.get).toHaveBeenCalledWith('1');
    expect(result).toEqual({ id: '1', title: 'found' });
  });

  it('listTodos delegates to collection.find(options)', async () => {
    const args = {
      filter: { completed: true },
      limit: 10,
      offset: 5,
      sortBy: 'title',
      sortOrder: 'asc',
    };
    const result = await resolvers.Query.listTodos(args);
    expect(col.find).toHaveBeenCalledWith({
      filter: { completed: true },
      limit: 10,
      offset: 5,
      sortBy: 'title',
      sortOrder: 'asc',
    });
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('findAllTodos delegates to collection.find()', async () => {
    await resolvers.Query.findAllTodos({});
    expect(col.find).toHaveBeenCalled();
  });

  it('findManyTodos delegates to collection.find()', async () => {
    await resolvers.Query.findManyTodos({});
    expect(col.find).toHaveBeenCalled();
  });

  it('countTodos delegates to collection.count(filter)', async () => {
    const result = await resolvers.Query.countTodos({ filter: { completed: false } });
    expect(col.count).toHaveBeenCalledWith({ completed: false });
    expect(result).toBe(42);
  });

  /* -- Mutations ------------------------------------------------- */

  it('createTodo delegates to collection.insert(input)', async () => {
    const result = await resolvers.Mutation.createTodo({ input: { title: 'New' } });
    expect(col.insert).toHaveBeenCalledWith({ title: 'New' });
    expect(result).toEqual({ id: 'new-1', title: 'New' });
  });

  it('updateTodo delegates to collection.update(id, input)', async () => {
    const result = await resolvers.Mutation.updateTodo({ id: '1', input: { title: 'Updated' } });
    expect(col.update).toHaveBeenCalledWith('1', { title: 'Updated' });
    expect(result).toEqual({ id: '1', title: 'Updated' });
  });

  it('deleteTodo delegates to collection.delete(id)', async () => {
    const result = await resolvers.Mutation.deleteTodo({ id: '1' });
    expect(col.delete).toHaveBeenCalledWith('1');
    expect(result).toBe(true);
  });

  /* -- Subscriptions --------------------------------------------- */

  it('onTodoCreated filters changes for insert events', () => {
    const changeSubject = new Subject<CollectionChangeEvent>();
    const subCol = mockCollection({
      changes: vi.fn().mockReturnValue(changeSubject.asObservable()),
    });
    const subFactory = new ResolverFactory({
      collections: [{ collection: 'todos', typeName: 'Todo' }],
      getCollection: () => subCol,
    });
    const subResolvers = subFactory.createResolvers(SCHEMA);

    const obs$ = subResolvers.Subscription.onTodoCreated({});
    const values: unknown[] = [];
    obs$.subscribe((v) => values.push(v));

    changeSubject.next({ operation: 'insert', documentId: '1', document: { id: '1' } });
    changeSubject.next({ operation: 'update', documentId: '1', document: { id: '1' } });
    changeSubject.next({ operation: 'insert', documentId: '2', document: { id: '2' } });

    expect(values).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('onTodoUpdated filters changes for update events', () => {
    const changeSubject = new Subject<CollectionChangeEvent>();
    const subCol = mockCollection({
      changes: vi.fn().mockReturnValue(changeSubject.asObservable()),
    });
    const subFactory = new ResolverFactory({
      collections: [{ collection: 'todos', typeName: 'Todo' }],
      getCollection: () => subCol,
    });
    const subResolvers = subFactory.createResolvers(SCHEMA);

    const obs$ = subResolvers.Subscription.onTodoUpdated({});
    const values: unknown[] = [];
    obs$.subscribe((v) => values.push(v));

    changeSubject.next({ operation: 'insert', documentId: '1', document: { id: '1' } });
    changeSubject.next({
      operation: 'update',
      documentId: '1',
      document: { id: '1', title: 'changed' },
    });

    expect(values).toEqual([{ id: '1', title: 'changed' }]);
  });

  it('onTodoDeleted filters changes for delete events', () => {
    const changeSubject = new Subject<CollectionChangeEvent>();
    const subCol = mockCollection({
      changes: vi.fn().mockReturnValue(changeSubject.asObservable()),
    });
    const subFactory = new ResolverFactory({
      collections: [{ collection: 'todos', typeName: 'Todo' }],
      getCollection: () => subCol,
    });
    const subResolvers = subFactory.createResolvers(SCHEMA);

    const obs$ = subResolvers.Subscription.onTodoDeleted({});
    const values: unknown[] = [];
    obs$.subscribe((v) => values.push(v));

    changeSubject.next({ operation: 'delete', documentId: '1', document: { id: '1' } });
    changeSubject.next({ operation: 'insert', documentId: '2', document: { id: '2' } });

    expect(values).toEqual([{ id: '1' }]);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases                                                          */
/* ------------------------------------------------------------------ */

describe('ResolverFactory – edge cases', () => {
  it('falls back to stubs when getCollection returns undefined', async () => {
    const factory = new ResolverFactory({
      collections: [{ collection: 'todos', typeName: 'Todo' }],
      getCollection: () => undefined,
    });
    const resolvers = factory.createResolvers(SCHEMA);
    expect(await resolvers.Query.listTodos({})).toEqual([]);
    expect(await resolvers.Query.getTodo({ id: '1' })).toBeNull();
  });

  it('createResolverFactory convenience function works', () => {
    const factory = createResolverFactory();
    expect(factory).toBeInstanceOf(ResolverFactory);
  });

  it('disables mutations when enableMutations is false', () => {
    const factory = new ResolverFactory({ enableMutations: false });
    const resolvers = factory.createResolvers(SCHEMA);
    expect(Object.keys(resolvers.Mutation)).toHaveLength(0);
  });

  it('disables subscriptions when enableSubscriptions is false', () => {
    const factory = new ResolverFactory({ enableSubscriptions: false });
    const resolvers = factory.createResolvers(SCHEMA);
    expect(Object.keys(resolvers.Subscription)).toHaveLength(0);
  });

  it('matches longer type names first (avoids substring collision)', async () => {
    const todoItemCol = mockCollection({ get: vi.fn().mockResolvedValue({ id: 'item-1' }) });
    const todoCol = mockCollection({ get: vi.fn().mockResolvedValue({ id: 'todo-1' }) });

    const factory = new ResolverFactory({
      collections: [
        { collection: 'todos', typeName: 'Todo' },
        { collection: 'todo_items', typeName: 'TodoItem' },
      ],
      getCollection: (name) => {
        if (name === 'todo_items') return todoItemCol;
        if (name === 'todos') return todoCol;
        return undefined;
      },
    });

    const schema: SchemaDefinition = {
      types: [],
      queries: [
        { name: 'getTodoItem', returnType: 'TodoItem' },
        { name: 'getTodo', returnType: 'Todo' },
      ],
      mutations: [],
      subscriptions: [],
    };

    const resolvers = factory.createResolvers(schema);
    await resolvers.Query.getTodoItem({ id: 'item-1' });
    await resolvers.Query.getTodo({ id: 'todo-1' });

    expect(todoItemCol.get).toHaveBeenCalledWith('item-1');
    expect(todoCol.get).toHaveBeenCalledWith('todo-1');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { SubscriptionGenerator, createSubscriptionGenerator } from '../subscription-generator.js';
import { RelationshipResolver, createRelationshipResolver } from '../relationship-resolver.js';
import { FilterGenerator, createFilterGenerator } from '../filter-generator.js';
import type { CollectionDefinition } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                    */
/* ------------------------------------------------------------------ */

const todosCollection: CollectionDefinition = {
  name: 'todos',
  fields: {
    title: { type: 'string' },
    completed: { type: 'boolean' },
    priority: { type: 'number' },
    dueDate: { type: 'date' },
  },
};

const usersCollection: CollectionDefinition = {
  name: 'users',
  fields: {
    name: { type: 'string' },
    email: { type: 'string' },
    age: { type: 'number' },
  },
};

const postsCollection: CollectionDefinition = {
  name: 'posts',
  fields: {
    title: { type: 'string' },
    body: { type: 'string' },
    authorId: { type: 'reference', reference: { collection: 'users' } },
    tags: { type: 'array' },
  },
};

/* ================================================================== */
/*  SubscriptionGenerator                                              */
/* ================================================================== */

describe('SubscriptionGenerator', () => {
  it('should generate subscription type definitions for a collection', () => {
    const generator = createSubscriptionGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('type Subscription');
    expect(typeDefs).toContain('Todo!');
  });

  it('should generate subscription fields: onCreated, onUpdated, onDeleted, onChanged', () => {
    const generator = new SubscriptionGenerator();
    const { fields } = generator.generate({ collections: [todosCollection] });

    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain('onTodoCreated');
    expect(fieldNames).toContain('onTodoUpdated');
    expect(fieldNames).toContain('onTodoDeleted');
    expect(fieldNames).toContain('onTodoChanged');
    expect(fields).toHaveLength(4);
  });

  it('should generate resolvers for each subscription field', () => {
    const generator = new SubscriptionGenerator();
    const { resolvers } = generator.generate({ collections: [todosCollection] });

    expect(resolvers).toHaveProperty('onTodoCreated');
    expect(resolvers.onTodoCreated).toHaveProperty('subscribe');
    expect(typeof resolvers.onTodoCreated!.subscribe).toBe('function');
  });

  it('should handle multiple collections', () => {
    const generator = new SubscriptionGenerator();
    const { fields, typeDefs } = generator.generate({
      collections: [todosCollection, usersCollection],
    });

    // 4 events per collection × 2 collections = 8
    expect(fields).toHaveLength(8);
    expect(typeDefs).toContain('onTodoCreated');
    expect(typeDefs).toContain('onUserCreated');
  });

  it('type definitions should contain valid GraphQL SDL syntax', () => {
    const generator = new SubscriptionGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    // Should start with type block and end with closing brace
    expect(typeDefs).toMatch(/^type Subscription \{/);
    expect(typeDefs.trim()).toMatch(/\}$/);

    // Each field should declare a return type
    expect(typeDefs).toMatch(/onTodoCreated:\s+Todo!/);
    expect(typeDefs).toMatch(/onTodoUpdated:\s+Todo!/);
  });

  it('should support an optional prefix for field names', () => {
    const generator = new SubscriptionGenerator();
    const { fields } = generator.generate({
      collections: [todosCollection],
      prefix: 'sub_',
    });

    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain('sub_onTodoCreated');
  });

  it('should include description metadata on each field', () => {
    const generator = new SubscriptionGenerator();
    const { fields } = generator.generate({ collections: [todosCollection] });

    for (const field of fields) {
      expect(field.description).toBeTruthy();
      expect(field.collection).toBe('todos');
      expect(field.returnType).toBe('Todo!');
    }
  });
});

/* ================================================================== */
/*  RelationshipResolver                                               */
/* ================================================================== */

describe('RelationshipResolver', () => {
  it('should generate one-to-one relationship type defs', () => {
    const resolver = createRelationshipResolver();
    const { typeDefs } = resolver.generate({
      collections: [postsCollection, usersCollection],
      relationships: [
        {
          sourceCollection: 'posts',
          sourceField: 'authorId',
          targetCollection: 'users',
          type: 'one-to-one',
        },
      ],
    });

    expect(typeDefs).toContain('extend type Post');
    expect(typeDefs).toContain('author: User');
  });

  it('should generate one-to-many relationship type defs', () => {
    const resolver = new RelationshipResolver();
    const { typeDefs } = resolver.generate({
      collections: [usersCollection, postsCollection],
      relationships: [
        {
          sourceCollection: 'users',
          sourceField: '_id',
          targetCollection: 'posts',
          type: 'one-to-many',
          foreignKey: 'authorId',
        },
      ],
    });

    expect(typeDefs).toContain('extend type User');
    expect(typeDefs).toContain('[Post!]!');
  });

  it('should generate resolvers for relationships', () => {
    const resolver = new RelationshipResolver();
    const { resolvers } = resolver.generate({
      collections: [postsCollection, usersCollection],
      relationships: [
        {
          sourceCollection: 'posts',
          sourceField: 'authorId',
          targetCollection: 'users',
          type: 'one-to-one',
        },
      ],
    });

    expect(resolvers).toHaveProperty('Post');
    expect(resolvers.Post).toHaveProperty('author');
    expect(typeof resolvers.Post!.author).toBe('function');
  });

  it('should generate many-to-many relationship type defs', () => {
    const resolver = new RelationshipResolver();
    const tagsCollection: CollectionDefinition = {
      name: 'tags',
      fields: { label: { type: 'string' } },
    };

    const { typeDefs } = resolver.generate({
      collections: [postsCollection, tagsCollection],
      relationships: [
        {
          sourceCollection: 'posts',
          sourceField: '_id',
          targetCollection: 'tags',
          type: 'many-to-many',
          junctionCollection: 'posts_tags',
          junctionSourceKey: 'postId',
          junctionTargetKey: 'tagId',
        },
      ],
    });

    expect(typeDefs).toContain('extend type Post');
    expect(typeDefs).toContain('[Tag!]!');
  });

  it('should handle multiple relationships', () => {
    const resolver = new RelationshipResolver();
    const commentsCollection: CollectionDefinition = {
      name: 'comments',
      fields: {
        text: { type: 'string' },
        postId: { type: 'reference' },
      },
    };

    const { resolvers } = resolver.generate({
      collections: [postsCollection, usersCollection, commentsCollection],
      relationships: [
        {
          sourceCollection: 'posts',
          sourceField: 'authorId',
          targetCollection: 'users',
          type: 'one-to-one',
        },
        {
          sourceCollection: 'posts',
          sourceField: '_id',
          targetCollection: 'comments',
          type: 'one-to-many',
          foreignKey: 'postId',
        },
      ],
    });

    expect(resolvers.Post).toHaveProperty('author');
    expect(resolvers.Post).toHaveProperty('comments');
  });
});

/* ================================================================== */
/*  FilterGenerator                                                    */
/* ================================================================== */

describe('FilterGenerator', () => {
  it('should generate WhereInput types for a collection', () => {
    const generator = createFilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('input TodoWhereInput');
    expect(typeDefs).toContain('AND: [TodoWhereInput!]');
    expect(typeDefs).toContain('OR: [TodoWhereInput!]');
    expect(typeDefs).toContain('NOT: TodoWhereInput');
  });

  it('should generate OrderByInput enum for sortable fields', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('input TodoOrderByInput');
    expect(typeDefs).toContain('title: SortDirection');
    expect(typeDefs).toContain('priority: SortDirection');
    expect(typeDefs).toContain('completed: SortDirection');
    expect(typeDefs).toContain('dueDate: SortDirection');
  });

  it('should include operators appropriate to string field type', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('title_contains: String');
    expect(typeDefs).toContain('title_startsWith: String');
    expect(typeDefs).toContain('title_endsWith: String');
    expect(typeDefs).toContain('title_eq: String');
  });

  it('should include operators appropriate to number field type', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('priority_gt:');
    expect(typeDefs).toContain('priority_lt:');
    expect(typeDefs).toContain('priority_gte:');
    expect(typeDefs).toContain('priority_lte:');
  });

  it('should not generate string operators for number fields', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).not.toContain('priority_contains');
    expect(typeDefs).not.toContain('priority_startsWith');
  });

  it('should generate ConnectionInput for pagination', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('input TodoConnectionInput');
    expect(typeDefs).toContain('first: Int');
    expect(typeDefs).toContain('after: String');
    expect(typeDefs).toContain('last: Int');
    expect(typeDefs).toContain('before: String');
    expect(typeDefs).toContain('where: TodoWhereInput');
    expect(typeDefs).toContain('orderBy: TodoOrderByInput');
  });

  it('should generate SortDirection enum', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({ collections: [todosCollection] });

    expect(typeDefs).toContain('enum SortDirection');
    expect(typeDefs).toContain('ASC');
    expect(typeDefs).toContain('DESC');
  });

  it('should provide a buildFilter function that converts WhereInput to query filter', () => {
    const generator = new FilterGenerator();
    const { buildFilter } = generator.generate({ collections: [todosCollection] });

    const filter = buildFilter({ title_contains: 'ship', priority_gte: 3 });
    expect(filter).toEqual({
      title: { $contains: 'ship' },
      priority: { $gte: 3 },
    });
  });

  it('should handle multiple collections', () => {
    const generator = new FilterGenerator();
    const { typeDefs } = generator.generate({
      collections: [todosCollection, usersCollection],
    });

    expect(typeDefs).toContain('input TodoWhereInput');
    expect(typeDefs).toContain('input UserWhereInput');
    expect(typeDefs).toContain('input TodoConnectionInput');
    expect(typeDefs).toContain('input UserConnectionInput');
  });
});

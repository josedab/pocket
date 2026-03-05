import { describe, expect, it } from 'vitest';
import type { CollectionSchema } from '../auto-schema.js';
import { createAutoSchemaGenerator } from '../auto-schema.js';

describe('AutoSchemaGenerator', () => {
  const userCollection: CollectionSchema = {
    name: 'user',
    fields: {
      name: { type: 'string', required: true, description: 'User full name' },
      email: { type: 'string', required: true },
      age: { type: 'number' },
      active: { type: 'boolean' },
    },
    primaryKey: 'id',
  };

  const postCollection: CollectionSchema = {
    name: 'post',
    fields: {
      title: { type: 'string', required: true },
      body: { type: 'string' },
      author: { type: 'reference', refCollection: 'user' },
      publishedAt: { type: 'date' },
    },
  };

  it('should generate schema from collections', () => {
    const gen = createAutoSchemaGenerator({ collections: [userCollection] });
    const schema = gen.generate();

    expect(schema.types.length).toBeGreaterThan(0);
    expect(schema.queries.length).toBeGreaterThan(0);

    const userType = schema.types.find((t) => t.name === 'User');
    expect(userType).toBeDefined();
    expect(userType!.fields.some((f) => f.name === 'name')).toBe(true);
    expect(userType!.fields.some((f) => f.name === 'id')).toBe(true);
  });

  it('should generate SDL output', () => {
    const gen = createAutoSchemaGenerator({ collections: [userCollection, postCollection] });
    const sdl = gen.generateSDL();

    expect(sdl).toContain('type User');
    expect(sdl).toContain('type Post');
    expect(sdl).toContain('input UserInput');
    expect(sdl).toContain('type Query');
    expect(sdl).toContain('type Mutation');
    expect(sdl).toContain('type Subscription');
    expect(sdl).toContain('getUser(id: ID!): User');
    expect(sdl).toContain('listUsers');
    expect(sdl).toContain('createUser');
    expect(sdl).toContain('onUserCreated');
  });

  it('should handle references between collections', () => {
    const gen = createAutoSchemaGenerator({ collections: [userCollection, postCollection] });
    const sdl = gen.generateSDL();
    expect(sdl).toContain('author: User');
  });

  it('should generate federation directives', () => {
    const gen = createAutoSchemaGenerator({
      collections: [userCollection],
      federationEnabled: true,
    });
    const sdl = gen.generateSDL();
    expect(sdl).toContain('@key(fields: "id")');
    expect(sdl).toContain('extend schema @link');
  });

  it('should skip mutations when disabled', () => {
    const gen = createAutoSchemaGenerator({
      collections: [userCollection],
      generateMutations: false,
    });
    const sdl = gen.generateSDL();
    expect(sdl).not.toContain('type Mutation');
  });

  it('should skip subscriptions when disabled', () => {
    const gen = createAutoSchemaGenerator({
      collections: [userCollection],
      generateSubscriptions: false,
    });
    const sdl = gen.generateSDL();
    expect(sdl).not.toContain('type Subscription');
  });
});

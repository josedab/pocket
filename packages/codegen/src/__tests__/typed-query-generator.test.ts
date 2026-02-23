import { describe, expect, it } from 'vitest';
import { TypedQueryGenerator } from '../typed-query-generator.js';
import type { PocketSchema } from '../types.js';

describe('TypedQueryGenerator', () => {
  const schema: PocketSchema = {
    version: '1.0',
    collections: [
      {
        name: 'users',
        description: 'User accounts',
        fields: {
          name: { type: 'string', required: true, description: 'Full name' },
          email: { type: 'string', required: true, index: true },
          age: { type: 'number' },
          active: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          profile: { type: 'object', properties: { bio: { type: 'string' } } },
        },
        timestamps: true,
      },
      {
        name: 'posts',
        fields: {
          title: { type: 'string', required: true },
          authorId: { type: 'reference', reference: { collection: 'users' } },
          publishedAt: { type: 'date' },
        },
      },
    ],
  };

  const generator = new TypedQueryGenerator();

  it('should generate files for each collection', () => {
    const files = generator.generate(schema);
    expect(files.length).toBe(5); // 2 collections × 2 files + 1 index
    expect(files.find((f) => f.path === 'users/types.ts')).toBeDefined();
    expect(files.find((f) => f.path === 'users/query-builder.ts')).toBeDefined();
    expect(files.find((f) => f.path === 'posts/types.ts')).toBeDefined();
    expect(files.find((f) => f.path === 'index.ts')).toBeDefined();
  });

  it('should generate correct TypeScript interface for users', () => {
    const files = generator.generate(schema);
    const typesFile = files.find((f) => f.path === 'users/types.ts')!;

    expect(typesFile.content).toContain('export interface Users extends Document');
    expect(typesFile.content).toContain('name: string;');
    expect(typesFile.content).toContain('email: string;');
    expect(typesFile.content).toContain('age?: number;');
    expect(typesFile.content).toContain('active?: boolean;');
    expect(typesFile.content).toContain('tags?: string[];');
    expect(typesFile.content).toContain('createdAt: Date;');
    expect(typesFile.content).toContain('updatedAt: Date;');
    expect(typesFile.content).toContain('export type NewUsers');
  });

  it('should generate query builder with where methods', () => {
    const files = generator.generate(schema);
    const builderFile = files.find((f) => f.path === 'users/query-builder.ts')!;

    expect(builderFile.content).toContain('class UsersQueryBuilder');
    expect(builderFile.content).toContain('whereName(');
    expect(builderFile.content).toContain('whereEmail(');
    expect(builderFile.content).toContain('whereAge(');
    expect(builderFile.content).toContain('sortByName(');
    expect(builderFile.content).toContain('sortByAge(');
    expect(builderFile.content).toContain('limit(count: number)');
    expect(builderFile.content).toContain('build()');
  });

  it('should generate JSDoc comments', () => {
    const files = generator.generate(schema);
    const typesFile = files.find((f) => f.path === 'users/types.ts')!;
    expect(typesFile.content).toContain('/** User accounts */');
    expect(typesFile.content).toContain('/** Full name */');
  });

  it('should generate index file with re-exports', () => {
    const files = generator.generate(schema);
    const indexFile = files.find((f) => f.path === 'index.ts')!;
    expect(indexFile.content).toContain("export * from './users/types.js'");
    expect(indexFile.content).toContain("export * from './posts/query-builder.js'");
  });

  it('should handle reference types as string', () => {
    const files = generator.generate(schema);
    const postsTypes = files.find((f) => f.path === 'posts/types.ts')!;
    expect(postsTypes.content).toContain('authorId?: string;');
  });

  it('should support type prefix configuration', () => {
    const gen = new TypedQueryGenerator({ typePrefix: 'DB' });
    const files = gen.generate(schema);
    const typesFile = files.find((f) => f.path === 'users/types.ts')!;
    expect(typesFile.content).toContain('export interface DBUsers');
  });
});

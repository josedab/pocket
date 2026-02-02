import { describe, expect, it } from 'vitest';
import { CodeGenerator, createCodeGenerator } from '../codegen.js';
import { HookGenerator } from '../generators/hook-generator.js';
import { MigrationGenerator } from '../generators/migration-generator.js';
import { TypeGenerator } from '../generators/type-generator.js';
import { ValidationGenerator } from '../generators/validation-generator.js';
import { createSchemaParser, SchemaParser } from '../schema-parser.js';
import type { CollectionSchema, PocketSchema } from '../types.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const todoCollection: CollectionSchema = {
  name: 'todos',
  description: 'A list of tasks',
  fields: {
    title: { type: 'string', required: true, description: 'Task title' },
    completed: { type: 'boolean', default: false },
    priority: {
      type: 'number',
      validation: { min: 1, max: 5 },
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
    metadata: {
      type: 'object',
      properties: {
        color: { type: 'string' },
        icon: { type: 'string' },
      },
    },
  },
  timestamps: true,
};

const userCollection: CollectionSchema = {
  name: 'users',
  fields: {
    name: { type: 'string', required: true },
    email: {
      type: 'string',
      required: true,
      unique: true,
      validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
    },
    age: { type: 'number', validation: { min: 0, max: 150 } },
    role: {
      type: 'string',
      validation: { enum: ['admin', 'user', 'moderator'] },
    },
  },
  indexes: [{ fields: ['email'], unique: true }],
};

const postCollection: CollectionSchema = {
  name: 'posts',
  fields: {
    title: { type: 'string', required: true },
    body: { type: 'string', required: true },
    authorId: {
      type: 'reference',
      required: true,
      reference: { collection: 'users' },
    },
    publishedAt: { type: 'date' },
  },
  softDelete: true,
};

const validSchema: PocketSchema = {
  version: '1.0.0',
  collections: [todoCollection, userCollection, postCollection],
};

// ─── Schema Parser Tests ──────────────────────────────────────────────────────

describe('SchemaParser', () => {
  describe('parseSchema', () => {
    it('should parse a JSON string into a PocketSchema', () => {
      const parser = createSchemaParser();
      const input = JSON.stringify(validSchema);
      const result = parser.parseSchema(input);

      expect(result.version).toBe('1.0.0');
      expect(result.collections).toHaveLength(3);
    });

    it('should accept a PocketSchema object directly', () => {
      const parser = createSchemaParser();
      const result = parser.parseSchema(validSchema);

      expect(result).toBe(validSchema);
    });

    it('should throw on invalid JSON', () => {
      const parser = createSchemaParser();

      expect(() => parser.parseSchema('{ invalid json')).toThrow('Invalid schema: input is not valid JSON');
    });
  });

  describe('validate', () => {
    it('should validate a correct schema', () => {
      const parser = new SchemaParser();
      const result = parser.validate(validSchema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject schema without version', () => {
      const parser = new SchemaParser();
      const schema = { ...validSchema, version: '' };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ path: 'version', message: 'Schema version is required' })
      );
    });

    it('should reject schema without collections', () => {
      const parser = new SchemaParser();
      const schema = { version: '1.0.0', collections: null } as unknown as PocketSchema;
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ path: 'collections', message: 'Collections array is required' })
      );
    });

    it('should reject schema with empty collections', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = { version: '1.0.0', collections: [] };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'At least one collection is required' })
      );
    });

    it('should reject duplicate collection names', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          { name: 'todos', fields: { title: { type: 'string' } } },
          { name: 'todos', fields: { name: { type: 'string' } } },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Duplicate collection name: "todos"' })
      );
    });

    it('should reject invalid field types', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              bad: { type: 'invalid' as 'string' },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Invalid field type: "invalid"'),
        })
      );
    });

    it('should reject array fields without items', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              tags: { type: 'array' },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Array fields must define "items"' })
      );
    });

    it('should reject object fields without properties', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              data: { type: 'object' },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Object fields must define "properties"' })
      );
    });

    it('should reject reference fields without reference config', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              userId: { type: 'reference' },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Reference fields must define "reference"' })
      );
    });

    it('should reject references to non-existent collections', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'posts',
            fields: {
              authorId: {
                type: 'reference',
                reference: { collection: 'nonexistent' },
              },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Referenced collection "nonexistent" does not exist',
        })
      );
    });

    it('should reject indexes referencing unknown fields', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: { name: { type: 'string' } },
            indexes: [{ fields: ['unknown_field'] }],
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Index references unknown field: "unknown_field"',
        })
      );
    });

    it('should reject validation min > max', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              age: { type: 'number', validation: { min: 100, max: 10 } },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Validation "min" cannot be greater than "max"',
        })
      );
    });

    it('should validate nested object fields recursively', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [
          {
            name: 'test',
            fields: {
              nested: {
                type: 'object',
                properties: {
                  inner: { type: 'array' }, // missing items
                },
              },
            },
          },
        ],
      };
      const result = parser.validate(schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Array fields must define "items"' })
      );
    });
  });

  describe('resolveReferences', () => {
    it('should resolve valid references to their target collections', () => {
      const parser = new SchemaParser();
      const resolved = parser.resolveReferences(validSchema);

      expect(resolved.size).toBe(1);
      expect(resolved.get('posts.authorId')).toBeDefined();
      expect(resolved.get('posts.authorId')?.name).toBe('users');
    });

    it('should return empty map for schemas without references', () => {
      const parser = new SchemaParser();
      const schema: PocketSchema = {
        version: '1.0.0',
        collections: [todoCollection],
      };
      const resolved = parser.resolveReferences(schema);

      expect(resolved.size).toBe(0);
    });
  });
});

// ─── Type Generator Tests ─────────────────────────────────────────────────────

describe('TypeGenerator', () => {
  it('should generate type files for each collection', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection, userCollection]);

    // One file per collection + index file
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toContain('types/todos.types.ts');
    expect(files.map((f) => f.path)).toContain('types/users.types.ts');
    expect(files.map((f) => f.path)).toContain('types/index.ts');
  });

  it('should generate proper TypeScript interfaces', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('export interface Todo extends Document');
    expect(typeFile.content).toContain('title: string;');
    expect(typeFile.content).toContain('completed?: boolean;');
    expect(typeFile.content).toContain('priority?: number;');
    expect(typeFile.content).toContain('tags?: string[];');
  });

  it('should handle timestamp fields', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('createdAt: Date;');
    expect(typeFile.content).toContain('updatedAt: Date;');
  });

  it('should handle soft delete fields', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([postCollection]);
    const typeFile = files.find((f) => f.path === 'types/posts.types.ts')!;

    expect(typeFile.content).toContain('deletedAt?: Date;');
  });

  it('should map reference type to string', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([postCollection]);
    const typeFile = files.find((f) => f.path === 'types/posts.types.ts')!;

    expect(typeFile.content).toContain('authorId: string;');
  });

  it('should map date type to Date', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([postCollection]);
    const typeFile = files.find((f) => f.path === 'types/posts.types.ts')!;

    expect(typeFile.content).toContain('publishedAt?: Date;');
  });

  it('should generate object types inline', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('metadata?:');
    expect(typeFile.content).toContain('color?: string;');
    expect(typeFile.content).toContain('icon?: string;');
  });

  it('should generate enum types for string fields with enum validation', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([userCollection]);
    const typeFile = files.find((f) => f.path === 'types/users.types.ts')!;

    expect(typeFile.content).toContain('"admin" | "user" | "moderator"');
  });

  it('should generate collection type alias', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('export type TodosCollection = Collection<Todo>;');
  });

  it('should generate an index file re-exporting all types', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection, userCollection]);
    const indexFile = files.find((f) => f.path === 'types/index.ts')!;

    expect(indexFile.content).toContain("from './todos.types.js'");
    expect(indexFile.content).toContain("from './users.types.js'");
  });

  it('should include field descriptions as JSDoc comments', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('/** Task title */');
  });

  it('should include collection description as JSDoc', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('A list of tasks');
  });

  it('should include auto-generated header', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain('DO NOT EDIT - This file is auto-generated by @pocket/codegen');
  });

  it('should import Document from @pocket/core', () => {
    const generator = new TypeGenerator();
    const files = generator.generateTypes([todoCollection]);
    const typeFile = files.find((f) => f.path === 'types/todos.types.ts')!;

    expect(typeFile.content).toContain("import type { Document } from '@pocket/core';");
  });
});

// ─── Hook Generator Tests ─────────────────────────────────────────────────────

describe('HookGenerator', () => {
  it('should generate hook files for each collection', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection, userCollection]);

    // One file per collection + index file
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toContain('hooks/todos.hooks.ts');
    expect(files.map((f) => f.path)).toContain('hooks/users.hooks.ts');
    expect(files.map((f) => f.path)).toContain('hooks/index.ts');
  });

  it('should generate usePlural hook', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain('export function useTodos()');
    expect(hookFile.content).toContain("useLiveQuery<Todo>('todos')");
  });

  it('should generate useSingular hook', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain('export function useTodo(id: string)');
    expect(hookFile.content).toContain("useDocument<Todo>('todos', id)");
  });

  it('should generate mutation hook', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain('export function useTodoMutation()');
    expect(hookFile.content).toContain("insert: async (data: Omit<Todo, '_id'");
    expect(hookFile.content).toContain("update: async (id: string, data: Partial<Omit<Todo, '_id'");
    expect(hookFile.content).toContain('delete: async (id: string)');
  });

  it('should generate filtered query hook', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain('export function useFilteredTodos(filter: TodoFilter)');
    expect(hookFile.content).toContain("useLiveQuery<Todo>('todos', { filter })");
  });

  it('should generate filter type with scalar fields only', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain('export interface TodoFilter');
    expect(hookFile.content).toContain('title?: string;');
    expect(hookFile.content).toContain('completed?: boolean;');
    expect(hookFile.content).toContain('priority?: number;');
    // Array and object fields should NOT be in the filter
    expect(hookFile.content).not.toMatch(/tags\?:.*TodoFilter/);
  });

  it('should import from @pocket/react', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain("from '@pocket/react'");
  });

  it('should import type from the types file', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection]);
    const hookFile = files.find((f) => f.path === 'hooks/todos.hooks.ts')!;

    expect(hookFile.content).toContain("import type { Todo } from '../types/todos.types.js'");
  });

  it('should generate index file re-exporting all hooks', () => {
    const generator = new HookGenerator();
    const files = generator.generateHooks([todoCollection, userCollection]);
    const indexFile = files.find((f) => f.path === 'hooks/index.ts')!;

    expect(indexFile.content).toContain("from './todos.hooks.js'");
    expect(indexFile.content).toContain("from './users.hooks.js'");
  });
});

// ─── Validation Generator Tests ───────────────────────────────────────────────

describe('ValidationGenerator', () => {
  it('should generate validation files for each collection', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection, userCollection]);

    // One file per collection + index file
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toContain('validation/todos.validation.ts');
    expect(files.map((f) => f.path)).toContain('validation/users.validation.ts');
    expect(files.map((f) => f.path)).toContain('validation/index.ts');
  });

  it('should generate Zod schema with correct field types', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('z.string()');
    expect(valFile.content).toContain('z.boolean()');
    expect(valFile.content).toContain('z.number()');
    expect(valFile.content).toContain('z.array(z.string())');
  });

  it('should generate schema variable', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('export const todoSchema = z.object({');
  });

  it('should handle validation constraints', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('.min(1)');
    expect(valFile.content).toContain('.max(5)');
  });

  it('should handle string pattern validation', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([userCollection]);
    const valFile = files.find((f) => f.path === 'validation/users.validation.ts')!;

    expect(valFile.content).toContain('.regex(');
  });

  it('should handle enum validation', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([userCollection]);
    const valFile = files.find((f) => f.path === 'validation/users.validation.ts')!;

    expect(valFile.content).toContain('z.enum(["admin", "user", "moderator"])');
  });

  it('should handle optional fields', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('.optional()');
  });

  it('should handle default values', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('.default(false)');
  });

  it('should handle date type with coerce', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([postCollection]);
    const valFile = files.find((f) => f.path === 'validation/posts.validation.ts')!;

    expect(valFile.content).toContain('z.coerce.date()');
  });

  it('should handle reference type as z.string()', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([postCollection]);
    const valFile = files.find((f) => f.path === 'validation/posts.validation.ts')!;

    expect(valFile.content).toContain('authorId: z.string()');
  });

  it('should handle nested object fields', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('metadata: z.object(');
    expect(valFile.content).toContain('color: z.string()');
    expect(valFile.content).toContain('icon: z.string()');
  });

  it('should generate inferred input type', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('export type TodoInput = z.infer<typeof todoSchema>;');
  });

  it('should generate parse function', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('export function parseTodo(data: unknown): TodoInput');
    expect(valFile.content).toContain('return todoSchema.parse(data);');
  });

  it('should generate safe parse function', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('export function safeParseTodo(data: unknown)');
    expect(valFile.content).toContain('return todoSchema.safeParse(data);');
  });

  it('should add timestamp fields to Zod schema when timestamps enabled', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain('createdAt: z.coerce.date()');
    expect(valFile.content).toContain('updatedAt: z.coerce.date()');
  });

  it('should add softDelete field to Zod schema when softDelete enabled', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([postCollection]);
    const valFile = files.find((f) => f.path === 'validation/posts.validation.ts')!;

    expect(valFile.content).toContain('deletedAt: z.coerce.date().optional()');
  });

  it('should import zod', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection]);
    const valFile = files.find((f) => f.path === 'validation/todos.validation.ts')!;

    expect(valFile.content).toContain("import { z } from 'zod';");
  });

  it('should generate index file re-exporting all validation schemas', () => {
    const generator = new ValidationGenerator();
    const files = generator.generateValidation([todoCollection, userCollection]);
    const indexFile = files.find((f) => f.path === 'validation/index.ts')!;

    expect(indexFile.content).toContain("from './todos.validation.js'");
    expect(indexFile.content).toContain("from './users.validation.js'");
  });
});

// ─── Migration Generator Tests ────────────────────────────────────────────────

describe('MigrationGenerator', () => {
  const oldSchema: PocketSchema = {
    version: '1.0.0',
    collections: [
      {
        name: 'todos',
        fields: {
          title: { type: 'string', required: true },
          completed: { type: 'boolean' },
        },
      },
      {
        name: 'users',
        fields: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
        },
      },
    ],
  };

  it('should detect added collections', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        ...oldSchema.collections,
        {
          name: 'posts',
          fields: {
            title: { type: 'string', required: true },
          },
        },
      ],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'collection_added', collection: 'posts' })
    );
  });

  it('should detect removed collections', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [oldSchema.collections[0]!],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'collection_removed', collection: 'users' })
    );
  });

  it('should detect added fields', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        {
          name: 'todos',
          fields: {
            title: { type: 'string', required: true },
            completed: { type: 'boolean' },
            priority: { type: 'number' },
          },
        },
        oldSchema.collections[1]!,
      ],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'field_added', collection: 'todos', field: 'priority' })
    );
  });

  it('should detect removed fields', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        {
          name: 'todos',
          fields: {
            title: { type: 'string', required: true },
          },
        },
        oldSchema.collections[1]!,
      ],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'field_removed', collection: 'todos', field: 'completed' })
    );
  });

  it('should detect modified fields', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        {
          name: 'todos',
          fields: {
            title: { type: 'string', required: true },
            completed: { type: 'string' }, // changed from boolean to string
          },
        },
        oldSchema.collections[1]!,
      ],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'field_modified', collection: 'todos', field: 'completed' })
    );
  });

  it('should detect added indexes', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        oldSchema.collections[0]!,
        {
          name: 'users',
          fields: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
          },
          indexes: [{ fields: ['email'], unique: true }],
        },
      ],
    };

    const changes = generator.detectChanges(oldSchema, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'index_added', collection: 'users' })
    );
  });

  it('should detect removed indexes', () => {
    const generator = new MigrationGenerator();
    const schemaWithIndex: PocketSchema = {
      version: '1.0.0',
      collections: [
        oldSchema.collections[0]!,
        {
          name: 'users',
          fields: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
          },
          indexes: [{ fields: ['email'], unique: true }],
        },
      ],
    };
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        oldSchema.collections[0]!,
        {
          name: 'users',
          fields: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
          },
        },
      ],
    };

    const changes = generator.detectChanges(schemaWithIndex, newSchema);
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'index_removed', collection: 'users' })
    );
  });

  it('should generate migration file with up() and down()', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        {
          name: 'todos',
          fields: {
            title: { type: 'string', required: true },
            completed: { type: 'boolean' },
            priority: { type: 'number' },
          },
        },
        oldSchema.collections[1]!,
      ],
    };

    const file = generator.generateMigration(oldSchema, newSchema);

    expect(file).not.toBeNull();
    expect(file!.type).toBe('migration');
    expect(file!.path).toMatch(/^migrations\/.*-migration\.ts$/);
    expect(file!.content).toContain('export async function up(');
    expect(file!.content).toContain('export async function down(');
    expect(file!.content).toContain('1.0.0 -> 2.0.0');
  });

  it('should return null when no changes detected', () => {
    const generator = new MigrationGenerator();
    const file = generator.generateMigration(oldSchema, oldSchema);

    expect(file).toBeNull();
  });

  it('should generate up() with createCollection for added collections', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        ...oldSchema.collections,
        { name: 'posts', fields: { title: { type: 'string' } } },
      ],
    };

    const file = generator.generateMigration(oldSchema, newSchema)!;
    expect(file.content).toContain("await db.createCollection('posts')");
  });

  it('should generate down() with dropCollection for added collections (rollback)', () => {
    const generator = new MigrationGenerator();
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        ...oldSchema.collections,
        { name: 'posts', fields: { title: { type: 'string' } } },
      ],
    };

    const file = generator.generateMigration(oldSchema, newSchema)!;
    // down() should reverse: dropCollection for a collection that was added
    expect(file.content).toContain("await db.dropCollection('posts')");
  });
});

// ─── CodeGenerator Integration Tests ──────────────────────────────────────────

describe('CodeGenerator', () => {
  it('should be created via factory function', () => {
    const generator = createCodeGenerator();
    expect(generator).toBeInstanceOf(CodeGenerator);
  });

  it('should generate only type files by default', () => {
    const generator = createCodeGenerator();
    const files = generator.generate({
      schema: validSchema,
      outputDir: './generated',
    });

    const types = files.filter((f) => f.type === 'types' || (f.type === 'index' && f.path.startsWith('types/')));
    expect(types.length).toBeGreaterThan(0);

    const hooks = files.filter((f) => f.type === 'hooks');
    expect(hooks).toHaveLength(0);

    const validation = files.filter((f) => f.type === 'validation');
    expect(validation).toHaveLength(0);
  });

  it('should generate all file types when all flags enabled', () => {
    const generator = createCodeGenerator();
    const files = generator.generate({
      schema: validSchema,
      outputDir: './generated',
      generateTypes: true,
      generateHooks: true,
      generateValidation: true,
    });

    const typePaths = files.filter((f) => f.path.startsWith('types/'));
    const hookPaths = files.filter((f) => f.path.startsWith('hooks/'));
    const validationPaths = files.filter((f) => f.path.startsWith('validation/'));

    expect(typePaths.length).toBeGreaterThan(0);
    expect(hookPaths.length).toBeGreaterThan(0);
    expect(validationPaths.length).toBeGreaterThan(0);
  });

  it('should throw on invalid schema', () => {
    const generator = createCodeGenerator();
    const invalidSchema: PocketSchema = {
      version: '',
      collections: [],
    };

    expect(() =>
      generator.generate({
        schema: invalidSchema,
        outputDir: './generated',
      })
    ).toThrow('Invalid schema');
  });

  it('should generate migrations between schemas', () => {
    const generator = createCodeGenerator();
    const oldSchema: PocketSchema = {
      version: '1.0.0',
      collections: [
        {
          name: 'todos',
          fields: { title: { type: 'string', required: true } },
        },
      ],
    };
    const newSchema: PocketSchema = {
      version: '2.0.0',
      collections: [
        {
          name: 'todos',
          fields: {
            title: { type: 'string', required: true },
            completed: { type: 'boolean' },
          },
        },
      ],
    };

    const migration = generator.generateMigration(oldSchema, newSchema);
    expect(migration).not.toBeNull();
    expect(migration!.type).toBe('migration');
  });

  it('should parse and validate schema from JSON string', () => {
    const generator = createCodeGenerator();
    const json = JSON.stringify(validSchema);

    const result = generator.parseAndValidate(json);
    expect(result.version).toBe('1.0.0');
    expect(result.collections).toHaveLength(3);
  });

  it('should throw when parsing invalid schema from JSON', () => {
    const generator = createCodeGenerator();
    const invalidJson = JSON.stringify({
      version: '',
      collections: [],
    });

    expect(() => generator.parseAndValidate(invalidJson)).toThrow('Invalid schema');
  });

  it('should generate files with correct file types', () => {
    const generator = createCodeGenerator();
    const files = generator.generate({
      schema: validSchema,
      outputDir: './generated',
      generateTypes: true,
      generateHooks: true,
      generateValidation: true,
    });

    for (const file of files) {
      expect(['types', 'hooks', 'validation', 'migration', 'index']).toContain(file.type);
      expect(file.path).toBeTruthy();
      expect(file.content).toBeTruthy();
    }
  });
});

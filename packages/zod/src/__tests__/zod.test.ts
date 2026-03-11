import { Schema } from '@pocket/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  documentSchema,
  mergeZodSchemas,
  partialZodSchema,
  passthroughZodSchema,
  pocketToZod,
  strictZodSchema,
  zodSchema,
  zodToPocket,
} from '../index.js';

// ---------- adapter.ts: zodSchema ----------

describe('zodSchema', () => {
  const userZod = z.object({
    _id: z.string(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().min(0).optional(),
    active: z.boolean().default(true),
    createdAt: z.date().default(() => new Date()),
  });

  type User = z.infer<typeof userZod>;

  it('creates a Pocket schema from a Zod schema', () => {
    const schema = zodSchema(userZod);
    expect(schema.definition).toBeDefined();
    expect(schema.definition.version).toBe(1);
    expect(schema.definition.properties).toBeDefined();
  });

  it('extracts field types correctly', () => {
    const schema = zodSchema(userZod);
    const props = schema.definition.properties;
    expect(props._id?.type).toBe('string');
    expect(props.name?.type).toBe('string');
    expect(props.email?.type).toBe('string');
    expect(props.age?.type).toBe('number');
    expect(props.active?.type).toBe('boolean');
    expect(props.createdAt?.type).toBe('date');
  });

  it('marks optional fields as not required', () => {
    const schema = zodSchema(userZod);
    const props = schema.definition.properties;
    expect(props.age?.required).toBe(false);
    expect(props.name?.required).toBe(true);
  });

  it('extracts default values', () => {
    const schema = zodSchema(userZod);
    const props = schema.definition.properties;
    expect(props.active?.default).toBe(true);
  });

  it('validates correct data', () => {
    const schema = zodSchema(userZod);
    const result = schema.validate({
      _id: '1',
      name: 'John',
      email: 'john@example.com',
      active: true,
      createdAt: new Date(),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns validation errors for invalid data', () => {
    const schema = zodSchema(userZod);
    const result = schema.validate({ _id: 123, name: null });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.path).toBeDefined();
    expect(result.errors[0]?.message).toBeDefined();
  });

  it('parse returns valid data', () => {
    const schema = zodSchema(userZod);
    const data = schema.parse({
      _id: '1',
      name: 'John',
      email: 'john@example.com',
      active: true,
      createdAt: new Date(),
    });
    expect(data.name).toBe('John');
  });

  it('parse throws on invalid data', () => {
    const schema = zodSchema(userZod);
    expect(() => schema.parse({ name: 123 })).toThrow();
  });

  it('safeParse returns success for valid data', () => {
    const schema = zodSchema(userZod);
    const result = schema.safeParse({
      _id: '1',
      name: 'John',
      email: 'john@example.com',
      active: true,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('safeParse returns error for invalid data', () => {
    const schema = zodSchema(userZod);
    const result = schema.safeParse({ _id: 123 });
    expect(result.success).toBe(false);
  });

  it('beforeWrite validates when validateOnWrite is true', () => {
    const schema = zodSchema(userZod, { validateOnWrite: true });
    expect(schema.beforeWrite).toBeDefined();
    expect(() => schema.beforeWrite!({ _id: 123 } as unknown as User)).toThrow('Validation failed');
  });

  it('beforeWrite returns data when valid', () => {
    const schema = zodSchema(userZod, { validateOnWrite: true });
    const doc = {
      _id: '1',
      name: 'John',
      email: 'john@example.com',
      active: true,
      createdAt: new Date(),
    } as User;
    const result = schema.beforeWrite!(doc);
    expect(result.name).toBe('John');
  });

  it('afterRead is undefined when validateOnRead is false', () => {
    const schema = zodSchema(userZod, { validateOnRead: false });
    expect(schema.afterRead).toBeUndefined();
  });

  it('afterRead returns original doc on validation failure', () => {
    const schema = zodSchema(userZod, { validateOnRead: true });
    expect(schema.afterRead).toBeDefined();
    const badDoc = { _id: 123, name: null } as unknown as User;
    const result = schema.afterRead!(badDoc);
    expect(result).toBe(badDoc);
  });

  it('includes _id and _rev by default', () => {
    const simple = z.object({ _id: z.string(), name: z.string() });
    const schema = zodSchema(simple, { includeDocumentFields: true });
    expect(schema.definition.properties._id).toBeDefined();
    expect(schema.definition.properties._rev).toBeDefined();
  });

  it('excludes document fields when option is false', () => {
    const simple = z.object({ _id: z.string(), name: z.string() });
    const schema = zodSchema(simple, { includeDocumentFields: false });
    expect(schema.definition.properties._id).toBeUndefined();
  });

  it('handles nested objects', () => {
    const nested = z.object({
      _id: z.string(),
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    });
    const schema = zodSchema(nested);
    const props = schema.definition.properties;
    expect(props.address?.type).toBe('object');
    expect(props.address?.properties?.street?.type).toBe('string');
  });

  it('handles arrays', () => {
    const withArray = z.object({
      _id: z.string(),
      tags: z.array(z.string()),
    });
    const schema = zodSchema(withArray);
    const props = schema.definition.properties;
    expect(props.tags?.type).toBe('array');
    expect(props.tags?.items?.type).toBe('string');
  });

  it('handles enums', () => {
    const withEnum = z.object({
      _id: z.string(),
      role: z.enum(['admin', 'user']),
    });
    const schema = zodSchema(withEnum);
    expect(schema.definition.properties.role?.type).toBe('string');
  });

  it('handles literals', () => {
    const withLiteral = z.object({
      _id: z.string(),
      type: z.literal('user'),
      count: z.literal(42),
      flag: z.literal(true),
    });
    const schema = zodSchema(withLiteral);
    const props = schema.definition.properties;
    expect(props.type?.type).toBe('string');
    expect(props.count?.type).toBe('number');
    expect(props.flag?.type).toBe('boolean');
  });

  it('handles nullable types', () => {
    const withNullable = z.object({
      _id: z.string(),
      name: z.string().nullable(),
    });
    const schema = zodSchema(withNullable);
    expect(schema.definition.properties.name?.type).toBe('string');
  });
});

// ---------- adapter.ts: documentSchema ----------

describe('documentSchema', () => {
  it('creates a schema with _id and _rev fields', () => {
    const schema = documentSchema({
      name: z.string(),
      age: z.number(),
    });

    const result = schema.safeParse({ _id: '1', name: 'John', age: 30 });
    expect(result.success).toBe(true);
  });

  it('makes _rev optional', () => {
    const schema = documentSchema({ name: z.string() });

    const withoutRev = schema.safeParse({ _id: '1', name: 'John' });
    expect(withoutRev.success).toBe(true);

    const withRev = schema.safeParse({ _id: '1', _rev: '1-abc', name: 'John' });
    expect(withRev.success).toBe(true);
  });

  it('rejects missing _id', () => {
    const schema = documentSchema({ name: z.string() });
    const result = schema.safeParse({ name: 'John' });
    expect(result.success).toBe(false);
  });
});

// ---------- adapter.ts: partialZodSchema ----------

describe('partialZodSchema', () => {
  it('makes all fields optional', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const partial = partialZodSchema(schema);

    expect(partial.safeParse({}).success).toBe(true);
    expect(partial.safeParse({ name: 'John' }).success).toBe(true);
    expect(partial.safeParse({ age: 30 }).success).toBe(true);
  });
});

// ---------- converter.ts: zodToPocket ----------

describe('zodToPocket', () => {
  it('converts basic Zod types to Pocket schema', () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });

    const def = zodToPocket(zodSchema);
    expect(def.version).toBe(1);
    expect(def.properties.name?.type).toBe('string');
    expect(def.properties.name?.required).toBe(true);
    expect(def.properties.age?.type).toBe('number');
    expect(def.properties.active?.type).toBe('boolean');
  });

  it('handles optional fields', () => {
    const zodSchema = z.object({
      name: z.string(),
      bio: z.string().optional(),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.name?.required).toBe(true);
    expect(def.properties.bio?.required).toBe(false);
  });

  it('handles default values', () => {
    const zodSchema = z.object({
      role: z.string().default('user'),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.role?.default).toBe('user');
  });

  it('handles nested objects', () => {
    const zodSchema = z.object({
      address: z.object({
        street: z.string(),
        zip: z.string(),
      }),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.address?.type).toBe('object');
    expect(def.properties.address?.properties?.street?.type).toBe('string');
    expect(def.properties.address?.properties?.zip?.type).toBe('string');
  });

  it('handles arrays', () => {
    const zodSchema = z.object({
      tags: z.array(z.string()),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.tags?.type).toBe('array');
    expect(def.properties.tags?.items?.type).toBe('string');
  });

  it('handles nullable types', () => {
    const zodSchema = z.object({
      description: z.string().nullable(),
    });

    const def = zodToPocket(zodSchema);
    const descType = def.properties.description?.type;
    expect(Array.isArray(descType) ? descType : [descType]).toContain('string');
  });

  it('handles date type', () => {
    const zodSchema = z.object({
      createdAt: z.date(),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.createdAt?.type).toBe('date');
  });

  it('handles custom version', () => {
    const zodSchema = z.object({ name: z.string() });
    const def = zodToPocket(zodSchema, 3);
    expect(def.version).toBe(3);
  });

  it('handles enum types', () => {
    const zodSchema = z.object({
      status: z.enum(['active', 'inactive']),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.status?.type).toBe('string');
  });

  it('handles literal types', () => {
    const zodSchema = z.object({
      type: z.literal('user'),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.type?.type).toBe('string');
  });

  it('handles null type', () => {
    const zodSchema = z.object({
      nothing: z.null(),
    });

    const def = zodToPocket(zodSchema);
    expect(def.properties.nothing?.type).toBe('null');
  });
});

// ---------- converter.ts: pocketToZod ----------

describe('pocketToZod', () => {
  it('converts Pocket schema to Zod schema', () => {
    const pocketSchema = new Schema({
      version: 1,
      properties: {
        name: { type: 'string', required: true },
        age: { type: 'number', required: false },
      },
    });

    const zodSchema = pocketToZod(pocketSchema);
    expect(zodSchema.safeParse({ name: 'John' }).success).toBe(true);
  });

  it('validates required fields', () => {
    const pocketSchema = new Schema({
      version: 1,
      properties: {
        name: { type: 'string', required: true },
      },
    });

    const zodSchema = pocketToZod(pocketSchema);
    expect(zodSchema.safeParse({}).success).toBe(false);
  });

  it('handles all basic types', () => {
    const pocketSchema = new Schema({
      version: 1,
      properties: {
        s: { type: 'string', required: true },
        n: { type: 'number', required: true },
        b: { type: 'boolean', required: true },
        d: { type: 'date', required: true },
      },
    });

    const zodSchema = pocketToZod(pocketSchema);
    expect(
      zodSchema.safeParse({
        s: 'hello',
        n: 42,
        b: true,
        d: new Date(),
      }).success
    ).toBe(true);
  });

  it('handles nested objects', () => {
    const pocketSchema = new Schema({
      version: 1,
      properties: {
        address: {
          type: 'object',
          required: true,
          properties: {
            city: { type: 'string', required: true },
          },
        },
      },
    });

    const zodSchema = pocketToZod(pocketSchema);
    expect(zodSchema.safeParse({ address: { city: 'NYC' } }).success).toBe(true);
    expect(zodSchema.safeParse({ address: {} }).success).toBe(false);
  });

  it('handles arrays with item types', () => {
    const pocketSchema = new Schema({
      version: 1,
      properties: {
        tags: {
          type: 'array',
          required: true,
          items: { type: 'string', required: true },
        },
      },
    });

    const zodSchema = pocketToZod(pocketSchema);
    expect(zodSchema.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    expect(zodSchema.safeParse({ tags: [1, 2] }).success).toBe(false);
  });
});

// ---------- converter.ts: mergeZodSchemas ----------

describe('mergeZodSchemas', () => {
  it('merges two schemas', () => {
    const schema1 = z.object({ name: z.string() });
    const schema2 = z.object({ age: z.number() });

    const merged = mergeZodSchemas(schema1, schema2);
    const result = merged.safeParse({ name: 'John', age: 30 });
    expect(result.success).toBe(true);
  });

  it('second schema overrides first on conflict', () => {
    const schema1 = z.object({ name: z.string() });
    const schema2 = z.object({ name: z.number() });

    const merged = mergeZodSchemas(schema1, schema2);
    expect(merged.safeParse({ name: 42 }).success).toBe(true);
    expect(merged.safeParse({ name: 'John' }).success).toBe(false);
  });
});

// ---------- converter.ts: strictZodSchema / passthroughZodSchema ----------

describe('strictZodSchema', () => {
  it('rejects unknown keys', () => {
    const schema = strictZodSchema({ name: z.string() });
    expect(schema.safeParse({ name: 'John', extra: true }).success).toBe(false);
    expect(schema.safeParse({ name: 'John' }).success).toBe(true);
  });
});

describe('passthroughZodSchema', () => {
  it('preserves unknown keys', () => {
    const schema = passthroughZodSchema({ name: z.string() });
    const result = schema.safeParse({ name: 'John', extra: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).extra).toBe(true);
    }
  });
});

// ---------- round-trip conversion ----------

describe('round-trip conversion', () => {
  it('Zod → Pocket → Zod preserves types', () => {
    const original = z.object({
      name: z.string(),
      age: z.number().optional(),
      active: z.boolean(),
    });

    const pocketDef = zodToPocket(original);
    const pocketSchema = new Schema(pocketDef);
    const roundTripped = pocketToZod(pocketSchema);

    expect(roundTripped.safeParse({ name: 'John', active: true }).success).toBe(true);
    expect(roundTripped.safeParse({ name: 'John', age: 30, active: true }).success).toBe(true);
    expect(roundTripped.safeParse({ active: true }).success).toBe(false);
  });
});

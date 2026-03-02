import { describe, expect, it } from 'vitest';
import { Schema } from './schema.js';

describe('Schema', () => {
  describe('validate() - type checking', () => {
    it('should validate string type', () => {
      const schema = new Schema({
        properties: { name: { type: 'string' } },
      });

      expect(schema.validate({ name: 'Alice' }).valid).toBe(true);
      expect(schema.validate({ name: 123 }).valid).toBe(false);
    });

    it('should validate number type', () => {
      const schema = new Schema({
        properties: { age: { type: 'number' } },
      });

      expect(schema.validate({ age: 30 }).valid).toBe(true);
      expect(schema.validate({ age: 'thirty' }).valid).toBe(false);
    });

    it('should validate boolean type', () => {
      const schema = new Schema({
        properties: { active: { type: 'boolean' } },
      });

      expect(schema.validate({ active: true }).valid).toBe(true);
      expect(schema.validate({ active: 'yes' }).valid).toBe(false);
    });

    it('should validate array type', () => {
      const schema = new Schema({
        properties: { tags: { type: 'array' } },
      });

      expect(schema.validate({ tags: ['a', 'b'] }).valid).toBe(true);
      expect(schema.validate({ tags: 'not-array' }).valid).toBe(false);
    });

    it('should validate object type', () => {
      const schema = new Schema({
        properties: { meta: { type: 'object' } },
      });

      expect(schema.validate({ meta: { key: 'val' } }).valid).toBe(true);
      expect(schema.validate({ meta: 'not-object' }).valid).toBe(false);
    });

    it('should validate null type', () => {
      const schema = new Schema({
        properties: { value: { type: 'null' } },
      });

      expect(schema.validate({ value: null }).valid).toBe(true);
      expect(schema.validate({ value: 'not-null' }).valid).toBe(false);
    });

    it('should accept any type', () => {
      const schema = new Schema({
        properties: { data: { type: 'any' } },
      });

      expect(schema.validate({ data: 'string' }).valid).toBe(true);
      expect(schema.validate({ data: 123 }).valid).toBe(true);
      expect(schema.validate({ data: null }).valid).toBe(true);
    });

    it('should validate union types', () => {
      const schema = new Schema({
        properties: { value: { type: ['string', 'null'] } },
      });

      expect(schema.validate({ value: 'hello' }).valid).toBe(true);
      expect(schema.validate({ value: null }).valid).toBe(true);
      expect(schema.validate({ value: 123 }).valid).toBe(false);
    });

    it('should reject non-object document', () => {
      const schema = new Schema({ properties: {} });

      expect(schema.validate(null).valid).toBe(false);
      expect(schema.validate('string' as any).valid).toBe(false);
    });
  });

  describe('validate() - required fields', () => {
    it('should detect missing required field (via field definition)', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', required: true },
        },
      });

      const result = schema.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Required');
    });

    it('should detect missing required field (via schema required array)', () => {
      const schema = new Schema({
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      });

      const result = schema.validate({});
      expect(result.valid).toBe(false);
    });

    it('should pass when required field is present', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', required: true },
        },
      });

      expect(schema.validate({ name: 'Alice' }).valid).toBe(true);
    });

    it('should fail when required field is undefined', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', required: true },
        },
      });

      expect(schema.validate({ name: undefined }).valid).toBe(false);
    });
  });

  describe('validate() - additional properties', () => {
    it('should reject unknown fields when additionalProperties=false', () => {
      const schema = new Schema({
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      });

      const result = schema.validate({ name: 'Alice', extra: 'field' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unknown field');
    });

    it('should allow unknown fields by default', () => {
      const schema = new Schema({
        properties: { name: { type: 'string' } },
      });

      expect(schema.validate({ name: 'Alice', extra: 'field' }).valid).toBe(true);
    });

    it('should skip internal fields (_prefixed)', () => {
      const schema = new Schema({
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      });

      expect(schema.validate({ name: 'Alice', _id: '1', _rev: '1-abc' }).valid).toBe(true);
    });
  });

  describe('validate() - string constraints', () => {
    it('should validate min length', () => {
      const schema = new Schema({
        properties: { name: { type: 'string', min: 3 } },
      });

      expect(schema.validate({ name: 'Al' }).valid).toBe(false);
      expect(schema.validate({ name: 'Alice' }).valid).toBe(true);
    });

    it('should validate max length', () => {
      const schema = new Schema({
        properties: { code: { type: 'string', max: 5 } },
      });

      expect(schema.validate({ code: 'ABCDEF' }).valid).toBe(false);
      expect(schema.validate({ code: 'ABC' }).valid).toBe(true);
    });

    it('should validate pattern with string regex', () => {
      const schema = new Schema({
        properties: { email: { type: 'string', pattern: '^[^@]+@[^@]+$' } },
      });

      expect(schema.validate({ email: 'alice@example.com' }).valid).toBe(true);
      expect(schema.validate({ email: 'not-an-email' }).valid).toBe(false);
    });

    it('should validate pattern with RegExp', () => {
      const schema = new Schema({
        properties: { code: { type: 'string', pattern: /^[A-Z]{3}$/ } },
      });

      expect(schema.validate({ code: 'ABC' }).valid).toBe(true);
      expect(schema.validate({ code: 'abc' }).valid).toBe(false);
    });
  });

  describe('validate() - number constraints', () => {
    it('should validate min value', () => {
      const schema = new Schema({
        properties: { age: { type: 'number', min: 0 } },
      });

      expect(schema.validate({ age: -1 }).valid).toBe(false);
      expect(schema.validate({ age: 0 }).valid).toBe(true);
    });

    it('should validate max value', () => {
      const schema = new Schema({
        properties: { age: { type: 'number', max: 150 } },
      });

      expect(schema.validate({ age: 200 }).valid).toBe(false);
      expect(schema.validate({ age: 100 }).valid).toBe(true);
    });
  });

  describe('validate() - enum', () => {
    it('should validate enum values', () => {
      const schema = new Schema({
        properties: { role: { type: 'string', enum: ['admin', 'user', 'guest'] } },
      });

      expect(schema.validate({ role: 'admin' }).valid).toBe(true);
      expect(schema.validate({ role: 'superadmin' }).valid).toBe(false);
    });
  });

  describe('validate() - nested schema', () => {
    it('should validate nested object fields', () => {
      const schema = new Schema({
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string', required: true },
              zip: { type: 'string' },
            },
          },
        },
      });

      expect(schema.validate({ address: { city: 'NYC', zip: '10001' } }).valid).toBe(true);
      expect(schema.validate({ address: {} }).valid).toBe(false);
    });

    it('should report nested field path in error', () => {
      const schema = new Schema({
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string', required: true },
            },
          },
        },
      });

      const result = schema.validate({ address: {} });
      expect(result.errors[0].path).toBe('address.city');
    });
  });

  describe('validate() - array items', () => {
    it('should validate array item types', () => {
      const schema = new Schema({
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      });

      expect(schema.validate({ tags: ['a', 'b'] }).valid).toBe(true);
      expect(schema.validate({ tags: ['a', 123] }).valid).toBe(false);
    });

    it('should validate min items', () => {
      const schema = new Schema({
        properties: {
          tags: { type: 'array', items: { type: 'string' }, min: 1 },
        },
      });

      expect(schema.validate({ tags: [] }).valid).toBe(false);
      expect(schema.validate({ tags: ['a'] }).valid).toBe(true);
    });

    it('should validate max items', () => {
      const schema = new Schema({
        properties: {
          tags: { type: 'array', items: { type: 'string' }, max: 2 },
        },
      });

      expect(schema.validate({ tags: ['a', 'b', 'c'] }).valid).toBe(false);
      expect(schema.validate({ tags: ['a'] }).valid).toBe(true);
    });

    it('should report array item index in error path', () => {
      const schema = new Schema({
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      });

      const result = schema.validate({ tags: ['ok', 123] });
      expect(result.errors[0].path).toBe('tags[1]');
    });
  });

  describe('applyDefaults()', () => {
    it('should apply default values for missing fields', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', required: true },
          role: { type: 'string', default: 'user' },
          active: { type: 'boolean', default: true },
        },
      });

      const result = schema.applyDefaults({ name: 'Alice' });
      expect(result).toEqual({ name: 'Alice', role: 'user', active: true });
    });

    it('should not override existing values', () => {
      const schema = new Schema({
        properties: {
          role: { type: 'string', default: 'user' },
        },
      });

      const result = schema.applyDefaults({ role: 'admin' } as any);
      expect(result).toEqual({ role: 'admin' });
    });

    it('should call function defaults', () => {
      let callCount = 0;
      const schema = new Schema({
        properties: {
          id: {
            type: 'string',
            default: () => {
              callCount++;
              return 'generated';
            },
          },
        },
      });

      const result = schema.applyDefaults({});
      expect(result).toEqual({ id: 'generated' });
      expect(callCount).toBe(1);
    });

    it('should deep clone default objects', () => {
      const defaultTags = ['default'];
      const schema = new Schema({
        properties: {
          tags: { type: 'array', default: defaultTags },
        },
      });

      const result1 = schema.applyDefaults({});
      const result2 = schema.applyDefaults({});

      expect(result1).toEqual({ tags: ['default'] });
      // Should be different array instances
      expect((result1 as any).tags).not.toBe((result2 as any).tags);
    });

    it('should not mutate original document', () => {
      const schema = new Schema({
        properties: {
          role: { type: 'string', default: 'user' },
        },
      });

      const original = { name: 'Alice' } as any;
      schema.applyDefaults(original);
      expect(original.role).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty string field', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', min: 1 },
        },
      });

      expect(schema.validate({ name: '' }).valid).toBe(false);
    });

    it('should handle deeply nested objects', () => {
      const schema = new Schema({
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  value: { type: 'number', required: true },
                },
              },
            },
          },
        },
      });

      expect(schema.validate({ level1: { level2: { value: 42 } } }).valid).toBe(true);
      expect(schema.validate({ level1: { level2: {} } }).valid).toBe(false);
    });

    it('should report multiple errors', () => {
      const schema = new Schema({
        properties: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
      });

      const result = schema.validate({});
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should store schema version', () => {
      const schema = new Schema({ version: 3, properties: {} });
      expect(schema.version).toBe(3);
    });

    it('should default version to 1', () => {
      const schema = new Schema({ properties: {} });
      expect(schema.version).toBe(1);
    });
  });
});

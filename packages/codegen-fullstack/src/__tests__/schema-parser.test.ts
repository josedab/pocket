import { describe, expect, it } from 'vitest';
import { createFullstackSchemaParser } from '../schema-parser.js';
import type { CollectionDef, FieldDef, SchemaDefinition } from '../types.js';

describe('SchemaParser', () => {
  const parser = createFullstackSchemaParser();

  const minimalSchema: SchemaDefinition = {
    name: 'app',
    version: '1.0.0',
    collections: [
      {
        name: 'items',
        fields: [{ name: 'title', type: 'string', required: true }],
      },
    ],
  };

  // ── parse() ────────────────────────────────────────────────────────

  describe('parse()', () => {
    it('should parse a JSON string', () => {
      const result = parser.parse(JSON.stringify(minimalSchema));
      expect(result.name).toBe('app');
      expect(result.version).toBe('1.0.0');
      expect(result.collections).toHaveLength(1);
    });

    it('should parse a JSON string with leading/trailing whitespace', () => {
      const result = parser.parse(`  \n  ${JSON.stringify(minimalSchema)}  \n `);
      expect(result.name).toBe('app');
    });

    it('should parse an object directly', () => {
      const result = parser.parse(minimalSchema);
      expect(result).toEqual(minimalSchema);
    });

    it('should parse a JSON array string as-is', () => {
      const arr = [{ name: 'test' }];
      const result = parser.parse(JSON.stringify(arr));
      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw on invalid JSON string', () => {
      expect(() => parser.parse('{ broken json')).toThrow();
    });

    it('should parse simple YAML-like input for top-level keys', () => {
      const yaml = `name: my-app\nversion: 2.0.0\ncollections:\n- name: users\n- name: posts`;
      const result = parser.parse(yaml);
      expect(result.name).toBe('my-app');
      expect(result.version).toBe('2.0.0');
      expect(result.collections).toHaveLength(2);
      expect(result.collections[0].name).toBe('users');
      expect(result.collections[1].name).toBe('posts');
    });

    it('should skip comments and blank lines in YAML input', () => {
      const yaml = `# comment\nname: app\n\n# another comment\nversion: 1.0.0\ncollections:\n- name: items`;
      const result = parser.parse(yaml);
      expect(result.name).toBe('app');
      expect(result.version).toBe('1.0.0');
    });

    it('should handle YAML with only top-level keys and no collections', () => {
      const yaml = `name: bare\nversion: 0.1.0`;
      const result = parser.parse(yaml);
      expect(result.name).toBe('bare');
      expect(result.version).toBe('0.1.0');
    });

    it('should preserve all fields when parsing an object', () => {
      const schema: SchemaDefinition = {
        name: 'full',
        version: '3.0.0',
        collections: [
          {
            name: 'products',
            fields: [
              { name: 'sku', type: 'string', required: true, unique: true, indexed: true },
              { name: 'price', type: 'number', default: 0 },
              { name: 'tags', type: 'array' },
              { name: 'meta', type: 'object' },
              { name: 'created', type: 'date' },
              { name: 'status', type: 'enum' },
              { name: 'active', type: 'boolean' },
            ],
            primaryKey: 'sku',
            timestamps: false,
            softDelete: true,
          },
        ],
      };
      const result = parser.parse(schema);
      expect(result).toEqual(schema);
    });
  });

  // ── validate() ─────────────────────────────────────────────────────

  describe('validate()', () => {
    it('should pass for a valid minimal schema', () => {
      const result = parser.validate(minimalSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when name is missing', () => {
      const s = { ...minimalSchema, name: '' };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('name'));
    });

    it('should fail when name is not a string', () => {
      const s = { ...minimalSchema, name: 42 as unknown as string };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
    });

    it('should fail when version is missing', () => {
      const s = { ...minimalSchema, version: '' };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('version'));
    });

    it('should fail when version is not a string', () => {
      const s = { ...minimalSchema, version: 1 as unknown as string };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
    });

    it('should fail when collections is empty', () => {
      const s = { ...minimalSchema, collections: [] };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('at least one collection'));
    });

    it('should fail when collections is not an array', () => {
      const s = { ...minimalSchema, collections: 'nope' as unknown as CollectionDef[] };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
    });

    it('should fail for duplicate collection names', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [
          { name: 'dup', fields: [{ name: 'a', type: 'string' }] },
          { name: 'dup', fields: [{ name: 'b', type: 'number' }] },
        ],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Duplicate collection name: dup')
      );
    });

    it('should fail for a collection without a name', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: '', fields: [{ name: 'a', type: 'string' }] }],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Each collection must have a name')
      );
    });

    it('should fail for a collection without fields array', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'bad', fields: null as unknown as FieldDef[] }],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('must have fields'));
    });

    it('should fail for a field without a name', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields: [{ name: '', type: 'string' }] }],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('must have a name'));
    });

    it('should fail for duplicate field names within a collection', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [
          {
            name: 'col',
            fields: [
              { name: 'dup', type: 'string' },
              { name: 'dup', type: 'number' },
            ],
          },
        ],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Duplicate field "dup"'));
    });

    it('should fail for invalid field type', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields: [{ name: 'f', type: 'bigint' as FieldDef['type'] }] }],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Invalid field type'));
    });

    it('should accept all valid field types', () => {
      const types: FieldDef['type'][] = [
        'string',
        'number',
        'boolean',
        'date',
        'object',
        'array',
        'enum',
      ];
      const fields = types.map((t, i) => ({ name: `f${i}`, type: t }));
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields }],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(true);
    });

    it('should accumulate multiple errors', () => {
      const s: SchemaDefinition = {
        name: '',
        version: '',
        collections: [],
      };
      const result = parser.validate(s);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── normalize() ────────────────────────────────────────────────────

  describe('normalize()', () => {
    it('should set default primaryKey to _id', () => {
      const n = parser.normalize(minimalSchema);
      expect(n.collections[0].primaryKey).toBe('_id');
    });

    it('should preserve explicit primaryKey', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ ...minimalSchema.collections[0], primaryKey: 'uuid' }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].primaryKey).toBe('uuid');
    });

    it('should default timestamps to true', () => {
      const n = parser.normalize(minimalSchema);
      expect(n.collections[0].timestamps).toBe(true);
    });

    it('should preserve timestamps=false', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ ...minimalSchema.collections[0], timestamps: false }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].timestamps).toBe(false);
    });

    it('should default softDelete to false', () => {
      const n = parser.normalize(minimalSchema);
      expect(n.collections[0].softDelete).toBe(false);
    });

    it('should preserve softDelete=true', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ ...minimalSchema.collections[0], softDelete: true }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].softDelete).toBe(true);
    });

    it('should default field.required to false', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields: [{ name: 'f', type: 'string' }] }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].fields[0].required).toBe(false);
    });

    it('should preserve field.required=true', () => {
      const n = parser.normalize(minimalSchema);
      expect(n.collections[0].fields[0].required).toBe(true);
    });

    it('should default field.unique and field.indexed to false', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields: [{ name: 'f', type: 'string' }] }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].fields[0].unique).toBe(false);
      expect(n.collections[0].fields[0].indexed).toBe(false);
    });

    it('should preserve field.default value', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [{ name: 'col', fields: [{ name: 'f', type: 'number', default: 42 }] }],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].fields[0].default).toBe(42);
    });

    it('should not include default key when undefined', () => {
      const n = parser.normalize(minimalSchema);
      expect('default' in n.collections[0].fields[0]).toBe(false);
    });

    it('should preserve relation information', () => {
      const s: SchemaDefinition = {
        ...minimalSchema,
        collections: [
          {
            name: 'col',
            fields: [
              {
                name: 'ref',
                type: 'string',
                relation: { collection: 'other', type: 'one-to-many' },
              },
            ],
          },
        ],
      };
      const n = parser.normalize(s);
      expect(n.collections[0].fields[0].relation).toEqual({
        collection: 'other',
        type: 'one-to-many',
      });
    });

    it('should not include relation key when undefined', () => {
      const n = parser.normalize(minimalSchema);
      expect('relation' in n.collections[0].fields[0]).toBe(false);
    });

    it('should normalize all collections', () => {
      const s: SchemaDefinition = {
        name: 'multi',
        version: '1.0.0',
        collections: [
          { name: 'a', fields: [{ name: 'x', type: 'string' }] },
          { name: 'b', fields: [{ name: 'y', type: 'number' }] },
          { name: 'c', fields: [{ name: 'z', type: 'boolean' }] },
        ],
      };
      const n = parser.normalize(s);
      expect(n.collections).toHaveLength(3);
      for (const col of n.collections) {
        expect(col.primaryKey).toBe('_id');
        expect(col.timestamps).toBe(true);
        expect(col.softDelete).toBe(false);
      }
    });

    it('should preserve schema name and version', () => {
      const n = parser.normalize(minimalSchema);
      expect(n.name).toBe('app');
      expect(n.version).toBe('1.0.0');
    });
  });
});

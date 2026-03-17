import { beforeEach, describe, expect, it } from 'vitest';
import type { SchemaInspector } from '../schema-inspector.js';
import { createSchemaInspector } from '../schema-inspector.js';
import type { CollectionSchema } from '../types.js';

describe('SchemaInspector', () => {
  let inspector: SchemaInspector;

  beforeEach(() => {
    inspector = createSchemaInspector();
  });

  // ── Schema Inference ──────────────────────────────────────────────

  describe('inspectCollection', () => {
    it('should exclude _id from inferred fields', () => {
      const schema = inspector.inspectCollection('users', [{ _id: '1', name: 'Alice' }]);
      expect(schema.fields.find((f) => f.name === '_id')).toBeUndefined();
    });

    it('should detect string fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', label: 'hello' }]);
      expect(schema.fields.find((f) => f.name === 'label')?.type).toBe('string');
    });

    it('should detect number fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', count: 42 }]);
      expect(schema.fields.find((f) => f.name === 'count')?.type).toBe('number');
    });

    it('should detect boolean fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', active: true }]);
      expect(schema.fields.find((f) => f.name === 'active')?.type).toBe('boolean');
    });

    it('should detect array fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', tags: ['a', 'b'] }]);
      expect(schema.fields.find((f) => f.name === 'tags')?.type).toBe('array');
    });

    it('should detect object fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', meta: { key: 'val' } }]);
      expect(schema.fields.find((f) => f.name === 'meta')?.type).toBe('object');
    });

    it('should detect date fields', () => {
      const schema = inspector.inspectCollection('items', [
        { _id: '1', created: new Date('2024-01-01') },
      ]);
      expect(schema.fields.find((f) => f.name === 'created')?.type).toBe('date');
    });

    it('should detect null values as unknown type', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', value: null }]);
      expect(schema.fields.find((f) => f.name === 'value')?.type).toBe('unknown');
    });

    it('should detect undefined values as unknown type', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', value: undefined }]);
      expect(schema.fields.find((f) => f.name === 'value')?.type).toBe('unknown');
    });

    it('should detect mixed types when a field has different types across docs', () => {
      const schema = inspector.inspectCollection('items', [
        { _id: '1', value: 'hello' },
        { _id: '2', value: 42 },
      ]);
      expect(schema.fields.find((f) => f.name === 'value')?.type).toBe('mixed');
    });

    it('should resolve a field with null and one real type to the real type', () => {
      const schema = inspector.inspectCollection('items', [
        { _id: '1', value: 'hello' },
        { _id: '2', value: null },
      ]);
      // null → 'unknown' is filtered out; only 'string' remains
      expect(schema.fields.find((f) => f.name === 'value')?.type).toBe('string');
    });

    it('should mark fields present in all docs as required', () => {
      const schema = inspector.inspectCollection('items', [
        { _id: '1', name: 'A', age: 10 },
        { _id: '2', name: 'B', age: 20 },
      ]);
      expect(schema.fields.find((f) => f.name === 'name')?.required).toBe(true);
      expect(schema.fields.find((f) => f.name === 'age')?.required).toBe(true);
    });

    it('should mark fields missing in some docs as not required', () => {
      const schema = inspector.inspectCollection('items', [
        { _id: '1', name: 'A', optional: 'yes' },
        { _id: '2', name: 'B' },
      ]);
      expect(schema.fields.find((f) => f.name === 'optional')?.required).toBe(false);
    });

    it('should set all fields as not indexed by default', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', name: 'A' }]);
      for (const field of schema.fields) {
        expect(field.indexed).toBe(false);
      }
    });

    it('should set indexes to empty array when no indexed fields', () => {
      const schema = inspector.inspectCollection('items', [{ _id: '1', name: 'A' }]);
      expect(schema.indexes).toEqual([]);
    });

    it('should handle empty documents array', () => {
      const schema = inspector.inspectCollection('empty', []);
      expect(schema.name).toBe('empty');
      expect(schema.fields).toEqual([]);
      expect(schema.primaryKey).toBe('_id');
    });

    it('should handle documents with no fields other than _id', () => {
      const schema = inspector.inspectCollection('bare', [{ _id: '1' }, { _id: '2' }]);
      expect(schema.fields).toEqual([]);
    });

    it('should handle a large number of fields', () => {
      const doc: Record<string, unknown> = { _id: '1' };
      for (let i = 0; i < 100; i++) {
        doc[`field_${i}`] = `value_${i}`;
      }
      const schema = inspector.inspectCollection('wide', [doc]);
      expect(schema.fields.length).toBe(100);
    });

    it('should detect timestamps with createdAt', () => {
      const schema = inspector.inspectCollection('t', [{ _id: '1', createdAt: '2024-01-01' }]);
      expect(schema.timestamps).toBe(true);
    });

    it('should detect timestamps with updatedAt', () => {
      const schema = inspector.inspectCollection('t', [{ _id: '1', updatedAt: '2024-01-01' }]);
      expect(schema.timestamps).toBe(true);
    });

    it('should detect timestamps with created_at (snake_case)', () => {
      const schema = inspector.inspectCollection('t', [{ _id: '1', created_at: '2024-01-01' }]);
      expect(schema.timestamps).toBe(true);
    });

    it('should detect timestamps with updated_at (snake_case)', () => {
      const schema = inspector.inspectCollection('t', [{ _id: '1', updated_at: '2024-01-01' }]);
      expect(schema.timestamps).toBe(true);
    });

    it('should report no timestamps when none present', () => {
      const schema = inspector.inspectCollection('t', [{ _id: '1', name: 'A' }]);
      expect(schema.timestamps).toBe(false);
    });

    it('should store inspected schema and retrieve with getAllSchemas', () => {
      inspector.inspectCollection('a', [{ _id: '1', x: 1 }]);
      inspector.inspectCollection('b', [{ _id: '1', y: 2 }]);
      const all = inspector.getAllSchemas();
      expect(all.length).toBe(2);
      expect(all.map((s) => s.name).sort()).toEqual(['a', 'b']);
    });

    it('should overwrite a schema if same collection is inspected again', () => {
      inspector.inspectCollection('col', [{ _id: '1', x: 1 }]);
      inspector.inspectCollection('col', [{ _id: '1', y: 'hello' }]);
      const all = inspector.getAllSchemas();
      expect(all.length).toBe(1);
      expect(all[0]!.fields[0]!.name).toBe('y');
    });
  });

  // ── Schema Validation ─────────────────────────────────────────────

  describe('validateSchema', () => {
    it('should return no errors for a valid schema', () => {
      const schema: CollectionSchema = {
        name: 'valid',
        fields: [{ name: 'x', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.validateSchema(schema)).toEqual([]);
    });

    it('should error on empty collection name', () => {
      const schema: CollectionSchema = {
        name: '',
        fields: [{ name: 'x', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(
        errors.some((e) => e.severity === 'error' && e.message.includes('name is required'))
      ).toBe(true);
    });

    it('should warn on zero fields', () => {
      const schema: CollectionSchema = {
        name: 'nofields',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(
        errors.some((e) => e.severity === 'warning' && e.message.includes('at least one field'))
      ).toBe(true);
    });

    it('should error on duplicate field names', () => {
      const schema: CollectionSchema = {
        name: 'dup',
        fields: [
          { name: 'x', type: 'string', required: true, indexed: false },
          { name: 'x', type: 'number', required: false, indexed: false },
        ],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(errors.some((e) => e.severity === 'error' && e.message.includes('Duplicate'))).toBe(
        true
      );
    });

    it('should error on empty field name', () => {
      const schema: CollectionSchema = {
        name: 'bad',
        fields: [{ name: '', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(errors.some((e) => e.message.includes('empty'))).toBe(true);
    });

    it('should report collection name in errors', () => {
      const schema: CollectionSchema = {
        name: 'myCollection',
        fields: [
          { name: 'a', type: 'string', required: true, indexed: false },
          { name: 'a', type: 'string', required: true, indexed: false },
        ],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(errors.every((e) => e.collection === 'myCollection')).toBe(true);
    });

    it('should return multiple errors for multiple issues', () => {
      const schema: CollectionSchema = {
        name: '',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const errors = inspector.validateSchema(schema);
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── TypeScript Generation ─────────────────────────────────────────

  describe('generateTypeScript', () => {
    it('should capitalize the interface name', () => {
      const schema: CollectionSchema = {
        name: 'users',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('export interface Users');
    });

    it('should map string type', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: string;');
    });

    it('should map number type', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'number', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: number;');
    });

    it('should map boolean type', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'boolean', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: boolean;');
    });

    it('should map date type to Date', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'date', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: Date;');
    });

    it('should map array type to unknown[]', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'array', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: unknown[];');
    });

    it('should map object type to Record<string, unknown>', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'x', type: 'object', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('x: Record<string, unknown>;');
    });

    it('should map unknown/mixed types to unknown', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [
          { name: 'a', type: 'mixed', required: true, indexed: false },
          { name: 'b', type: 'unknown', required: true, indexed: false },
        ],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const ts = inspector.generateTypeScript(schema);
      expect(ts).toContain('a: unknown;');
      expect(ts).toContain('b: unknown;');
    });

    it('should use ? for optional fields', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'opt', type: 'string', required: false, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      expect(inspector.generateTypeScript(schema)).toContain('opt?: string;');
    });

    it('should not use ? for required fields', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'req', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const ts = inspector.generateTypeScript(schema);
      expect(ts).toContain('req: string;');
      expect(ts).not.toContain('req?');
    });

    it('should produce valid interface structure with braces', () => {
      const schema: CollectionSchema = {
        name: 'foo',
        fields: [{ name: 'bar', type: 'string', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const ts = inspector.generateTypeScript(schema);
      expect(ts).toMatch(/^export interface Foo \{/);
      expect(ts).toMatch(/\}$/);
    });

    it('should handle empty fields', () => {
      const schema: CollectionSchema = {
        name: 'empty',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const ts = inspector.generateTypeScript(schema);
      expect(ts).toContain('export interface Empty {');
      expect(ts).toContain('}');
    });
  });

  // ── Schema Diffing ────────────────────────────────────────────────

  describe('diffSchemas', () => {
    const base: CollectionSchema = {
      name: 'test',
      fields: [
        { name: 'a', type: 'string', required: true, indexed: false },
        { name: 'b', type: 'number', required: true, indexed: false },
      ],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    it('should detect added fields', () => {
      const updated: CollectionSchema = {
        ...base,
        fields: [...base.fields, { name: 'c', type: 'boolean', required: false, indexed: false }],
      };
      const diffs = inspector.diffSchemas(base, updated);
      expect(diffs.some((d) => d.type === 'added' && d.field === 'c')).toBe(true);
    });

    it('should detect removed fields', () => {
      const updated: CollectionSchema = {
        ...base,
        fields: [base.fields[0]!],
      };
      const diffs = inspector.diffSchemas(base, updated);
      expect(diffs.some((d) => d.type === 'removed' && d.field === 'b')).toBe(true);
    });

    it('should detect type changes', () => {
      const updated: CollectionSchema = {
        ...base,
        fields: [{ name: 'a', type: 'number', required: true, indexed: false }, base.fields[1]!],
      };
      const diffs = inspector.diffSchemas(base, updated);
      const changed = diffs.find((d) => d.type === 'changed' && d.field === 'a');
      expect(changed).toBeDefined();
      expect(changed!.description).toContain('type');
    });

    it('should detect required changes', () => {
      const updated: CollectionSchema = {
        ...base,
        fields: [{ name: 'a', type: 'string', required: false, indexed: false }, base.fields[1]!],
      };
      const diffs = inspector.diffSchemas(base, updated);
      const changed = diffs.find((d) => d.type === 'changed' && d.field === 'a');
      expect(changed).toBeDefined();
      expect(changed!.description).toContain('required');
    });

    it('should return no diffs for identical schemas', () => {
      const diffs = inspector.diffSchemas(base, base);
      expect(diffs).toEqual([]);
    });

    it('should return no diffs for schemas with same fields in different order', () => {
      const reordered: CollectionSchema = {
        ...base,
        fields: [base.fields[1]!, base.fields[0]!],
      };
      const diffs = inspector.diffSchemas(base, reordered);
      expect(diffs).toEqual([]);
    });

    it('should detect both type and required changes in one diff entry', () => {
      const updated: CollectionSchema = {
        ...base,
        fields: [{ name: 'a', type: 'number', required: false, indexed: false }, base.fields[1]!],
      };
      const diffs = inspector.diffSchemas(base, updated);
      const changed = diffs.find((d) => d.field === 'a');
      expect(changed).toBeDefined();
      expect(changed!.description).toContain('type');
      expect(changed!.description).toContain('required');
    });

    it('should handle diffing empty schemas', () => {
      const empty: CollectionSchema = {
        name: 'e',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const diffs = inspector.diffSchemas(empty, empty);
      expect(diffs).toEqual([]);
    });

    it('should detect all additions when base is empty', () => {
      const empty: CollectionSchema = {
        name: 'e',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const diffs = inspector.diffSchemas(empty, base);
      expect(diffs.length).toBe(2);
      expect(diffs.every((d) => d.type === 'added')).toBe(true);
    });

    it('should detect all removals when target is empty', () => {
      const empty: CollectionSchema = {
        name: 'e',
        fields: [],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const diffs = inspector.diffSchemas(base, empty);
      expect(diffs.length).toBe(2);
      expect(diffs.every((d) => d.type === 'removed')).toBe(true);
    });
  });

  // ── Config ────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('should accept custom maxHistoryEntries config', () => {
      const customInspector = createSchemaInspector({ maxHistoryEntries: 10 });
      // Just ensuring it doesn't throw
      const schema = customInspector.inspectCollection('t', [{ _id: '1', x: 1 }]);
      expect(schema).toBeDefined();
    });

    it('should work with default config', () => {
      const defaultInspector = createSchemaInspector();
      const schema = defaultInspector.inspectCollection('t', [{ _id: '1', x: 1 }]);
      expect(schema).toBeDefined();
    });
  });
});

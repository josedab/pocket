import { describe, expect, it } from 'vitest';
import type { SchemaDefinition } from '../../schema/schema.js';
import { diffSchemas, evolveDocument, generateMigrationFromDiff } from '../schema-evolution.js';

describe('Schema Evolution', () => {
  describe('diffSchemas', () => {
    it('should detect identical schemas', () => {
      const schema: SchemaDefinition = {
        version: 1,
        properties: {
          name: { type: 'string', required: true },
          age: { type: 'number' },
        },
      };

      const result = diffSchemas(schema, schema);
      expect(result.identical).toBe(true);
      expect(result.changes).toHaveLength(0);
    });

    it('should detect added fields', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: { name: { type: 'string' } },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: {
          name: { type: 'string' },
          email: { type: 'string', default: '' },
        },
      };

      const result = diffSchemas(v1, v2);
      expect(result.identical).toBe(false);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.type).toBe('field_added');
      expect(result.changes[0]!.path).toBe('email');
      expect(result.changes[0]!.safe).toBe(true);
    });

    it('should flag unsafe addition of required fields without defaults', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: { name: { type: 'string' } },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: {
          name: { type: 'string' },
          email: { type: 'string', required: true },
        },
      };

      const result = diffSchemas(v1, v2);
      expect(result.autoMigrateSafe).toBe(false);
      expect(result.unsafeChanges).toHaveLength(1);
    });

    it('should detect removed fields', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: {
          name: { type: 'string' },
          legacy: { type: 'string' },
        },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: { name: { type: 'string' } },
      };

      const result = diffSchemas(v1, v2);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.type).toBe('field_removed');
      expect(result.changes[0]!.safe).toBe(true);
    });

    it('should detect type changes and flag lossless coercions as safe', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: { count: { type: 'number' } },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: { count: { type: 'string' } },
      };

      const result = diffSchemas(v1, v2);
      const typeChange = result.changes.find((c) => c.type === 'field_type_changed');
      expect(typeChange).toBeDefined();
      expect(typeChange!.safe).toBe(true);
    });

    it('should flag lossy type coercions as unsafe', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: { value: { type: 'string' } },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: { value: { type: 'number' } },
      };

      const result = diffSchemas(v1, v2);
      const typeChange = result.changes.find((c) => c.type === 'field_type_changed');
      expect(typeChange!.safe).toBe(false);
    });

    it('should detect nested property changes', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: {
          address: {
            type: 'object',
            properties: { street: { type: 'string' } },
          },
        },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              zip: { type: 'string', default: '' },
            },
          },
        },
      };

      const result = diffSchemas(v1, v2);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.path).toBe('address.zip');
    });

    it('should detect constraint changes', () => {
      const v1: SchemaDefinition = {
        version: 1,
        properties: { age: { type: 'number', min: 0 } },
      };
      const v2: SchemaDefinition = {
        version: 2,
        properties: { age: { type: 'number', min: 0, max: 150 } },
      };

      const result = diffSchemas(v1, v2);
      const constraintChange = result.changes.find((c) => c.type === 'field_constraint_changed');
      expect(constraintChange).toBeDefined();
    });
  });

  describe('evolveDocument', () => {
    it('should add new fields with defaults', () => {
      const diff = diffSchemas(
        { version: 1, properties: { name: { type: 'string' } } },
        {
          version: 2,
          properties: { name: { type: 'string' }, role: { type: 'string', default: 'user' } },
        }
      );

      const result = evolveDocument({ _id: '1', name: 'Alice' }, diff);
      expect(result.evolved).toBe(true);
      expect(result.document.role).toBe('user');
      expect(result.document._schemaVersion).toBe(2);
    });

    it('should remove deleted fields', () => {
      const diff = diffSchemas(
        { version: 1, properties: { name: { type: 'string' }, legacy: { type: 'string' } } },
        { version: 2, properties: { name: { type: 'string' } } }
      );

      const result = evolveDocument({ _id: '1', name: 'Alice', legacy: 'old' }, diff);
      expect(result.evolved).toBe(true);
      expect(result.document.legacy).toBeUndefined();
    });

    it('should coerce safe type changes', () => {
      const diff = diffSchemas(
        { version: 1, properties: { count: { type: 'number' } } },
        { version: 2, properties: { count: { type: 'string' } } }
      );

      const result = evolveDocument({ _id: '1', count: 42 }, diff);
      expect(result.evolved).toBe(true);
      expect(result.document.count).toBe('42');
    });

    it('should skip unsafe changes unless allowLossyCoercions is set', () => {
      const diff = diffSchemas(
        { version: 1, properties: { value: { type: 'string' } } },
        { version: 2, properties: { value: { type: 'number' } } }
      );

      const safe = evolveDocument({ _id: '1', value: '42' }, diff);
      expect(safe.document.value).toBe('42');

      const lossy = evolveDocument({ _id: '1', value: '42' }, diff, { allowLossyCoercions: true });
      expect(lossy.document.value).toBe(42);
    });

    it('should use custom field transforms', () => {
      const diff = diffSchemas(
        { version: 1, properties: { tags: { type: 'string' } } },
        { version: 2, properties: { tags: { type: 'array' } } }
      );

      const result = evolveDocument({ _id: '1', tags: 'a,b,c' }, diff, {
        allowLossyCoercions: true,
        fieldTransforms: { tags: (v) => (typeof v === 'string' ? v.split(',') : v) },
      });
      expect(result.document.tags).toEqual(['a', 'b', 'c']);
    });

    it('should not modify already-current documents', () => {
      const schema: SchemaDefinition = {
        version: 1,
        properties: { name: { type: 'string' } },
      };
      const result = evolveDocument({ _id: '1', name: 'Alice' }, diffSchemas(schema, schema));
      expect(result.evolved).toBe(false);
    });

    it('should handle nested field evolution', () => {
      const diff = diffSchemas(
        {
          version: 1,
          properties: {
            profile: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
        {
          version: 2,
          properties: {
            profile: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                avatar: { type: 'string', default: 'default.png' },
              },
            },
          },
        }
      );

      const result = evolveDocument({ _id: '1', profile: { name: 'Alice' } }, diff);
      expect(result.evolved).toBe(true);
      const profile = result.document.profile as Record<string, unknown>;
      expect(profile.avatar).toBe('default.png');
    });
  });

  describe('generateMigrationFromDiff', () => {
    it('should create reversible migration functions', () => {
      const diff = diffSchemas(
        { version: 1, properties: { name: { type: 'string' } } },
        {
          version: 2,
          properties: { name: { type: 'string' }, status: { type: 'string', default: 'active' } },
        }
      );

      const { up, down } = generateMigrationFromDiff(diff);

      const upgraded = up({ _id: '1', name: 'Alice' });
      expect(upgraded.status).toBe('active');

      const downgraded = down(upgraded);
      expect(downgraded.status).toBeUndefined();
    });

    it('should handle type coercion in both directions', () => {
      const diff = diffSchemas(
        { version: 1, properties: { count: { type: 'number' } } },
        { version: 2, properties: { count: { type: 'string' } } }
      );

      const { up, down } = generateMigrationFromDiff(diff);

      const upgraded = up({ _id: '1', count: 42 });
      expect(upgraded.count).toBe('42');

      const downgraded = down(upgraded);
      expect(downgraded.count).toBe(42);
    });
  });
});

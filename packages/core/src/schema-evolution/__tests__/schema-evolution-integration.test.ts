/**
 * Integration tests: Schema Evolution + Migration Manager
 *
 * Tests that auto-generated migrations from schema diffs integrate
 * correctly with the existing MigrationManager and MigrationRunner.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MigrationRegistry } from '../../migrations/migration-registry.js';
import type { SchemaDefinition } from '../../schema/schema.js';
import { diffSchemas, generateMigrationFromDiff } from '../schema-evolution.js';

describe('Schema Evolution + Migration Integration', () => {
  let registry: MigrationRegistry;

  beforeEach(() => {
    registry = new MigrationRegistry();
  });

  const v1Schema: SchemaDefinition = {
    version: 1,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
    },
  };

  const v2Schema: SchemaDefinition = {
    version: 2,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
      role: { type: 'string', default: 'user' },
      age: { type: 'number', default: 0 },
    },
  };

  const v3Schema: SchemaDefinition = {
    version: 3,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
      role: { type: 'string', default: 'member' },
      displayName: { type: 'string', default: '' },
    },
  };

  it('should generate and register migrations from sequential schema diffs', () => {
    const diff1to2 = diffSchemas(v1Schema, v2Schema);
    const { up: up1, down: down1 } = generateMigrationFromDiff(diff1to2);

    const diff2to3 = diffSchemas(v2Schema, v3Schema);
    const { up: up2, down: down2 } = generateMigrationFromDiff(diff2to3);

    registry.register('users', [
      { version: 2, name: 'add-role-and-age', up: up1, down: down1 },
      { version: 3, name: 'rename-role-add-displayName', up: up2, down: down2 },
    ]);

    expect(registry.hasMigrations('users')).toBe(true);
    expect(registry.getCurrentVersion('users')).toBe(3);
    expect(registry.getMigrations('users')).toHaveLength(2);
  });

  it('should migrate a v1 document through multiple versions to v3', () => {
    const diff1to2 = diffSchemas(v1Schema, v2Schema);
    const { up: up1 } = generateMigrationFromDiff(diff1to2);

    const diff2to3 = diffSchemas(v2Schema, v3Schema);
    const { up: up2 } = generateMigrationFromDiff(diff2to3);

    const v1Doc = { _id: '1', name: 'Alice', email: 'alice@test.com' };

    // Step through migrations manually (as MigrationRunner would)
    const v2Doc = up1(v1Doc as Record<string, unknown>);
    expect(v2Doc.role).toBe('user');
    expect(v2Doc.age).toBe(0);
    expect(v2Doc.name).toBe('Alice');

    const v3Doc = up2(v2Doc);
    expect(v3Doc.displayName).toBe('');
    // 'age' was removed in v3 schema
    expect(v3Doc.age).toBeUndefined();
    // 'role' default changed but existing value preserved
    expect(v3Doc.name).toBe('Alice');
  });

  it('should rollback from v3 to v1 using down migrations', () => {
    const diff1to2 = diffSchemas(v1Schema, v2Schema);
    const { up: up1, down: down1 } = generateMigrationFromDiff(diff1to2);

    const diff2to3 = diffSchemas(v2Schema, v3Schema);
    const { up: up2, down: down2 } = generateMigrationFromDiff(diff2to3);

    const v1Doc = { _id: '1', name: 'Alice', email: 'alice@test.com' };

    // Upgrade to v3
    const v2Doc = up1(v1Doc as Record<string, unknown>);
    const v3Doc = up2(v2Doc);

    // Rollback to v2
    const rolledBackV2 = down2(v3Doc);
    expect(rolledBackV2.age).toBeDefined(); // re-added with default

    // Rollback to v1
    const rolledBackV1 = down1(rolledBackV2);
    expect(rolledBackV1.role).toBeUndefined();
    expect(rolledBackV1.age).toBeUndefined();
    expect(rolledBackV1.name).toBe('Alice');
  });

  it('should validate migration chain with the registry', () => {
    const diff = diffSchemas(v1Schema, v2Schema);
    const { up, down } = generateMigrationFromDiff(diff);

    registry.register('users', [{ version: 2, up, down }]);

    const validation = registry.validateMigrations('users');
    expect(validation.valid).toBe(true);
  });

  it('should detect version gaps in registered migrations', () => {
    const diff1to2 = diffSchemas(v1Schema, v2Schema);
    const diff2to3 = diffSchemas(v2Schema, v3Schema);
    const { up: up1 } = generateMigrationFromDiff(diff1to2);
    const { up: up2 } = generateMigrationFromDiff(diff2to3);

    // Register versions 2 and 4 (gap at 3)
    registry.register('users', [
      { version: 2, up: up1 },
      { version: 4, up: up2 },
    ]);

    const validation = registry.validateMigrations('users');
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain('gap');
  });

  it('should handle type coercion across migration chain', () => {
    const schemaA: SchemaDefinition = {
      version: 1,
      properties: { count: { type: 'number' } },
    };
    const schemaB: SchemaDefinition = {
      version: 2,
      properties: { count: { type: 'string' } },
    };
    const schemaC: SchemaDefinition = {
      version: 3,
      properties: { count: { type: 'string' }, label: { type: 'string', default: 'n/a' } },
    };

    const { up: up1 } = generateMigrationFromDiff(diffSchemas(schemaA, schemaB));
    const { up: up2 } = generateMigrationFromDiff(diffSchemas(schemaB, schemaC));

    const doc = { _id: '1', count: 42 };
    const v2 = up1(doc as Record<string, unknown>);
    expect(v2.count).toBe('42'); // number → string coercion

    const v3 = up2(v2);
    expect(v3.count).toBe('42'); // string stays string
    expect(v3.label).toBe('n/a'); // new field with default
  });

  it('should batch-evolve multiple documents through a diff', () => {
    const diff = diffSchemas(v1Schema, v2Schema);
    const { up } = generateMigrationFromDiff(diff);

    const docs = Array.from({ length: 100 }, (_, i) => ({
      _id: String(i),
      name: `User ${i}`,
      email: `user${i}@test.com`,
    }));

    const migrated = docs.map((doc) => up(doc as Record<string, unknown>));
    expect(migrated).toHaveLength(100);
    expect(migrated.every((d) => d.role === 'user')).toBe(true);
    expect(migrated.every((d) => d.age === 0)).toBe(true);
  });
});

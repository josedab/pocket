import { describe, it, expect } from 'vitest';
import {
  createMigrationGenerator,
  MigrationGenerator,
} from '../migration-generator.js';
import { createInferenceEngine } from '../inference-engine.js';
import type { InferredSchema } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const engine = createInferenceEngine();

function schemaFrom(docs: Record<string, unknown>[]): InferredSchema {
  return engine.analyze(docs);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MigrationGenerator', () => {
  describe('createMigrationGenerator', () => {
    it('returns a MigrationGenerator instance', () => {
      const generator = createMigrationGenerator();
      expect(generator).toBeInstanceOf(MigrationGenerator);
    });

    it('accepts partial config', () => {
      const generator = createMigrationGenerator({ collectionName: 'users' });
      expect(generator).toBeInstanceOf(MigrationGenerator);
    });
  });

  describe('plan', () => {
    it('detects added fields', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', age: 30, email: 'alice@test.com' },
        { name: 'Bob', age: 25, email: 'bob@test.com' },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      const addStep = plan.steps.find(
        s => s.type === 'add-field' && s.fieldPath === 'email',
      );
      expect(addStep).toBeDefined();
      expect(addStep!.description).toContain('email');
    });

    it('detects removed fields', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', age: 30, bio: 'Hello' },
        { name: 'Bob', age: 25, bio: 'World' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      const removeStep = plan.steps.find(
        s => s.type === 'remove-field' && s.fieldPath === 'bio',
      );
      expect(removeStep).toBeDefined();
      expect(removeStep!.breaking).toBe(true);
    });

    it('detects renamed fields', () => {
      const oldSchema = schemaFrom([
        { userName: 'Alice', age: 30 },
        { userName: 'Bob', age: 25 },
      ]);
      const newSchema = schemaFrom([
        { username: 'Alice', age: 30 },
        { username: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      const renameStep = plan.steps.find(s => s.type === 'rename-field');
      expect(renameStep).toBeDefined();
      expect(renameStep!.details['oldName']).toBe('userName');
      expect(renameStep!.details['newName']).toBe('username');
    });

    it('detects type changes', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', score: 100 },
        { name: 'Bob', score: 200 },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', score: 'high' },
        { name: 'Bob', score: 'low' },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      const typeStep = plan.steps.find(
        s => s.type === 'change-type' && s.fieldPath === 'score',
      );
      expect(typeStep).toBeDefined();
      expect(typeStep!.details['oldType']).toBe('number');
      expect(typeStep!.details['newType']).toBe('string');
      expect(typeStep!.breaking).toBe(true);
    });

    it('reports hasBreakingChanges correctly for breaking changes', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', age: 30 },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice' },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      expect(plan.hasBreakingChanges).toBe(true);
    });

    it('reports hasBreakingChanges as false for add optional field', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', bio: 'Hi' },
        { name: 'Bob' },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      const addStep = plan.steps.find(
        s => s.type === 'add-field' && s.fieldPath === 'bio',
      );
      expect(addStep).toBeDefined();
      // bio is optional (not present in all docs) → not breaking
      expect(addStep!.breaking).toBe(false);
      expect(plan.hasBreakingChanges).toBe(false);
    });

    it('provides a summary string', () => {
      const oldSchema = schemaFrom([{ name: 'Alice' }]);
      const newSchema = schemaFrom([{ name: 'Alice', age: 30 }]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      expect(plan.summary).toContain('migration step');
      expect(plan.summary).toContain('add-field');
    });
  });

  describe('generate', () => {
    it('produces TypeScript migration up script', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator({ collectionName: 'users' });
      const script = generator.generate(oldSchema, newSchema);

      expect(script.up).toContain('Migration: UP');
      expect(script.up).toContain('export async function up');
      expect(script.up).toContain('age');
    });

    it('includes rollback (down) script', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const script = generator.generate(oldSchema, newSchema);

      expect(script.down).toContain('Migration: DOWN');
      expect(script.down).toContain('Rollback');
      expect(script.down).toContain('export async function down');
    });

    it('contains the migration plan in the result', () => {
      const oldSchema = schemaFrom([{ name: 'Alice' }]);
      const newSchema = schemaFrom([{ name: 'Alice', age: 30 }]);

      const generator = createMigrationGenerator();
      const script = generator.generate(oldSchema, newSchema);

      expect(script.plan).toBeDefined();
      expect(script.plan.steps.length).toBeGreaterThan(0);
    });

    it('generates $rename for rename steps', () => {
      const oldSchema = schemaFrom([
        { userName: 'Alice', age: 30 },
        { userName: 'Bob', age: 25 },
      ]);
      const newSchema = schemaFrom([
        { username: 'Alice', age: 30 },
        { username: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const script = generator.generate(oldSchema, newSchema);

      expect(script.up).toContain('$rename');
      expect(script.down).toContain('$rename');
    });

    it('generates $unset for remove-field in up script', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', legacy: 'x' },
        { name: 'Bob', legacy: 'y' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);

      const generator = createMigrationGenerator();
      const script = generator.generate(oldSchema, newSchema);

      expect(script.up).toContain('$unset');
      expect(script.up).toContain('legacy');
    });
  });

  describe('preview', () => {
    it('returns human-readable migration description', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice', email: 'a@b.com' },
        { name: 'Bob', email: 'b@c.com' },
      ]);

      const generator = createMigrationGenerator({ collectionName: 'users' });
      const preview = generator.preview(oldSchema, newSchema);

      expect(preview).toContain('Migration Preview');
      expect(preview).toContain('users');
      expect(preview).toContain('add-field');
    });

    it('shows warning for breaking changes', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', age: 30 },
      ]);
      const newSchema = schemaFrom([
        { name: 'Alice' },
      ]);

      const generator = createMigrationGenerator();
      const preview = generator.preview(oldSchema, newSchema);

      expect(preview).toContain('WARNING');
      expect(preview).toContain('breaking');
    });

    it('shows no changes for identical schemas', () => {
      const schema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const preview = generator.preview(schema, schema);

      expect(preview).toContain('No changes detected');
    });
  });

  describe('edge cases', () => {
    it('produces no steps for identical schemas', () => {
      const schema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(schema, schema);

      expect(plan.steps.length).toBe(0);
      expect(plan.hasBreakingChanges).toBe(false);
    });

    it('handles empty schemas', () => {
      const oldSchema = schemaFrom([]);
      const newSchema = schemaFrom([]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      expect(plan.steps.length).toBe(0);
    });

    it('handles migration from empty to populated schema', () => {
      const oldSchema = schemaFrom([]);
      const newSchema = schemaFrom([
        { name: 'Alice', age: 30 },
      ]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.every(s => s.type === 'add-field')).toBe(true);
    });

    it('handles migration from populated to empty schema', () => {
      const oldSchema = schemaFrom([
        { name: 'Alice', age: 30 },
      ]);
      const newSchema = schemaFrom([]);

      const generator = createMigrationGenerator();
      const plan = generator.plan(oldSchema, newSchema);

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.every(s => s.type === 'remove-field')).toBe(true);
      expect(plan.hasBreakingChanges).toBe(true);
    });
  });
});

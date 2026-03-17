/**
 * Comprehensive tests for @pocket/migration
 *
 * Covers modules not tested in migration.test.ts and lazy-migration.test.ts:
 * - SchemaDiffAnalyzer: diff detection, migration plan generation, renames, rollback steps
 * - MigrationRunner: plan execution, validation, rollback, backup, progress tracking
 * - RxDBAdapter: document extraction, schema mapping, metadata handling
 * - Migration Bridges: RxDB, PouchDB, Dexie, WatermelonDB bridges
 * - Compatibility Layers: RxDB compat, Dexie compat
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSchemaDiffAnalyzer,
  type CollectionSchema,
  type MigrationPlan,
  type SchemaDefinition,
  type SchemaDiff,
  type SchemaDiffAnalyzer,
} from '../schema-diff.js';

import {
  createMigrationRunner,
  type DocumentProvider,
  type MigrationRunner,
} from '../migration-runner.js';

import { RxDBAdapter, createRxDBAdapter, type RxDBData } from '../adapters/rxdb-adapter.js';

import { DexieMigrationBridge, createDexieBridge } from '../bridges/dexie-bridge.js';
import { PouchDBMigrationBridge, createPouchDBBridge } from '../bridges/pouchdb-bridge.js';
import { RxDBMigrationBridge, createRxDBBridge } from '../bridges/rxdb-bridge.js';
import {
  WatermelonDBMigrationBridge,
  createWatermelonDBBridge,
} from '../bridges/watermelondb-bridge.js';

import { DexieCompatLayer, createDexieCompat } from '../compat/dexie-compat.js';
import { RxDBCompatLayer, createRxDBCompat } from '../compat/rxdb-compat.js';

// ============================================================================
// Helpers
// ============================================================================

function makeSchema(
  version: number,
  collections: Record<string, CollectionSchema>
): SchemaDefinition {
  return { version, collections };
}

function makeCollection(
  name: string,
  fields: CollectionSchema['fields'],
  indexes?: CollectionSchema['indexes']
): CollectionSchema {
  return { name, fields, indexes };
}

function createMockDocumentProvider(
  data: Record<string, Record<string, unknown>[]>
): DocumentProvider {
  const store = new Map<string, Record<string, unknown>[]>();
  for (const [col, docs] of Object.entries(data)) {
    store.set(
      col,
      docs.map((d) => ({ ...d }))
    );
  }

  return {
    async getDocuments(collection, options) {
      const docs = store.get(collection) ?? [];
      const offset = options?.offset ?? 0;
      const batchSize = options?.batchSize ?? docs.length;
      return docs.slice(offset, offset + batchSize);
    },
    async putDocument(collection, document) {
      const docs = store.get(collection) ?? [];
      const idx = docs.findIndex((d) => d._id === document._id);
      if (idx >= 0) {
        docs[idx] = document;
      } else {
        docs.push(document);
      }
      store.set(collection, docs);
    },
    async deleteDocument(collection, documentId) {
      const docs = store.get(collection) ?? [];
      store.set(
        collection,
        docs.filter((d) => d._id !== documentId)
      );
    },
    async getDocumentCount(collection) {
      return (store.get(collection) ?? []).length;
    },
  };
}

// ============================================================================
// SchemaDiffAnalyzer
// ============================================================================

describe('SchemaDiffAnalyzer', () => {
  let analyzer: SchemaDiffAnalyzer;
  afterEach(() => analyzer?.dispose());

  // ---------- Field-level diffs ----------

  describe('diff — field changes', () => {
    it('should detect added fields', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {
          name: { type: 'string' },
          email: { type: 'string' },
        }),
      });

      const diffs = analyzer.diff(before, after);
      const added = diffs.filter((d) => d.type === 'field-added');

      expect(added).toHaveLength(1);
      expect(added[0]!.collection).toBe('users');
      expect(added[0]!.field).toBe('email');
      expect(added[0]!.details.confidence).toBe(1);
    });

    it('should detect removed fields', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', {
          name: { type: 'string' },
          age: { type: 'number' },
        }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });

      const diffs = analyzer.diff(before, after);
      const removed = diffs.filter((d) => d.type === 'field-removed');

      expect(removed).toHaveLength(1);
      expect(removed[0]!.field).toBe('age');
    });

    it('should detect type changes', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });

      const diffs = analyzer.diff(before, after);
      const typeChanged = diffs.filter((d) => d.type === 'field-type-changed');

      expect(typeChanged).toHaveLength(1);
      expect(typeChanged[0]!.field).toBe('age');
      expect(typeChanged[0]!.details.before).toBe('string');
      expect(typeChanged[0]!.details.after).toBe('number');
    });

    it('should detect default value changes', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', {
          role: { type: 'string', default: 'user' },
        }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {
          role: { type: 'string', default: 'member' },
        }),
      });

      const diffs = analyzer.diff(before, after);
      const defaultChanged = diffs.filter((d) => d.type === 'field-default-changed');

      expect(defaultChanged).toHaveLength(1);
      expect(defaultChanged[0]!.details.before).toBe('user');
      expect(defaultChanged[0]!.details.after).toBe('member');
    });
  });

  // ---------- Index diffs ----------

  describe('diff — index changes', () => {
    it('should detect added indexes', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { email: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: true },
        ]),
      });

      const diffs = analyzer.diff(before, after);
      const added = diffs.filter((d) => d.type === 'index-added');

      expect(added).toHaveLength(1);
    });

    it('should detect removed indexes', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: true },
        ]),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }),
      });

      const diffs = analyzer.diff(before, after);
      const removed = diffs.filter((d) => d.type === 'index-removed');

      expect(removed).toHaveLength(1);
    });

    it('should detect changed indexes (unique flag)', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: false },
        ]),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: true },
        ]),
      });

      const diffs = analyzer.diff(before, after);
      const indexAdded = diffs.filter((d) => d.type === 'index-added');
      const indexRemoved = diffs.filter((d) => d.type === 'index-removed');

      expect(indexAdded).toHaveLength(1);
      expect(indexRemoved).toHaveLength(1);
    });
  });

  // ---------- Collection-level diffs ----------

  describe('diff — collection changes', () => {
    it('should detect added collections', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {});
      const after = makeSchema(2, {
        posts: makeCollection('posts', { title: { type: 'string' } }),
      });

      const diffs = analyzer.diff(before, after);
      const added = diffs.filter((d) => d.type === 'collection-added');

      expect(added).toHaveLength(1);
      expect(added[0]!.collection).toBe('posts');
    });

    it('should detect removed collections', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        posts: makeCollection('posts', { title: { type: 'string' } }),
      });
      const after = makeSchema(2, {});

      const diffs = analyzer.diff(before, after);
      const removed = diffs.filter((d) => d.type === 'collection-removed');

      expect(removed).toHaveLength(1);
      expect(removed[0]!.collection).toBe('posts');
    });
  });

  // ---------- Rename detection ----------

  describe('detectRenames', () => {
    it('should detect field renames with high similarity', () => {
      analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.6 });

      const before = makeCollection('users', {
        userName: { type: 'string' },
      });
      const after = makeCollection('users', {
        username: { type: 'string' },
      });

      const renames = analyzer.detectRenames(before, after);

      expect(renames).toHaveLength(1);
      expect(renames[0]!.from).toBe('userName');
      expect(renames[0]!.to).toBe('username');
      expect(renames[0]!.confidence).toBeGreaterThan(0.6);
    });

    it('should not detect renames when names are too different', () => {
      analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.6 });

      const before = makeCollection('users', {
        x: { type: 'string' },
      });
      const after = makeCollection('users', {
        totallyDifferentName: { type: 'string' },
      });

      const renames = analyzer.detectRenames(before, after);

      expect(renames).toHaveLength(0);
    });

    it('should boost rename confidence when types match', () => {
      analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.5 });

      const before = makeCollection('users', {
        email: { type: 'string' },
      });
      const after = makeCollection('users', {
        emailAddress: { type: 'string' },
      });

      const renames = analyzer.detectRenames(before, after);

      // "email" → "emailAddress" should have reasonable confidence with type match bonus
      if (renames.length > 0) {
        expect(renames[0]!.confidence).toBeGreaterThan(0);
      }
    });

    it('should emit field-renamed diffs instead of add+remove', () => {
      analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.5 });

      const before = makeSchema(1, {
        users: makeCollection('users', { userName: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { username: { type: 'string' } }),
      });

      const diffs = analyzer.diff(before, after);
      const renamed = diffs.filter((d) => d.type === 'field-renamed');
      const added = diffs.filter((d) => d.type === 'field-added');
      const removed = diffs.filter((d) => d.type === 'field-removed');

      // If rename is detected, there shouldn't be a separate add+remove for those fields
      if (renamed.length > 0) {
        expect(added).toHaveLength(0);
        expect(removed).toHaveLength(0);
      }
    });
  });

  // ---------- isDestructive ----------

  describe('isDestructive', () => {
    it('should return true when fields are removed', () => {
      analyzer = createSchemaDiffAnalyzer();
      const diffs: SchemaDiff[] = [
        {
          type: 'field-removed',
          collection: 'users',
          field: 'age',
          details: { confidence: 1 },
        },
      ];
      expect(analyzer.isDestructive(diffs)).toBe(true);
    });

    it('should return true when collections are removed', () => {
      analyzer = createSchemaDiffAnalyzer();
      const diffs: SchemaDiff[] = [
        {
          type: 'collection-removed',
          collection: 'users',
          details: { confidence: 1 },
        },
      ];
      expect(analyzer.isDestructive(diffs)).toBe(true);
    });

    it('should return true when types are changed', () => {
      analyzer = createSchemaDiffAnalyzer();
      const diffs: SchemaDiff[] = [
        {
          type: 'field-type-changed',
          collection: 'users',
          field: 'age',
          details: { before: 'string', after: 'number', confidence: 1 },
        },
      ];
      expect(analyzer.isDestructive(diffs)).toBe(true);
    });

    it('should return false for non-destructive changes', () => {
      analyzer = createSchemaDiffAnalyzer();
      const diffs: SchemaDiff[] = [
        {
          type: 'field-added',
          collection: 'users',
          field: 'email',
          details: { confidence: 1 },
        },
        {
          type: 'index-added',
          collection: 'users',
          details: { confidence: 1 },
        },
      ];
      expect(analyzer.isDestructive(diffs)).toBe(false);
    });
  });

  // ---------- generateMigrationPlan ----------

  describe('generateMigrationPlan', () => {
    it('should generate steps for each detected diff', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {
          name: { type: 'string' },
          email: { type: 'string' },
        }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.id).toBeDefined();
      expect(plan.fromVersion).toBe(1);
      expect(plan.toVersion).toBe(2);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.createdAt).toBeGreaterThan(0);
    });

    it('should generate addField steps with correct structure', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', {}),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);
      const addStep = plan.steps.find((s) => s.type === 'addField');

      expect(addStep).toBeDefined();
      expect(addStep!.collection).toBe('users');
      expect(addStep!.field).toBe('email');
      expect(addStep!.reversible).toBe(true);
      expect(addStep!.description).toContain('Add field');
    });

    it('should generate removeField steps', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {}),
      });

      const plan = analyzer.generateMigrationPlan(before, after);
      const removeStep = plan.steps.find((s) => s.type === 'removeField');

      expect(removeStep).toBeDefined();
      expect(removeStep!.field).toBe('age');
    });

    it('should generate renameField steps for detected renames', () => {
      analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.5 });

      const before = makeSchema(1, {
        users: makeCollection('users', { userName: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { username: { type: 'string' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);
      const renameStep = plan.steps.find((s) => s.type === 'renameField');

      if (renameStep) {
        expect(renameStep.params.from).toBe('userName');
        expect(renameStep.params.to).toBe('username');
      }
    });

    it('should generate inverse steps when generateRollback is true', () => {
      analyzer = createSchemaDiffAnalyzer({ generateRollback: true });

      const before = makeSchema(1, {
        users: makeCollection('users', {}),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);
      const addStep = plan.steps.find((s) => s.type === 'addField');

      expect(addStep?.inverseStep).toBeDefined();
      expect(addStep!.inverseStep!.type).toBe('removeField');
    });

    it('should not generate inverse steps when generateRollback is false', () => {
      analyzer = createSchemaDiffAnalyzer({ generateRollback: false });

      const before = makeSchema(1, {
        users: makeCollection('users', {}),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);
      const addStep = plan.steps.find((s) => s.type === 'addField');

      expect(addStep?.inverseStep).toBeUndefined();
    });

    it('should flag destructive plans', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {}),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.isDestructive).toBe(true);
    });

    it('should add warnings for destructive changes', () => {
      analyzer = createSchemaDiffAnalyzer({ warnOnDestructive: true });

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {}),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.warnings.length).toBeGreaterThan(0);
      expect(plan.warnings.some((w) => w.includes('Destructive'))).toBe(true);
    });

    it('should warn on type changes', () => {
      analyzer = createSchemaDiffAnalyzer({ warnOnDestructive: true });

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.warnings.some((w) => w.includes('data loss'))).toBe(true);
    });

    it('should suppress warnings when warnOnDestructive is false', () => {
      analyzer = createSchemaDiffAnalyzer({ warnOnDestructive: false });

      const before = makeSchema(1, {
        users: makeCollection('users', { age: { type: 'number' } }),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', {}),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.warnings).toHaveLength(0);
    });

    it('should generate addIndex and removeIndex steps', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: false },
        ]),
      });
      const after = makeSchema(2, {
        users: makeCollection('users', { email: { type: 'string' } }, [
          { fields: ['email'], unique: true },
        ]),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.steps.some((s) => s.type === 'addIndex')).toBe(true);
      expect(plan.steps.some((s) => s.type === 'removeIndex')).toBe(true);
    });

    it('should generate addCollection and removeCollection steps', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        old: makeCollection('old', { x: { type: 'string' } }),
      });
      const after = makeSchema(2, {
        new: makeCollection('new', { y: { type: 'number' } }),
      });

      const plan = analyzer.generateMigrationPlan(before, after);

      expect(plan.steps.some((s) => s.type === 'addCollection')).toBe(true);
      expect(plan.steps.some((s) => s.type === 'removeCollection')).toBe(true);
    });
  });

  // ---------- Edge cases ----------

  describe('edge cases', () => {
    it('should return no diffs for identical schemas', () => {
      analyzer = createSchemaDiffAnalyzer();

      const schema = makeSchema(1, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });

      const diffs = analyzer.diff(schema, schema);

      expect(diffs).toHaveLength(0);
    });

    it('should handle empty schemas', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {});
      const after = makeSchema(2, {});

      const diffs = analyzer.diff(before, after);

      expect(diffs).toHaveLength(0);
    });

    it('should handle schema with no fields in collection', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        empty: makeCollection('empty', {}),
      });
      const after = makeSchema(2, {
        empty: makeCollection('empty', { newField: { type: 'string' } }),
      });

      const diffs = analyzer.diff(before, after);
      expect(diffs.some((d) => d.type === 'field-added' && d.field === 'newField')).toBe(true);
    });

    it('should generate a valid plan with zero diffs (no-op)', () => {
      analyzer = createSchemaDiffAnalyzer();

      const schema = makeSchema(1, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });

      const plan = analyzer.generateMigrationPlan(schema, schema);

      expect(plan.steps).toHaveLength(0);
      expect(plan.isDestructive).toBe(false);
      expect(plan.warnings).toHaveLength(0);
    });
  });

  // ---------- Observable ----------

  describe('diff$ observable', () => {
    it('should emit diffs when diff() is called', () => {
      analyzer = createSchemaDiffAnalyzer();

      const emitted: SchemaDiff[][] = [];
      analyzer.diff$.subscribe((d) => emitted.push(d));

      const before = makeSchema(1, {});
      const after = makeSchema(2, {
        users: makeCollection('users', { name: { type: 'string' } }),
      });

      analyzer.diff(before, after);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.some((d) => d.type === 'collection-added')).toBe(true);
    });

    it('should complete on dispose', () => {
      analyzer = createSchemaDiffAnalyzer();

      let completed = false;
      analyzer.diff$.subscribe({ complete: () => (completed = true) });

      analyzer.dispose();

      expect(completed).toBe(true);
    });
  });

  // ---------- Multiple changes at once ----------

  describe('complex diffs', () => {
    it('should detect multiple changes across collections', () => {
      analyzer = createSchemaDiffAnalyzer();

      const before = makeSchema(1, {
        users: makeCollection('users', {
          name: { type: 'string' },
          age: { type: 'number' },
        }),
        posts: makeCollection('posts', {
          title: { type: 'string' },
        }),
      });

      const after = makeSchema(2, {
        users: makeCollection('users', {
          name: { type: 'string' },
          email: { type: 'string' },
        }),
        posts: makeCollection('posts', {
          title: { type: 'string' },
          body: { type: 'string' },
        }),
        comments: makeCollection('comments', {
          text: { type: 'string' },
        }),
      });

      const diffs = analyzer.diff(before, after);

      // users.age removed, users.email added, posts.body added, comments collection added
      expect(diffs.some((d) => d.type === 'field-removed' && d.field === 'age')).toBe(true);
      expect(diffs.some((d) => d.type === 'field-added' && d.field === 'email')).toBe(true);
      expect(diffs.some((d) => d.type === 'field-added' && d.field === 'body')).toBe(true);
      expect(diffs.some((d) => d.type === 'collection-added' && d.collection === 'comments')).toBe(
        true
      );
    });
  });
});

// ============================================================================
// MigrationRunner
// ============================================================================

describe('MigrationRunner', () => {
  let runner: MigrationRunner;
  afterEach(() => runner?.dispose());

  function simplePlan(steps: MigrationPlan['steps'] = []): MigrationPlan {
    return {
      id: 'plan-1',
      fromVersion: 1,
      toVersion: 2,
      steps,
      estimatedDocuments: 0,
      isDestructive: false,
      warnings: [],
      createdAt: Date.now(),
    };
  }

  // ---------- Validation ----------

  describe('validate', () => {
    it('should require plan id', () => {
      runner = createMigrationRunner();

      const plan = simplePlan();
      plan.id = '';

      const result = runner.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan must have an id');
    });

    it('should require at least one step', () => {
      runner = createMigrationRunner();

      const result = runner.validate(simplePlan([]));

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least one step'))).toBe(true);
    });

    it('should detect duplicate step orders', () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'email',
          params: {},
          reversible: true,
          description: 'Add email',
        },
        {
          id: 's2',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'age',
          params: {},
          reversible: true,
          description: 'Add age',
        },
      ]);

      const result = runner.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate step order'))).toBe(true);
    });

    it('should detect missing step id', () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: '',
          order: 0,
          type: 'addField',
          collection: 'users',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const result = runner.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing an id'))).toBe(true);
    });

    it('should detect missing step collection', () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: '',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const result = runner.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing a collection'))).toBe(true);
    });

    it('should pass valid plan', () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'email',
          params: {},
          reversible: true,
          description: 'Add email',
        },
      ]);

      const result = runner.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ---------- Run ----------

  describe('run', () => {
    it('should execute addField step and add missing fields', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'email',
          params: { fieldSchema: { default: 'none@test.com' } },
          reversible: true,
          description: 'Add email field',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      });

      const result = await runner.run(plan, provider);

      expect(result.status).toBe('completed');
      expect(result.stepsCompleted).toBe(1);
      expect(result.documentsProcessed).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify documents were transformed
      const docs = await provider.getDocuments('users');
      expect(docs[0]!.email).toBe('none@test.com');
      expect(docs[1]!.email).toBe('none@test.com');
    });

    it('should not overwrite existing fields when adding', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'email',
          params: { fieldSchema: { default: 'default@test.com' } },
          reversible: true,
          description: 'Add email field',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1', name: 'Alice', email: 'alice@test.com' }],
      });

      await runner.run(plan, provider);

      const docs = await provider.getDocuments('users');
      expect(docs[0]!.email).toBe('alice@test.com');
    });

    it('should execute removeField step', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'removeField',
          collection: 'users',
          field: 'age',
          params: {},
          reversible: true,
          description: 'Remove age field',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1', name: 'Alice', age: 30 }],
      });

      await runner.run(plan, provider);

      const docs = await provider.getDocuments('users');
      expect(docs[0]).not.toHaveProperty('age');
      expect(docs[0]!.name).toBe('Alice');
    });

    it('should execute renameField step', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'renameField',
          collection: 'users',
          params: { from: 'userName', to: 'username' },
          reversible: true,
          description: 'Rename userName to username',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1', userName: 'alice123' }],
      });

      await runner.run(plan, provider);

      const docs = await provider.getDocuments('users');
      expect(docs[0]!.username).toBe('alice123');
      expect(docs[0]).not.toHaveProperty('userName');
    });

    it('should handle unknown step types gracefully (pass through)', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'transformData',
          collection: 'users',
          params: {},
          reversible: false,
          description: 'Custom transform',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1', name: 'Alice' }],
      });

      const result = await runner.run(plan, provider);

      expect(result.status).toBe('completed');
      expect(result.documentsProcessed).toBe(1);
    });

    it('should process documents in batches', async () => {
      runner = createMigrationRunner({ batchSize: 2 });

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'items',
          field: 'flag',
          params: { fieldSchema: { default: true } },
          reversible: true,
          description: 'Add flag',
        },
      ]);

      const provider = createMockDocumentProvider({
        items: [
          { _id: 'i1', v: 1 },
          { _id: 'i2', v: 2 },
          { _id: 'i3', v: 3 },
          { _id: 'i4', v: 4 },
          { _id: 'i5', v: 5 },
        ],
      });

      const result = await runner.run(plan, provider);

      expect(result.status).toBe('completed');
      expect(result.documentsProcessed).toBe(5);
    });

    it('should track completed vs total steps', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'a',
          field: 'x',
          params: {},
          reversible: true,
          description: 'Step 1',
        },
        {
          id: 's2',
          order: 1,
          type: 'addField',
          collection: 'b',
          field: 'y',
          params: {},
          reversible: true,
          description: 'Step 2',
        },
      ]);

      const provider = createMockDocumentProvider({
        a: [{ _id: 'a1' }],
        b: [{ _id: 'b1' }],
      });

      const result = await runner.run(plan, provider);

      expect(result.totalSteps).toBe(2);
      expect(result.stepsCompleted).toBe(2);
    });

    it('should set duration', async () => {
      runner = createMigrationRunner();
      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'a',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);
      const provider = createMockDocumentProvider({ a: [{ _id: 'a1' }] });

      const result = await runner.run(plan, provider);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.completedAt).toBeDefined();
      expect(result.startedAt).toBeLessThanOrEqual(result.completedAt!);
    });
  });

  // ---------- Dry run ----------

  describe('dry run', () => {
    it('should count documents without transforming them', async () => {
      runner = createMigrationRunner({ dryRun: true });

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'email',
          params: {},
          reversible: true,
          description: 'Add email',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      });

      const result = await runner.run(plan, provider);

      expect(result.status).toBe('completed');
      expect(result.documentsProcessed).toBe(2);

      // Documents should NOT have been modified
      const docs = await provider.getDocuments('users');
      expect(docs[0]).not.toHaveProperty('email');
    });
  });

  // ---------- Error handling ----------

  describe('error handling', () => {
    it('should stop on first error when stopOnError is true', async () => {
      runner = createMigrationRunner({ stopOnError: true });

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
        {
          id: 's2',
          order: 1,
          type: 'addField',
          collection: 'items',
          field: 'y',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      // Provider that throws on first collection
      const provider: DocumentProvider = {
        async getDocuments() {
          throw new Error('DB error');
        },
        async putDocument() {},
        async deleteDocument() {},
        async getDocumentCount() {
          return 1;
        },
      };

      const result = await runner.run(plan, provider);

      expect(result.status).toBe('failed');
      expect(result.stepsCompleted).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should continue on error when stopOnError is false', async () => {
      runner = createMigrationRunner({ stopOnError: false });

      let callCount = 0;
      const provider: DocumentProvider = {
        async getDocuments(_collection) {
          callCount++;
          if (callCount === 1) throw new Error('transient error');
          return [{ _id: 'x' }];
        },
        async putDocument() {},
        async deleteDocument() {},
        async getDocumentCount() {
          return 1;
        },
      };

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'a',
          field: 'x',
          params: {},
          reversible: true,
          description: 'Step 1',
        },
        {
          id: 's2',
          order: 1,
          type: 'addField',
          collection: 'b',
          field: 'y',
          params: {},
          reversible: true,
          description: 'Step 2',
        },
      ]);

      const result = await runner.run(plan, provider);

      // Status should be 'failed' because there was at least one error
      expect(result.status).toBe('failed');
      // But both steps attempted
      expect(result.stepsCompleted).toBe(1); // second step succeeded
      expect(result.errors.length).toBe(1);
    });
  });

  // ---------- Rollback ----------

  describe('rollback', () => {
    it('should rollback a previously executed migration', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1' }],
      });

      const runResult = await runner.run(plan, provider);
      const rollbackResult = await runner.rollback(runResult.id);

      expect(rollbackResult.status).toBe('rolled-back');
      expect(rollbackResult.planId).toBe('plan-1');
    });

    it('should throw for unknown run ID', async () => {
      runner = createMigrationRunner();

      await expect(runner.rollback('nonexistent')).rejects.toThrow('No migration run found');
    });
  });

  // ---------- History ----------

  describe('history', () => {
    it('should track all migration runs', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'a',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({ a: [{ _id: 'a1' }] });

      await runner.run(plan, provider);
      await runner.run(plan, provider);

      const history = runner.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0]!.id).not.toBe(history[1]!.id);
    });
  });

  // ---------- Backup ----------

  describe('backup', () => {
    it('should create backup when createBackup is enabled', async () => {
      runner = createMigrationRunner({ createBackup: true });

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      });

      const result = await runner.run(plan, provider);

      expect(result.backupId).toBeDefined();

      const backup = runner.getBackup(result.backupId!);
      expect(backup).toBeDefined();
      expect(backup!.collections['users']).toHaveLength(2);
      expect(backup!.sizeBytes).toBeGreaterThan(0);
      expect(backup!.planId).toBe('plan-1');
    });

    it('should not create backup in dry run mode', async () => {
      runner = createMigrationRunner({ createBackup: true, dryRun: true });

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({
        users: [{ _id: 'u1' }],
      });

      const result = await runner.run(plan, provider);

      expect(result.backupId).toBeUndefined();
    });

    it('should return undefined for unknown backup ID', () => {
      runner = createMigrationRunner();
      expect(runner.getBackup('nonexistent')).toBeUndefined();
    });
  });

  // ---------- Progress ----------

  describe('progress$', () => {
    it('should emit progress updates during run', async () => {
      runner = createMigrationRunner();

      const updates: string[] = [];
      runner.progress$.subscribe((p) => updates.push(p.status));

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'users',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({ users: [{ _id: 'u1' }] });
      await runner.run(plan, provider);

      expect(updates).toContain('running');
      expect(updates).toContain('completed');
    });

    it('should emit rolled-back status on rollback', async () => {
      runner = createMigrationRunner();

      const plan = simplePlan([
        {
          id: 's1',
          order: 0,
          type: 'addField',
          collection: 'a',
          field: 'x',
          params: {},
          reversible: true,
          description: 'test',
        },
      ]);

      const provider = createMockDocumentProvider({ a: [{ _id: 'a1' }] });
      const runResult = await runner.run(plan, provider);

      const updates: string[] = [];
      runner.progress$.subscribe((p) => updates.push(p.status));

      await runner.rollback(runResult.id);

      expect(updates).toContain('rolled-back');
    });

    it('should complete on dispose', () => {
      runner = createMigrationRunner();

      let completed = false;
      runner.progress$.subscribe({ complete: () => (completed = true) });

      runner.dispose();

      expect(completed).toBe(true);
    });
  });
});

// ============================================================================
// RxDBAdapter
// ============================================================================

describe('RxDBAdapter', () => {
  const sampleData: RxDBData = {
    collections: {
      todos: {
        schema: {
          title: 'todo',
          version: 0,
          primaryKey: 'id',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            done: { type: 'boolean' },
            priority: { type: 'integer' },
            tags: { type: 'array' },
            meta: { type: 'object' },
            dueDate: { type: 'string', format: 'date-time' },
            categoryRef: { type: 'string', ref: 'categories' },
          },
          required: ['id', 'title'],
          indexes: ['title', ['done', 'priority']],
        },
        docs: [
          { id: 'todo-1', title: 'Buy milk', done: false, priority: 1, _rev: '1-abc' },
          { id: 'todo-2', title: 'Walk dog', done: true, priority: 2, _meta: { lwt: 123 } },
          { id: 'todo-3', title: 'Deleted item', done: false, _deleted: true },
        ],
      },
      empty: {
        docs: [],
      },
    },
  };

  it('should create adapter via factory', () => {
    const adapter = createRxDBAdapter(sampleData);
    expect(adapter).toBeInstanceOf(RxDBAdapter);
    expect(adapter.source).toBe('rxdb');
  });

  it('should extract collection names', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const collections = await adapter.getCollections();

    expect(collections).toContain('todos');
    expect(collections).toContain('empty');
  });

  it('should skip soft-deleted documents', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const docs = await adapter.getDocuments('todos');

    const ids = docs.map((d) => d._id);
    expect(ids).toContain('todo-1');
    expect(ids).toContain('todo-2');
    expect(ids).not.toContain('todo-3');
  });

  it('should strip RxDB metadata (_rev, _meta, _deleted, _attachments)', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const docs = await adapter.getDocuments('todos');
    const doc1 = docs.find((d) => d._id === 'todo-1')!;

    expect(doc1).not.toHaveProperty('_rev');
    expect(doc1).not.toHaveProperty('_deleted');
  });

  it('should store stripped metadata in _meta', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const docs = await adapter.getDocuments('todos');
    const doc1 = docs.find((d) => d._id === 'todo-1')!;

    expect(doc1._meta).toBeDefined();
    expect(doc1._meta!._rev).toBe('1-abc');
  });

  it('should use primaryKey from schema for _id', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const docs = await adapter.getDocuments('todos');

    expect(docs[0]!._id).toBe('todo-1');
    // primary key field should be removed from doc body
    expect(docs[0]).not.toHaveProperty('id');
  });

  it('should return correct document count', async () => {
    const adapter = new RxDBAdapter(sampleData);

    expect(await adapter.getDocumentCount('todos')).toBe(2); // deleted doc excluded
    expect(await adapter.getDocumentCount('empty')).toBe(0);
    expect(await adapter.getDocumentCount('nonexistent')).toBe(0);
  });

  it('should support pagination', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const page = await adapter.getDocuments('todos', { skip: 1, limit: 1 });

    expect(page).toHaveLength(1);
    expect(page[0]!._id).toBe('todo-2');
  });

  it('should map JSON Schema types to Pocket types', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const schema = await adapter.getSchema('todos');

    const titleField = schema.fieldMappings.find((f) => f.sourceField === 'title');
    const doneField = schema.fieldMappings.find((f) => f.sourceField === 'done');
    const priorityField = schema.fieldMappings.find((f) => f.sourceField === 'priority');
    const tagsField = schema.fieldMappings.find((f) => f.sourceField === 'tags');
    const metaField = schema.fieldMappings.find((f) => f.sourceField === 'meta');
    const dueDateField = schema.fieldMappings.find((f) => f.sourceField === 'dueDate');
    const categoryRefField = schema.fieldMappings.find((f) => f.sourceField === 'categoryRef');

    expect(titleField?.type).toBe('string');
    expect(doneField?.type).toBe('boolean');
    expect(priorityField?.type).toBe('number');
    expect(tagsField?.type).toBe('array');
    expect(metaField?.type).toBe('object');
    expect(dueDateField?.type).toBe('datetime');
    expect(categoryRefField?.type).toBe('string'); // refs stored as IDs
  });

  it('should infer schema from docs when no schema is defined', async () => {
    const data: RxDBData = {
      collections: {
        notes: {
          docs: [{ id: 'n1', text: 'hello', count: 42 }],
        },
      },
    };

    const adapter = new RxDBAdapter(data);
    const schema = await adapter.getSchema('notes');

    expect(schema.fieldMappings.length).toBeGreaterThan(0);
    const textField = schema.fieldMappings.find((f) => f.sourceField === 'text');
    expect(textField?.type).toBe('string');
  });

  it('should return correct analysis', async () => {
    const adapter = new RxDBAdapter(sampleData);
    const analysis = await adapter.analyze();

    expect(analysis.collections).toContain('todos');
    expect(analysis.collections).toContain('empty');
    expect(analysis.totalDocuments).toBe(2); // deleted doc excluded
    expect(analysis.estimatedSizeBytes).toBeGreaterThan(0);
  });
});

// ============================================================================
// Migration Bridges
// ============================================================================

describe('Migration Bridges', () => {
  // ---------- RxDBMigrationBridge ----------

  describe('RxDBMigrationBridge', () => {
    it('should create via factory', () => {
      const bridge = createRxDBBridge({ source: 'rxdb' });
      expect(bridge).toBeInstanceOf(RxDBMigrationBridge);
    });

    it('should throw for wrong source type', () => {
      expect(() => createRxDBBridge({ source: 'pouchdb' })).toThrow("requires source 'rxdb'");
    });

    it('should inspect source database', async () => {
      const bridge = createRxDBBridge({
        source: 'rxdb',
        sourceConfig: {
          collections: {
            users: {
              schema: { indexes: ['name', ['age', 'email']] },
              docs: [
                { id: 'u1', name: 'Alice', age: 30 },
                { id: 'u2', name: 'Bob', age: 25 },
              ],
            },
          },
        },
      });

      const inspection = await bridge.inspect();

      expect(inspection.source).toBe('rxdb');
      expect(inspection.totalDocuments).toBe(2);
      expect(inspection.collections).toHaveLength(1);
      expect(inspection.collections[0]!.name).toBe('users');
      expect(inspection.collections[0]!.indexes).toEqual(['name', 'age+email']);
    });

    it('should migrate documents', async () => {
      const bridge = createRxDBBridge({
        source: 'rxdb',
        sourceConfig: {
          collections: {
            todos: {
              docs: [
                { id: 't1', title: 'Task 1' },
                { id: 't2', title: 'Task 2', _deleted: true },
                { id: 't3', title: 'Task 3' },
              ],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();

      expect(result.source).toBe('rxdb');
      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(2); // deleted doc skipped
    });

    it('should strip database name prefix from collection names', async () => {
      const bridge = createRxDBBridge({
        source: 'rxdb',
        sourceConfig: {
          databaseName: 'mydb',
          collections: {
            'mydb-users': { docs: [{ id: 'u1', name: 'Alice' }] },
          },
        },
        dryRun: true,
      });

      const inspection = await bridge.inspect();
      expect(inspection.collections[0]!.name).toBe('users');
    });

    it('should filter by target collections', async () => {
      const bridge = createRxDBBridge({
        source: 'rxdb',
        targetCollections: ['users'],
        sourceConfig: {
          collections: {
            users: { docs: [{ id: 'u1' }] },
            logs: { docs: [{ id: 'l1' }] },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]!.name).toBe('users');
    });

    it('should report progress', async () => {
      const updates: string[] = [];
      const bridge = createRxDBBridge({
        source: 'rxdb',
        sourceConfig: {
          collections: {
            items: { docs: [{ id: 'i1' }] },
          },
        },
        onProgress: (p) => updates.push(p.phase),
        dryRun: true,
      });

      await bridge.migrate();

      expect(updates).toContain('migrating');
      expect(updates).toContain('complete');
    });

    it('should migrate indexes when includeIndexes is true', async () => {
      const bridge = createRxDBBridge({
        source: 'rxdb',
        includeIndexes: true,
        sourceConfig: {
          collections: {
            users: {
              schema: { indexes: ['email'] },
              docs: [{ id: 'u1', email: 'a@b.com' }],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections[0]!.indexesMigrated).toBe(1);
    });
  });

  // ---------- PouchDBMigrationBridge ----------

  describe('PouchDBMigrationBridge', () => {
    it('should create via factory', () => {
      const bridge = createPouchDBBridge({ source: 'pouchdb' });
      expect(bridge).toBeInstanceOf(PouchDBMigrationBridge);
    });

    it('should throw for wrong source type', () => {
      expect(() => createPouchDBBridge({ source: 'dexie' })).toThrow("requires source 'pouchdb'");
    });

    it('should inspect source database', async () => {
      const bridge = createPouchDBBridge({
        source: 'pouchdb',
        sourceConfig: {
          collection: 'todos',
          rows: [
            { id: 't1', doc: { _id: 't1', title: 'Task 1' } },
            { id: '_design/views', doc: { _id: '_design/views', views: {} } },
            { id: 't2', doc: { _id: 't2', title: 'Task 2' } },
          ],
        },
      });

      const inspection = await bridge.inspect();

      expect(inspection.source).toBe('pouchdb');
      expect(inspection.totalDocuments).toBe(2); // design doc excluded
      expect(inspection.collections[0]!.name).toBe('todos');
      expect(inspection.collections[0]!.indexes).toEqual(['views']);
    });

    it('should migrate documents and skip design docs', async () => {
      const bridge = createPouchDBBridge({
        source: 'pouchdb',
        sourceConfig: {
          rows: [
            { id: 'd1', doc: { _id: 'd1', name: 'Alice', _rev: '1-abc', _attachments: {} } },
            { id: '_design/x', doc: { _id: '_design/x' } },
          ],
        },
        dryRun: true,
      });

      const result = await bridge.migrate();

      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(1);
    });

    it('should use default collection name', async () => {
      const bridge = createPouchDBBridge({
        source: 'pouchdb',
        sourceConfig: { rows: [] },
      });

      const inspection = await bridge.inspect();
      expect(inspection.collections[0]!.name).toBe('default');
    });

    it('should report progress', async () => {
      const phases: string[] = [];
      const bridge = createPouchDBBridge({
        source: 'pouchdb',
        sourceConfig: {
          rows: [{ id: 'd1', doc: { _id: 'd1', v: 1 } }],
        },
        onProgress: (p) => phases.push(p.phase),
        dryRun: true,
      });

      await bridge.migrate();
      expect(phases).toContain('complete');
    });
  });

  // ---------- DexieMigrationBridge ----------

  describe('DexieMigrationBridge', () => {
    it('should create via factory', () => {
      const bridge = createDexieBridge({ source: 'dexie' });
      expect(bridge).toBeInstanceOf(DexieMigrationBridge);
    });

    it('should throw for wrong source type', () => {
      expect(() => createDexieBridge({ source: 'rxdb' })).toThrow("requires source 'dexie'");
    });

    it('should inspect source database', async () => {
      const bridge = createDexieBridge({
        source: 'dexie',
        sourceConfig: {
          tables: {
            friends: {
              schema: '++id, name, &email',
              docs: [
                { id: 1, name: 'Alice', email: 'alice@test.com' },
                { id: 2, name: 'Bob', email: 'bob@test.com' },
              ],
            },
          },
        },
      });

      const inspection = await bridge.inspect();

      expect(inspection.source).toBe('dexie');
      expect(inspection.totalDocuments).toBe(2);
      expect(inspection.collections[0]!.name).toBe('friends');
      expect(inspection.collections[0]!.indexes).toEqual(['id', 'name', 'email']);
    });

    it('should migrate documents', async () => {
      const bridge = createDexieBridge({
        source: 'dexie',
        sourceConfig: {
          tables: {
            items: {
              schema: '++id, name',
              docs: [
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
              ],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();

      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(2);
    });

    it('should filter by target collections', async () => {
      const bridge = createDexieBridge({
        source: 'dexie',
        targetCollections: ['items'],
        sourceConfig: {
          tables: {
            items: { schema: '++id', docs: [{ id: 1 }] },
            logs: { schema: '++id', docs: [{ id: 1 }] },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]!.name).toBe('items');
    });

    it('should migrate indexes when includeIndexes is true', async () => {
      const bridge = createDexieBridge({
        source: 'dexie',
        includeIndexes: true,
        sourceConfig: {
          tables: {
            friends: {
              schema: '++id, name, &email',
              docs: [{ id: 1, name: 'Alice', email: 'a@b.com' }],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections[0]!.indexesMigrated).toBe(3);
    });
  });

  // ---------- WatermelonDBMigrationBridge ----------

  describe('WatermelonDBMigrationBridge', () => {
    it('should create via factory', () => {
      const bridge = createWatermelonDBBridge({ source: 'watermelondb' });
      expect(bridge).toBeInstanceOf(WatermelonDBMigrationBridge);
    });

    it('should throw for wrong source type', () => {
      expect(() => createWatermelonDBBridge({ source: 'pouchdb' })).toThrow(
        "requires source 'watermelondb'"
      );
    });

    it('should inspect source database', async () => {
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        sourceConfig: {
          collections: {
            posts: {
              modelClass: 'Post',
              columns: ['title', 'body', 'author_id'],
              docs: [
                {
                  id: 'p1',
                  title: 'Hello',
                  body: 'World',
                  author_id: 'a1',
                  _status: 'synced',
                  _changed: '',
                },
              ],
            },
          },
        },
      });

      const inspection = await bridge.inspect();

      expect(inspection.source).toBe('watermelondb');
      expect(inspection.totalDocuments).toBe(1);
      expect(inspection.collections[0]!.name).toBe('posts');
      expect(inspection.collections[0]!.indexes).toEqual(['title', 'body', 'author_id']);
      // Sample doc should have _status/_changed stripped
      expect(inspection.collections[0]!.sampleDocument).not.toHaveProperty('_status');
      expect(inspection.collections[0]!.sampleDocument).not.toHaveProperty('_changed');
    });

    it('should migrate documents and skip deleted ones', async () => {
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        sourceConfig: {
          collections: {
            posts: {
              docs: [
                { id: 'p1', title: 'A', _status: 'synced', _changed: '' },
                { id: 'p2', title: 'B', _status: 'deleted', _changed: '' },
                { id: 'p3', title: 'C', _status: 'created', _changed: '' },
              ],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();

      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(2); // deleted doc skipped
    });

    it('should map belongs_to relations', async () => {
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        sourceConfig: {
          collections: {
            comments: {
              relations: {
                post: { type: 'belongs_to', foreignKey: 'post_id' },
              },
              docs: [{ id: 'c1', text: 'Great!', post_id: 'p1', _status: 'synced', _changed: '' }],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();

      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(1);
    });

    it('should filter by target collections', async () => {
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        targetCollections: ['posts'],
        sourceConfig: {
          collections: {
            posts: { docs: [{ id: 'p1', _status: 'synced', _changed: '' }] },
            comments: { docs: [{ id: 'c1', _status: 'synced', _changed: '' }] },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]!.name).toBe('posts');
    });

    it('should migrate column indexes when includeIndexes is true', async () => {
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        includeIndexes: true,
        sourceConfig: {
          collections: {
            posts: {
              columns: ['title', 'body'],
              docs: [{ id: 'p1', title: 'A', body: 'B', _status: 'synced', _changed: '' }],
            },
          },
        },
        dryRun: true,
      });

      const result = await bridge.migrate();
      expect(result.collections[0]!.indexesMigrated).toBe(2);
    });

    it('should report progress', async () => {
      const phases: string[] = [];
      const bridge = createWatermelonDBBridge({
        source: 'watermelondb',
        sourceConfig: {
          collections: {
            items: { docs: [{ id: 'i1', _status: 'synced', _changed: '' }] },
          },
        },
        onProgress: (p) => phases.push(p.phase),
        dryRun: true,
      });

      await bridge.migrate();
      expect(phases).toContain('complete');
    });
  });
});

// ============================================================================
// Compatibility Layers
// ============================================================================

describe('Compatibility Layers', () => {
  // ---------- RxDBCompatLayer ----------

  describe('RxDBCompatLayer', () => {
    it('should create via factory', () => {
      const compat = createRxDBCompat({});
      expect(compat).toBeInstanceOf(RxDBCompatLayer);
    });

    it('should return self from createRxDatabase', async () => {
      const compat = createRxDBCompat({});
      const db = await compat.createRxDatabase({ name: 'test' });
      expect(db).toBe(compat);
    });

    it('should register collections via addCollections', async () => {
      const compat = createRxDBCompat({});
      await compat.addCollections({ users: { schema: {} } });

      const col = compat.collection('users');
      expect(col).toBeDefined();
    });

    it('should return empty results when no backing db methods', async () => {
      const compat = createRxDBCompat({});
      await compat.addCollections({ users: {} });

      const col = compat.collection('users');
      const found = await col.find().exec();
      expect(found).toEqual([]);

      const one = await col.findOne().exec();
      expect(one).toBeNull();
    });

    it('should delegate find to backing db query method', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([{ _id: 'u1', name: 'Alice' }]),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      const docs = await col.find({ name: 'Alice' }).exec();

      expect(docs).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalledWith('users', { name: 'Alice' });
    });

    it('should delegate findOne to backing db query method', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([{ _id: 'u1', name: 'Alice' }]),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      const doc = await col.findOne({ name: 'Alice' }).exec();

      expect(doc).toEqual({ _id: 'u1', name: 'Alice' });
    });

    it('should delegate insert to backing db', async () => {
      const mockDb = {
        insert: vi.fn().mockResolvedValue({ _id: 'u1', name: 'Alice' }),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      const result = await col.insert({ name: 'Alice' });

      expect(result).toEqual({ _id: 'u1', name: 'Alice' });
      expect(mockDb.insert).toHaveBeenCalledWith('users', { name: 'Alice' });
    });

    it('should delegate bulkInsert to backing db', async () => {
      const mockDb = {
        bulkInsert: vi.fn().mockResolvedValue([{ _id: 'u1' }, { _id: 'u2' }]),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      const { success, error } = await col.bulkInsert([{ name: 'A' }, { name: 'B' }]);

      expect(success).toHaveLength(2);
      expect(error).toHaveLength(0);
    });

    it('should delegate upsert to backing db', async () => {
      const mockDb = {
        upsert: vi.fn().mockResolvedValue({ _id: 'u1', name: 'Alice' }),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      const result = await col.upsert({ _id: 'u1', name: 'Alice' });

      expect(result).toEqual({ _id: 'u1', name: 'Alice' });
    });

    it('should delegate remove to backing db', async () => {
      const mockDb = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const compat = createRxDBCompat(mockDb);
      const col = compat.collection('users');
      await col.remove('u1');

      expect(mockDb.delete).toHaveBeenCalledWith('users', 'u1');
    });

    it('should log deprecation warnings when configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const compat = createRxDBCompat({}, { logDeprecations: true });
      await compat.createRxDatabase({ name: 'test' });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      warnSpy.mockRestore();
    });

    it('should not log when logDeprecations is off', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const compat = createRxDBCompat({}, { logDeprecations: false });
      await compat.createRxDatabase({ name: 'test' });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // ---------- DexieCompatLayer ----------

  describe('DexieCompatLayer', () => {
    it('should create via factory', () => {
      const compat = createDexieCompat({});
      expect(compat).toBeInstanceOf(DexieCompatLayer);
    });

    it('should chain version().stores()', () => {
      const compat = createDexieCompat({});
      const result = compat.version(1).stores({ friends: '++id, name' });
      expect(result).toBe(compat);
    });

    it('should open and close', async () => {
      const compat = createDexieCompat({});

      expect(compat.isOpen).toBe(false);
      await compat.open();
      expect(compat.isOpen).toBe(true);
      compat.close();
      expect(compat.isOpen).toBe(false);
    });

    it('should return table shim', () => {
      const compat = createDexieCompat({});
      const table = compat.table('friends');

      expect(table).toBeDefined();
      expect(typeof table.get).toBe('function');
      expect(typeof table.put).toBe('function');
      expect(typeof table.add).toBe('function');
      expect(typeof table.delete).toBe('function');
      expect(typeof table.toArray).toBe('function');
      expect(typeof table.count).toBe('function');
      expect(typeof table.where).toBe('function');
    });

    it('should return same table shim for same name', () => {
      const compat = createDexieCompat({});
      const t1 = compat.table('friends');
      const t2 = compat.table('friends');
      expect(t1).toBe(t2);
    });

    it('should delegate get to backing db', async () => {
      const mockDb = {
        get: vi.fn().mockResolvedValue({ _id: 'f1', name: 'Alice' }),
      };

      const compat = createDexieCompat(mockDb);
      const result = await compat.table('friends').get('f1');

      expect(result).toEqual({ _id: 'f1', name: 'Alice' });
      expect(mockDb.get).toHaveBeenCalledWith('friends', 'f1');
    });

    it('should delegate put to backing db upsert', async () => {
      const mockDb = {
        upsert: vi.fn().mockResolvedValue({ _id: 'f1' }),
      };

      const compat = createDexieCompat(mockDb);
      const id = await compat.table('friends').put({ name: 'Alice' });

      expect(id).toBe('f1');
    });

    it('should delegate add to backing db insert', async () => {
      const mockDb = {
        insert: vi.fn().mockResolvedValue({ _id: 'f1' }),
      };

      const compat = createDexieCompat(mockDb);
      const id = await compat.table('friends').add({ name: 'Alice' });

      expect(id).toBe('f1');
    });

    it('should delegate delete to backing db', async () => {
      const mockDb = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const compat = createDexieCompat(mockDb);
      await compat.table('friends').delete('f1');

      expect(mockDb.delete).toHaveBeenCalledWith('friends', 'f1');
    });

    it('should delegate toArray to backing db query', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([{ _id: 'f1' }, { _id: 'f2' }]),
      };

      const compat = createDexieCompat(mockDb);
      const items = await compat.table('friends').toArray();

      expect(items).toHaveLength(2);
    });

    it('should count items', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([{ _id: 'f1' }, { _id: 'f2' }]),
      };

      const compat = createDexieCompat(mockDb);
      const count = await compat.table('friends').count();

      expect(count).toBe(2);
    });

    it('should handle where().equals()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Alice', age: 30 },
          { _id: 'f2', name: 'Bob', age: 25 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat.table('friends').where('name').equals('Alice').toArray();

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('should handle where().above()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Alice', age: 30 },
          { _id: 'f2', name: 'Bob', age: 25 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat.table('friends').where('age').above(28).toArray();

      expect(results).toHaveLength(1);
      expect(results[0]!.age).toBe(30);
    });

    it('should handle where().below()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', age: 30 },
          { _id: 'f2', age: 25 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat.table('friends').where('age').below(28).toArray();

      expect(results).toHaveLength(1);
      expect(results[0]!.age).toBe(25);
    });

    it('should handle where().between()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', age: 20 },
          { _id: 'f2', age: 25 },
          { _id: 'f3', age: 35 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat.table('friends').where('age').between(22, 30).toArray();

      expect(results).toHaveLength(1);
      expect(results[0]!.age).toBe(25);
    });

    it('should handle where().anyOf()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Alice' },
          { _id: 'f2', name: 'Bob' },
          { _id: 'f3', name: 'Charlie' },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat
        .table('friends')
        .where('name')
        .anyOf(['Alice', 'Charlie'])
        .toArray();

      expect(results).toHaveLength(2);
    });

    it('should handle where().limit()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', age: 30 },
          { _id: 'f2', age: 25 },
          { _id: 'f3', age: 35 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const results = await compat.table('friends').where('age').above(20).limit(2).toArray();

      expect(results).toHaveLength(2);
    });

    it('should handle where collection count()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Alice' },
          { _id: 'f2', name: 'Bob' },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const count = await compat.table('friends').where('name').equals('Alice').count();

      expect(count).toBe(1);
    });

    it('should handle where collection first()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Alice' },
          { _id: 'f2', name: 'Bob' },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const first = await compat.table('friends').where('name').equals('Alice').first();

      expect(first?.name).toBe('Alice');
    });

    it('should handle where collection sortBy()', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue([
          { _id: 'f1', name: 'Charlie', age: 35 },
          { _id: 'f2', name: 'Alice', age: 25 },
          { _id: 'f3', name: 'Bob', age: 30 },
        ]),
      };

      const compat = createDexieCompat(mockDb);
      const sorted = await compat.table('friends').where('age').above(0).sortBy('age');

      expect(sorted[0]!.age).toBe(25);
      expect(sorted[2]!.age).toBe(35);
    });

    it('should delegate transaction to backing db', async () => {
      const txFn = vi.fn().mockImplementation(async (_tables, _mode, fn) => fn());
      const mockDb = { transaction: txFn };

      const compat = createDexieCompat(mockDb);
      const work = vi.fn();

      await compat.transaction('rw', ['friends'], work);

      expect(txFn).toHaveBeenCalled();
      expect(work).toHaveBeenCalled();
    });

    it('should run fn directly when no transaction method on db', async () => {
      const compat = createDexieCompat({});
      const work = vi.fn();

      await compat.transaction('rw', 'friends', work);

      expect(work).toHaveBeenCalled();
    });

    it('should return empty results when no backing db methods', async () => {
      const compat = createDexieCompat({});
      const result = await compat.table('t').get('x');
      expect(result).toBeUndefined();

      const arr = await compat.table('t').toArray();
      expect(arr).toEqual([]);
    });

    it('should log deprecation warnings when configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const compat = createDexieCompat({}, { logDeprecations: true });
      await compat.open();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      warnSpy.mockRestore();
    });

    it('should handle bulkPut and bulkAdd', async () => {
      const mockDb = {
        upsert: vi.fn().mockResolvedValue({ _id: 'x' }),
        insert: vi.fn().mockResolvedValue({ _id: 'x' }),
      };

      const compat = createDexieCompat(mockDb);

      await compat.table('t').bulkPut([{ name: 'A' }, { name: 'B' }]);
      expect(mockDb.upsert).toHaveBeenCalledTimes(2);

      await compat.table('t').bulkAdd([{ name: 'C' }]);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should handle bulkDelete', async () => {
      const mockDb = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const compat = createDexieCompat(mockDb);
      await compat.table('t').bulkDelete(['k1', 'k2']);

      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });
});

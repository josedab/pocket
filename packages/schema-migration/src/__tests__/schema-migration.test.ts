import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryMigrationStore,
  MigrationRunner,
  createMigrationRunner,
  defineMigration,
} from '../migration-runner.js';
import type { Migration, MigrationEvent } from '../types.js';

function buildTestMigrations(): Migration[] {
  return [
    defineMigration(1)
      .name('create-users')
      .description('Create users collection')
      .createCollection('users', [
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
      ])
      .build(),
    defineMigration(2)
      .name('add-user-age')
      .addField('users', { name: 'age', type: 'number' })
      .build(),
    defineMigration(3)
      .name('create-todos')
      .createCollection('todos', [
        { name: 'title', type: 'string', required: true },
        { name: 'done', type: 'boolean', defaultValue: false },
      ])
      .build(),
  ];
}

describe('InMemoryMigrationStore', () => {
  let store: InMemoryMigrationStore;

  beforeEach(() => {
    store = new InMemoryMigrationStore();
  });

  it('starts with version 0', async () => {
    expect(await store.getCurrentVersion()).toBe(0);
  });

  it('records and retrieves migrations', async () => {
    await store.recordMigration({
      version: 1,
      name: 'test',
      status: 'applied',
      appliedAt: Date.now(),
      rolledBackAt: null,
      executionTimeMs: 10,
    });
    const applied = await store.getAppliedMigrations();
    expect(applied).toHaveLength(1);
    expect(applied[0]!.version).toBe(1);
  });

  it('tracks current version from applied migrations', async () => {
    await store.recordMigration({
      version: 1,
      name: 'v1',
      status: 'applied',
      appliedAt: Date.now(),
      rolledBackAt: null,
      executionTimeMs: 5,
    });
    await store.recordMigration({
      version: 3,
      name: 'v3',
      status: 'applied',
      appliedAt: Date.now(),
      rolledBackAt: null,
      executionTimeMs: 5,
    });
    expect(await store.getCurrentVersion()).toBe(3);
  });

  it('manages collection data', async () => {
    await store.createCollection('users');
    expect(await store.collectionExists('users')).toBe(true);

    await store.setCollectionData('users', [{ _id: '1', name: 'Alice' }]);
    const data = await store.getCollectionData('users');
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({ _id: '1', name: 'Alice' });
  });

  it('renames collections', async () => {
    await store.createCollection('old');
    await store.setCollectionData('old', [{ _id: '1' }]);
    await store.renameCollection('old', 'new');

    expect(await store.collectionExists('old')).toBe(false);
    expect(await store.collectionExists('new')).toBe(true);
    expect(await store.getCollectionData('new')).toHaveLength(1);
  });

  it('drops collections', async () => {
    await store.createCollection('temp');
    await store.dropCollection('temp');
    expect(await store.collectionExists('temp')).toBe(false);
  });

  it('updates existing migration records', async () => {
    await store.recordMigration({
      version: 1,
      name: 'v1',
      status: 'applied',
      appliedAt: Date.now(),
      rolledBackAt: null,
      executionTimeMs: 5,
    });
    await store.updateMigration(1, { status: 'rolled_back', rolledBackAt: Date.now() });
    const records = await store.getAppliedMigrations();
    expect(records[0]!.status).toBe('rolled_back');
  });
});

describe('MigrationBuilder', () => {
  it('builds a migration with version and name', () => {
    const migration = defineMigration(1).name('init').build();
    expect(migration.version).toBe(1);
    expect(migration.name).toBe('init');
    expect(migration.up).toEqual([]);
    expect(migration.down).toEqual([]);
  });

  it('throws for version < 1', () => {
    expect(() => defineMigration(0)).toThrow('version must be >= 1');
  });

  it('throws if name is missing', () => {
    expect(() => defineMigration(1).build()).toThrow('requires a name');
  });

  it('adds createCollection with auto down step', () => {
    const m = defineMigration(1)
      .name('test')
      .createCollection('users', [{ name: 'name', type: 'string' }])
      .build();
    expect(m.up).toHaveLength(1);
    expect(m.up[0]!.type).toBe('createCollection');
    expect(m.down).toHaveLength(1);
    expect(m.down[0]!.type).toBe('dropCollection');
  });

  it('adds addField with auto removeField down step', () => {
    const m = defineMigration(1)
      .name('test')
      .addField('users', { name: 'bio', type: 'string' })
      .build();
    expect(m.up[0]!.type).toBe('addField');
    expect(m.down[0]!.type).toBe('removeField');
  });

  it('adds renameField with auto reverse down step', () => {
    const m = defineMigration(1).name('test').renameField('users', 'name', 'fullName').build();
    expect(m.up[0]!.type).toBe('renameField');
    if (m.down[0]!.type === 'renameField') {
      expect(m.down[0]!.from).toBe('fullName');
      expect(m.down[0]!.to).toBe('name');
    }
  });

  it('adds addIndex with auto removeIndex down step', () => {
    const m = defineMigration(1)
      .name('test')
      .addIndex('users', 'idx_email', ['email'], true)
      .build();
    expect(m.up[0]!.type).toBe('addIndex');
    expect(m.down[0]!.type).toBe('removeIndex');
  });

  it('supports transformData step', () => {
    const m = defineMigration(1)
      .name('test')
      .transformData('users', (doc) => ({ ...doc, migrated: true }), 'flag migrated')
      .build();
    expect(m.up[0]!.type).toBe('transformData');
  });

  it('supports custom down steps', () => {
    const m = defineMigration(1)
      .name('test')
      .createCollection('users', [])
      .down({ type: 'dropCollection', collection: 'users' })
      .build();
    expect(m.down).toHaveLength(1);
  });

  it('supports description', () => {
    const m = defineMigration(1).name('test').description('A test migration').build();
    expect(m.description).toBe('A test migration');
  });
});

describe('MigrationRunner', () => {
  let store: InMemoryMigrationStore;
  let migrations: Migration[];

  beforeEach(() => {
    store = new InMemoryMigrationStore();
    migrations = buildTestMigrations();
  });

  it('creates via factory function', () => {
    const runner = createMigrationRunner({ store, migrations });
    expect(runner).toBeInstanceOf(MigrationRunner);
    runner.destroy();
  });

  it('throws on duplicate migration versions', () => {
    const dupes = [defineMigration(1).name('a').build(), defineMigration(1).name('b').build()];
    expect(() => new MigrationRunner({ store, migrations: dupes })).toThrow(
      'Duplicate migration version'
    );
  });

  it('throws on invalid version', () => {
    expect(() => defineMigration(0)).toThrow('version must be >= 1');
  });

  describe('plan', () => {
    it('plans all migrations when at version 0', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const plan = await runner.plan();
      expect(plan.direction).toBe('up');
      expect(plan.migrations).toHaveLength(3);
      expect(plan.currentVersion).toBe(0);
      expect(plan.targetVersion).toBe(3);
      runner.destroy();
    });

    it('plans to specific target version', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const plan = await runner.plan(2);
      expect(plan.migrations).toHaveLength(2);
      expect(plan.targetVersion).toBe(2);
      runner.destroy();
    });

    it('plans down direction when target < current', async () => {
      // First migrate up
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate();
      const plan = await runner.plan(1);
      expect(plan.direction).toBe('down');
      expect(plan.migrations.length).toBeGreaterThan(0);
      runner.destroy();
    });
  });

  describe('migrate', () => {
    it('migrates all to latest version', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const result = await runner.migrate();

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(3);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(3);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.success)).toBe(true);
      runner.destroy();
    });

    it('creates collections', async () => {
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate();

      expect(await store.collectionExists('users')).toBe(true);
      expect(await store.collectionExists('todos')).toBe(true);
      runner.destroy();
    });

    it('adds fields with default values', async () => {
      const runner = new MigrationRunner({ store, migrations });
      // Setup initial data before migration
      await store.createCollection('users');
      await store.setCollectionData('users', [
        { _id: '1', name: 'Alice', email: 'alice@test.com' },
      ]);

      await runner.migrate();

      const users = await store.getCollectionData('users');
      expect(users[0]).toHaveProperty('age');
      runner.destroy();
    });

    it('migrates to a specific version', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const result = await runner.migrate(2);

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(2);
      expect(result.toVersion).toBe(2);
      expect(await store.getCurrentVersion()).toBe(2);
      runner.destroy();
    });

    it('records applied migration status', async () => {
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate();

      const records = await store.getAppliedMigrations();
      expect(records).toHaveLength(3);
      expect(records.every((r) => r.status === 'applied')).toBe(true);
      runner.destroy();
    });

    it('handles transformData step', async () => {
      const withTransform = [
        defineMigration(1)
          .name('create-users')
          .createCollection('users', [{ name: 'name', type: 'string' }])
          .build(),
        defineMigration(2)
          .name('uppercase-names')
          .transformData('users', (doc) => ({
            ...doc,
            name: String(doc.name).toUpperCase(),
          }))
          .build(),
      ];

      await store.createCollection('users');
      await store.setCollectionData('users', [{ name: 'alice' }]);

      const runner = new MigrationRunner({ store, migrations: withTransform });
      await runner.migrate();

      const users = await store.getCollectionData('users');
      expect(users[0]!.name).toBe('ALICE');
      runner.destroy();
    });
  });

  describe('rollback', () => {
    it('rolls back the last migration', async () => {
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate();

      const result = await runner.rollback();
      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(1);
      expect(await store.getCurrentVersion()).toBe(2);
      runner.destroy();
    });

    it('rolls back multiple steps', async () => {
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate();

      const result = await runner.rollback(2);
      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(2);
      runner.destroy();
    });

    it('returns no-op when nothing to rollback', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const result = await runner.rollback();
      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(0);
      runner.destroy();
    });
  });

  describe('status', () => {
    it('reports pending migrations at version 0', async () => {
      const runner = new MigrationRunner({ store, migrations });
      const status = await runner.status();
      expect(status.currentVersion).toBe(0);
      expect(status.pending).toHaveLength(3);
      expect(status.applied).toHaveLength(0);
      runner.destroy();
    });

    it('reports correct status after partial migration', async () => {
      const runner = new MigrationRunner({ store, migrations });
      await runner.migrate(2);

      const status = await runner.status();
      expect(status.currentVersion).toBe(2);
      expect(status.pending).toHaveLength(1);
      expect(status.applied).toHaveLength(2);
      runner.destroy();
    });
  });

  describe('events', () => {
    it('emits migration lifecycle events', async () => {
      const runner = new MigrationRunner({ store, migrations: [migrations[0]!] });
      const events: MigrationEvent[] = [];
      runner.events$.subscribe((e) => events.push(e));

      await runner.migrate();

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('plan_created');
      expect(eventTypes).toContain('migration_start');
      expect(eventTypes).toContain('step_execute');
      expect(eventTypes).toContain('migration_complete');
      runner.destroy();
    });
  });

  describe('dry run', () => {
    it('does not execute steps in dry run mode', async () => {
      const runner = new MigrationRunner({ store, migrations, dryRun: true });
      await runner.migrate();

      expect(await store.getCurrentVersion()).toBe(0);
      expect(await store.collectionExists('users')).toBe(false);
      runner.destroy();
    });
  });

  describe('error handling', () => {
    it('records failure and stops on error', async () => {
      // Seed data that will cause the transform to throw
      await store.createCollection('users');
      await store.setCollectionData('users', [{ _id: '1', name: 'Alice' }]);

      const failingMigrations = [
        defineMigration(1)
          .name('fail')
          .transformData('users', () => {
            throw new Error('transform failed');
          })
          .build(),
      ];

      const runner = new MigrationRunner({ store, migrations: failingMigrations });
      const result = await runner.migrate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('transform failed');
      expect(result.results[0]!.success).toBe(false);
      runner.destroy();
    });
  });
});

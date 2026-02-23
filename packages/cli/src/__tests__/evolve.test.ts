import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evolveSchema,
  formatEvolveResults,
  type StoredSchema,
} from '../commands/migrate/evolve.js';

describe('Schema Evolution CLI Wizard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-evolve-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const usersV1: StoredSchema = {
    version: 1,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
    },
  };

  const usersV2: StoredSchema = {
    version: 2,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
      role: { type: 'string', default: 'user' },
      age: { type: 'number' },
    },
  };

  const usersV3: StoredSchema = {
    version: 3,
    properties: {
      name: { type: 'string', required: true },
      email: { type: 'string' },
      role: { type: 'string', default: 'member' },
      displayName: { type: 'string', default: '' },
    },
  };

  it('should detect no changes for new schemas (no prior snapshot)', async () => {
    const results = await evolveSchema({ users: usersV1 }, { cwd: tmpDir, dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.diff.identical).toBe(true);
  });

  it('should detect added fields between versions', async () => {
    // First run to create snapshot
    await evolveSchema({ users: usersV1 }, { cwd: tmpDir });

    // Second run with v2
    const results = await evolveSchema({ users: usersV2 }, { cwd: tmpDir, dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.diff.identical).toBe(false);

    const addedFields = results[0]!.diff.changes.filter((c) => c.type === 'field_added');
    expect(addedFields.length).toBe(2);
  });

  it('should detect removed fields', async () => {
    await evolveSchema({ users: usersV2 }, { cwd: tmpDir });
    const results = await evolveSchema({ users: usersV3 }, { cwd: tmpDir, dryRun: true });

    const removed = results[0]!.diff.changes.filter((c) => c.type === 'field_removed');
    expect(removed.length).toBe(1); // age removed
  });

  it('should generate migration file when not dry-run', async () => {
    await evolveSchema({ users: usersV1 }, { cwd: tmpDir });

    const results = await evolveSchema(
      { users: usersV2 },
      {
        cwd: tmpDir,
        outputDir: path.join(tmpDir, 'migrations'),
      }
    );

    expect(results[0]!.migrationGenerated).toBe(true);
    expect(results[0]!.migrationPath).toBeTruthy();
    expect(fs.existsSync(results[0]!.migrationPath!)).toBe(true);

    const content = fs.readFileSync(results[0]!.migrationPath!, 'utf-8');
    expect(content).toContain('export function up');
    expect(content).toContain('export function down');
    expect(content).toContain('v1 → v2');
  });

  it('should save snapshots to .pocket/schemas/', async () => {
    await evolveSchema({ users: usersV1 }, { cwd: tmpDir });
    const snapshotDir = path.join(tmpDir, '.pocket', 'schemas');
    expect(fs.existsSync(snapshotDir)).toBe(true);
    const files = fs.readdirSync(snapshotDir);
    expect(files.length).toBe(1);
  });

  it('should handle multiple collections', async () => {
    const schemas = {
      users: usersV1,
      posts: { version: 1, properties: { title: { type: 'string' } } } as StoredSchema,
    };
    await evolveSchema(schemas, { cwd: tmpDir });

    const v2Schemas = {
      users: usersV2,
      posts: {
        version: 2,
        properties: {
          title: { type: 'string' },
          published: { type: 'boolean', default: false },
        },
      } as StoredSchema,
    };
    const results = await evolveSchema(v2Schemas, { cwd: tmpDir, dryRun: true });
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.diff.identical)).toBe(true);
  });

  it('should filter by --collection option', async () => {
    await evolveSchema(
      {
        users: usersV1,
        posts: { version: 1, properties: { title: { type: 'string' } } } as StoredSchema,
      },
      { cwd: tmpDir }
    );

    const results = await evolveSchema(
      {
        users: usersV2,
        posts: {
          version: 2,
          properties: { title: { type: 'string' }, body: { type: 'string' } },
        } as StoredSchema,
      },
      { cwd: tmpDir, collection: 'users', dryRun: true }
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.collection).toBe('users');
  });

  it('should block unsafe changes without --allow-lossy', async () => {
    await evolveSchema({ users: usersV1 }, { cwd: tmpDir });

    const unsafeSchema: StoredSchema = {
      version: 2,
      properties: {
        name: { type: 'number' }, // type change string→number
        email: { type: 'string' },
      },
    };

    const results = await evolveSchema({ users: unsafeSchema }, { cwd: tmpDir, dryRun: true });
    expect(results[0]!.diff.autoMigrateSafe).toBe(false);
    expect(results[0]!.migrationGenerated).toBe(false);
  });

  it('should format results for terminal display', async () => {
    await evolveSchema({ users: usersV1 }, { cwd: tmpDir });
    const results = await evolveSchema({ users: usersV2 }, { cwd: tmpDir, dryRun: true });

    const output = formatEvolveResults(results);
    expect(output).toContain('Schema Diff');
    expect(output).toContain('users');
    expect(output).toContain('DRY RUN');
    expect(output).toContain('Summary');
  });
});

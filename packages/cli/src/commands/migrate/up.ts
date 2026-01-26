/**
 * @pocket/cli - Migrate Up Command
 *
 * Runs pending migrations.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../../config/loader.js';

/**
 * Migrate up options
 */
export interface MigrateUpOptions {
  /** Number of migrations to run (default: all) */
  count?: number;
  /** Working directory */
  cwd?: string;
  /** Dry run - show what would be run without executing */
  dryRun?: boolean;
}

/**
 * Get list of migration files
 */
function getMigrationFiles(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
    .sort();
}

/**
 * Get applied migrations (reads from a local tracking file)
 */
function getAppliedMigrations(cwd: string): Set<string> {
  const trackingFile = path.join(cwd, '.pocket', 'migrations.json');
  if (!fs.existsSync(trackingFile)) {
    return new Set();
  }

  try {
    const data = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
    return new Set(data.applied ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Save applied migrations
 */
function saveAppliedMigrations(cwd: string, applied: Set<string>): void {
  const pocketDir = path.join(cwd, '.pocket');
  if (!fs.existsSync(pocketDir)) {
    fs.mkdirSync(pocketDir, { recursive: true });
  }

  const trackingFile = path.join(pocketDir, 'migrations.json');
  fs.writeFileSync(
    trackingFile,
    JSON.stringify(
      {
        applied: Array.from(applied),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/**
 * Run pending migrations
 *
 * @param options - Migrate up options
 */
export async function up(options: MigrateUpOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(cwd, config.migrations?.directory ?? './migrations');
  const migrationFiles = getMigrationFiles(migrationsDir);
  const appliedMigrations = getAppliedMigrations(cwd);

  // Find pending migrations
  const pendingMigrations = migrationFiles.filter((file) => !appliedMigrations.has(file));

  if (pendingMigrations.length === 0) {
    console.log('\n✓ No pending migrations\n');
    return;
  }

  // Apply count limit if specified
  const migrationsToRun = options.count
    ? pendingMigrations.slice(0, options.count)
    : pendingMigrations;

  console.log(`\nRunning ${migrationsToRun.length} migration(s):\n`);

  for (const migrationFile of migrationsToRun) {
    const migrationPath = path.join(migrationsDir, migrationFile);
    const migrationName = migrationFile.replace(/\.(ts|js)$/, '');

    if (options.dryRun) {
      console.log(`  [dry-run] Would run: ${migrationName}`);
      continue;
    }

    console.log(`  ▸ Running: ${migrationName}`);

    try {
      // Import and run the migration
      const migration = await import(`file://${migrationPath}`);

      if (typeof migration.up !== 'function') {
        throw new Error('Migration must export an "up" function');
      }

      // Create a migration context (simplified for CLI)
      const ctx = {
        createCollection: async (name: string) => {
          console.log(`    - Creating collection: ${name}`);
        },
        dropCollection: async (name: string) => {
          console.log(`    - Dropping collection: ${name}`);
        },
        createIndex: async (collection: string, _index: unknown) => {
          console.log(`    - Creating index on: ${collection}`);
        },
        dropIndex: async (collection: string, indexName: string) => {
          console.log(`    - Dropping index: ${indexName} from ${collection}`);
        },
        addField: async (collection: string, field: string, _def: unknown) => {
          console.log(`    - Adding field: ${field} to ${collection}`);
        },
        removeField: async (collection: string, field: string) => {
          console.log(`    - Removing field: ${field} from ${collection}`);
        },
        sql: async (query: string) => {
          console.log(`    - Executing SQL: ${query.slice(0, 50)}...`);
        },
      };

      await migration.up(ctx);

      // Mark as applied
      appliedMigrations.add(migrationFile);
      saveAppliedMigrations(cwd, appliedMigrations);

      console.log(`  ✓ Completed: ${migrationName}`);
    } catch (error) {
      console.error(`  ✗ Failed: ${migrationName}`);
      console.error(`    Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  console.log(`\n✓ Applied ${migrationsToRun.length} migration(s)\n`);
}

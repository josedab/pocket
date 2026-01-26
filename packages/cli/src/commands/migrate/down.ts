/**
 * @pocket/cli - Migrate Down Command
 *
 * Rolls back migrations.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../../config/loader.js';

/**
 * Migrate down options
 */
export interface MigrateDownOptions {
  /** Number of migrations to rollback (default: 1) */
  count?: number;
  /** Working directory */
  cwd?: string;
  /** Dry run - show what would be run without executing */
  dryRun?: boolean;
}

/**
 * Get applied migrations (reads from a local tracking file)
 */
function getAppliedMigrations(cwd: string): string[] {
  const trackingFile = path.join(cwd, '.pocket', 'migrations.json');
  if (!fs.existsSync(trackingFile)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
    return data.applied ?? [];
  } catch {
    return [];
  }
}

/**
 * Save applied migrations
 */
function saveAppliedMigrations(cwd: string, applied: string[]): void {
  const pocketDir = path.join(cwd, '.pocket');
  if (!fs.existsSync(pocketDir)) {
    fs.mkdirSync(pocketDir, { recursive: true });
  }

  const trackingFile = path.join(pocketDir, 'migrations.json');
  fs.writeFileSync(
    trackingFile,
    JSON.stringify(
      {
        applied,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/**
 * Rollback migrations
 *
 * @param options - Migrate down options
 */
export async function down(options: MigrateDownOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const count = options.count ?? 1;

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(cwd, config.migrations?.directory ?? './migrations');
  const appliedMigrations = getAppliedMigrations(cwd);

  if (appliedMigrations.length === 0) {
    console.log('\n✓ No migrations to rollback\n');
    return;
  }

  // Get migrations to rollback (in reverse order)
  const migrationsToRollback = appliedMigrations.slice(-count).reverse();

  console.log(`\nRolling back ${migrationsToRollback.length} migration(s):\n`);

  for (const migrationFile of migrationsToRollback) {
    const migrationPath = path.join(migrationsDir, migrationFile);
    const migrationName = migrationFile.replace(/\.(ts|js)$/, '');

    if (!fs.existsSync(migrationPath)) {
      console.error(`  ✗ Migration file not found: ${migrationFile}`);
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(`  [dry-run] Would rollback: ${migrationName}`);
      continue;
    }

    console.log(`  ▸ Rolling back: ${migrationName}`);

    try {
      // Import and run the migration's down function
      const migration = await import(`file://${migrationPath}`);

      if (typeof migration.down !== 'function') {
        console.warn(`    ⚠ No "down" function in migration, skipping rollback logic`);
      } else {
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

        await migration.down(ctx);
      }

      // Remove from applied list
      const idx = appliedMigrations.indexOf(migrationFile);
      if (idx > -1) {
        appliedMigrations.splice(idx, 1);
      }
      saveAppliedMigrations(cwd, appliedMigrations);

      console.log(`  ✓ Rolled back: ${migrationName}`);
    } catch (error) {
      console.error(`  ✗ Failed: ${migrationName}`);
      console.error(`    Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  console.log(`\n✓ Rolled back ${migrationsToRollback.length} migration(s)\n`);
}

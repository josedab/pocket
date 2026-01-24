/**
 * @pocket/cli - Migrate Status Command
 *
 * Shows the current migration status.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../../config/loader.js';

/**
 * Migrate status options
 */
export interface MigrateStatusOptions {
  /** Working directory */
  cwd?: string;
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
 * Get applied migrations with timestamps
 */
function getAppliedMigrationsData(cwd: string): Record<string, string> {
  const trackingFile = path.join(cwd, '.pocket', 'migrations.json');
  if (!fs.existsSync(trackingFile)) {
    return {};
  }

  try {
    const data = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
    const applied = data.applied ?? [];
    const result: Record<string, string> = {};
    for (const file of applied) {
      result[file] = data.updatedAt ?? 'unknown';
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Show migration status
 *
 * @param options - Status options
 */
export async function status(options: MigrateStatusOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(cwd, config.migrations?.directory ?? './migrations');
  const migrationFiles = getMigrationFiles(migrationsDir);
  const appliedMigrations = getAppliedMigrationsData(cwd);

  console.log('\nMigration Status\n');
  console.log(`Migrations directory: ${path.relative(cwd, migrationsDir)}`);
  console.log('─'.repeat(60));

  if (migrationFiles.length === 0) {
    console.log('\nNo migrations found.\n');
    console.log('Create a migration with: pocket migrate create <name>\n');
    return;
  }

  let appliedCount = 0;
  let pendingCount = 0;

  for (const file of migrationFiles) {
    const name = file.replace(/\.(ts|js)$/, '');
    const isApplied = file in appliedMigrations;

    if (isApplied) {
      console.log(`  ✓ ${name} (applied)`);
      appliedCount++;
    } else {
      console.log(`  ○ ${name} (pending)`);
      pendingCount++;
    }
  }

  console.log('─'.repeat(60));
  console.log(
    `\nTotal: ${migrationFiles.length} | Applied: ${appliedCount} | Pending: ${pendingCount}\n`
  );

  if (pendingCount > 0) {
    console.log('Run pending migrations with: pocket migrate up\n');
  }
}

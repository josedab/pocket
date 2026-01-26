/**
 * @pocket/cli - Migrate Create Command
 *
 * Creates a new migration file.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../../config/loader.js';

/**
 * Migration create options
 */
export interface MigrateCreateOptions {
  /** Migration name */
  name: string;
  /** Working directory */
  cwd?: string;
}

/**
 * Migration file template
 */
const MIGRATION_TEMPLATE = `/**
 * Migration: {{name}}
 * Created: {{timestamp}}
 */

import type { MigrationContext } from '@pocket/core';

/**
 * Run the migration
 */
export async function up(ctx: MigrationContext): Promise<void> {
  // Add your migration logic here
  // Examples:
  // await ctx.createCollection('users');
  // await ctx.createIndex('users', { fields: ['email'], unique: true });
  // await ctx.addField('users', 'status', { type: 'string', default: 'active' });
}

/**
 * Rollback the migration
 */
export async function down(ctx: MigrationContext): Promise<void> {
  // Add your rollback logic here
  // Examples:
  // await ctx.dropCollection('users');
  // await ctx.dropIndex('users', 'email');
  // await ctx.removeField('users', 'status');
}
`;

/**
 * Generate a migration filename with timestamp
 */
function generateMigrationFilename(name: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${timestamp}_${safeName}.ts`;
}

/**
 * Create a new migration file
 *
 * @param options - Create options
 */
export async function create(options: MigrateCreateOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Load config to get migrations directory
  const config = await loadProjectConfig(cwd);
  const migrationsDir = config?.migrations?.directory ?? './migrations';
  const fullMigrationsDir = path.resolve(cwd, migrationsDir);

  // Ensure migrations directory exists
  if (!fs.existsSync(fullMigrationsDir)) {
    fs.mkdirSync(fullMigrationsDir, { recursive: true });
    console.log(`Created migrations directory: ${migrationsDir}`);
  }

  // Generate migration file
  const filename = generateMigrationFilename(options.name);
  const filepath = path.join(fullMigrationsDir, filename);

  const content = MIGRATION_TEMPLATE.replace('{{name}}', options.name).replace(
    '{{timestamp}}',
    new Date().toISOString()
  );

  fs.writeFileSync(filepath, content);

  console.log(`\n✓ Created migration: ${path.relative(cwd, filepath)}\n`);
  console.log('Edit the file to add your migration logic, then run:');
  console.log('  pocket migrate up\n');
}

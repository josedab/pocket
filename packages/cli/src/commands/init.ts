/**
 * @pocket/cli - Init Command
 *
 * Initializes a new Pocket project with configuration and migrations.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Init command options
 */
export interface InitOptions {
  /** Project name */
  name?: string;
  /** Working directory */
  cwd?: string;
  /** Skip creating migrations directory */
  skipMigrations?: boolean;
  /** Force overwrite existing files */
  force?: boolean;
}

/**
 * Default pocket.config.ts template
 */
const CONFIG_TEMPLATE = `import { defineConfig } from '@pocket/cli';

export default defineConfig({
  database: {
    name: '{{name}}',
    storage: 'indexeddb',
  },
  collections: {
    // Define your collections here
    // users: {
    //   schema: {
    //     properties: {
    //       name: { type: 'string', required: true },
    //       email: { type: 'string', required: true },
    //       createdAt: { type: 'date', default: 'now' },
    //     }
    //   },
    //   indexes: [
    //     { fields: ['email'], unique: true }
    //   ]
    // }
  },
  migrations: {
    directory: './migrations',
  },
  studio: {
    port: 4983,
  },
});
`;

/**
 * Initialize a new Pocket project
 *
 * @param options - Init options
 */
export async function init(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const name = options.name ?? path.basename(cwd);

  console.log(`\nInitializing Pocket project: ${name}\n`);

  // Create pocket.config.ts
  const configPath = path.join(cwd, 'pocket.config.ts');
  if (fs.existsSync(configPath) && !options.force) {
    console.log('  ⚠ pocket.config.ts already exists (use --force to overwrite)');
  } else {
    const configContent = CONFIG_TEMPLATE.replace('{{name}}', name);
    fs.writeFileSync(configPath, configContent);
    console.log('  ✓ Created pocket.config.ts');
  }

  // Create migrations directory
  if (!options.skipMigrations) {
    const migrationsDir = path.join(cwd, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      console.log('  ⚠ migrations/ directory already exists');
    } else {
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log('  ✓ Created migrations/ directory');

      // Create .gitkeep file
      fs.writeFileSync(path.join(migrationsDir, '.gitkeep'), '');
    }
  }

  console.log(`
Done! Your Pocket project is ready.

Next steps:
  1. Edit pocket.config.ts to define your collections
  2. Run 'pocket migrate create initial' to create your first migration
  3. Run 'pocket migrate up' to apply migrations
  4. Run 'pocket studio' to explore your data
`);
}

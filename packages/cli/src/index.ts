/**
 * @pocket/cli - Programmatic API
 *
 * This package provides the Pocket CLI tool and its programmatic API
 * for project initialization, migrations, data management, and code generation.
 *
 * @example Running CLI commands programmatically
 * ```typescript
 * import { init, migrate, studio, generateTypes } from '@pocket/cli';
 *
 * // Initialize a new project
 * await init({ name: 'my-app' });
 *
 * // Run migrations
 * await migrate.up();
 *
 * // Generate types
 * await generateTypes({ output: './src/pocket.types.ts' });
 * ```
 *
 * @example Using in pocket.config.ts
 * ```typescript
 * import { defineConfig } from '@pocket/cli';
 *
 * export default defineConfig({
 *   database: { name: 'my-app' },
 *   collections: {
 *     users: {
 *       schema: {
 *         properties: {
 *           name: { type: 'string', required: true },
 *           email: { type: 'string', required: true },
 *         }
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * @module @pocket/cli
 */

// Configuration
export { defineConfig } from './config/types.js';
export type {
  CollectionConfig,
  DatabaseConfig,
  IndexDef,
  MigrationConfig,
  PocketConfig,
  SchemaDef,
  SchemaFieldDef,
  StudioConfig,
} from './config/types.js';

export { findConfigFile, loadConfig, loadProjectConfig, validateConfig } from './config/loader.js';

// Commands
export { exportData, type ExportOptions } from './commands/export.js';
export { generateTypes, type GenerateTypesOptions } from './commands/generate/types.js';
export { importData, type ImportOptions } from './commands/import.js';
export { init, type InitOptions } from './commands/init.js';
export { create as migrateCreate, type MigrateCreateOptions } from './commands/migrate/create.js';
export { down as migrateDown, type MigrateDownOptions } from './commands/migrate/down.js';
export { status as migrateStatus, type MigrateStatusOptions } from './commands/migrate/status.js';
export { up as migrateUp, type MigrateUpOptions } from './commands/migrate/up.js';
export { studio, type StudioOptions } from './commands/studio.js';

// Convenience namespace for migrate commands
export const migrate = {
  create: async (name: string) => {
    const { create } = await import('./commands/migrate/create.js');
    return create({ name });
  },
  up: async (count?: number) => {
    const { up } = await import('./commands/migrate/up.js');
    return up({ count });
  },
  down: async (count?: number) => {
    const { down } = await import('./commands/migrate/down.js');
    return down({ count });
  },
  status: async () => {
    const { status } = await import('./commands/migrate/status.js');
    return status();
  },
};

/**
 * @pocket/cli - Configuration Types
 *
 * Type definitions for pocket.config.ts configuration files.
 *
 * @module @pocket/cli/config
 */

/**
 * Schema field definition
 */
export interface SchemaFieldDef {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  default?: unknown;
  ref?: string;
  ttl?: boolean;
}

/**
 * Schema definition
 */
export interface SchemaDef {
  properties: Record<string, SchemaFieldDef>;
}

/**
 * Index definition
 */
export interface IndexDef {
  fields: string[];
  unique?: boolean;
  name?: string;
}

/**
 * Collection configuration
 */
export interface CollectionConfig {
  schema?: SchemaDef;
  indexes?: IndexDef[];
  sync?: boolean;
  ttl?: {
    field: string;
    expireAfterSeconds?: number;
  };
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  name: string;
  storage?: 'indexeddb' | 'memory' | 'sqlite';
}

/**
 * Migration configuration
 */
export interface MigrationConfig {
  directory?: string;
  tableName?: string;
}

/**
 * Studio configuration
 */
export interface StudioConfig {
  port?: number;
  open?: boolean;
}

/**
 * Pocket CLI configuration
 */
export interface PocketConfig {
  database: DatabaseConfig;
  collections?: Record<string, CollectionConfig>;
  migrations?: MigrationConfig;
  studio?: StudioConfig;
}

/**
 * Define a Pocket configuration with type safety
 *
 * @param config - The configuration object
 * @returns The typed configuration
 *
 * @example
 * ```typescript
 * // pocket.config.ts
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
 *       },
 *       indexes: [
 *         { fields: ['email'], unique: true }
 *       ]
 *     }
 *   },
 *   migrations: {
 *     directory: './migrations'
 *   }
 * });
 * ```
 */
export function defineConfig(config: PocketConfig): PocketConfig {
  return config;
}

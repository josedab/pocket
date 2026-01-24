/**
 * @pocket/cli - Configuration Loader
 *
 * Discovers and loads pocket.config.ts configuration files.
 *
 * @module @pocket/cli/config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PocketConfig } from './types.js';

/**
 * Default configuration file names to search for
 */
const CONFIG_FILES = [
  'pocket.config.ts',
  'pocket.config.js',
  'pocket.config.mjs',
  'pocket.config.cjs',
];

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<PocketConfig> = {
  migrations: {
    directory: './migrations',
    tableName: '_pocket_migrations',
  },
  studio: {
    port: 4983,
    open: true,
  },
};

/**
 * Find a configuration file in the current directory or parents
 *
 * @param startDir - Directory to start searching from
 * @returns Path to config file, or null if not found
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    for (const configFile of CONFIG_FILES) {
      const configPath = path.join(currentDir, configFile);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Load configuration from a file
 *
 * @param configPath - Path to the configuration file
 * @returns The loaded configuration
 */
export async function loadConfig(configPath: string): Promise<PocketConfig> {
  // For TypeScript files, we need to use dynamic import with tsx or ts-node
  // For now, we assume the config is pre-compiled or is a .js/.mjs file
  const absolutePath = path.resolve(configPath);
  const fileUrl = `file://${absolutePath}`;

  try {
    // Try to import as ESM
    const module = await import(fileUrl);
    const config = module.default as PocketConfig;

    // Merge with defaults
    return mergeConfig(DEFAULT_CONFIG, config);
  } catch (error) {
    throw new Error(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load configuration from the project root
 *
 * @param cwd - Current working directory
 * @returns The loaded configuration, or null if not found
 */
export async function loadProjectConfig(cwd: string = process.cwd()): Promise<PocketConfig | null> {
  const configPath = findConfigFile(cwd);
  if (!configPath) {
    return null;
  }

  return loadConfig(configPath);
}

/**
 * Merge configuration with defaults
 */
function mergeConfig(defaults: Partial<PocketConfig>, config: PocketConfig): PocketConfig {
  return {
    ...config,
    migrations: {
      ...defaults.migrations,
      ...config.migrations,
    },
    studio: {
      ...defaults.studio,
      ...config.studio,
    },
  };
}

/**
 * Validate configuration
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors
 */
export function validateConfig(config: PocketConfig): string[] {
  const errors: string[] = [];

  if (!config.database) {
    errors.push('database configuration is required');
  } else if (!config.database.name) {
    errors.push('database.name is required');
  }

  if (config.collections) {
    for (const [name, collectionConfig] of Object.entries(config.collections)) {
      if (collectionConfig.schema) {
        if (!collectionConfig.schema.properties) {
          errors.push(`collections.${name}.schema.properties is required`);
        }
      }
      if (collectionConfig.indexes) {
        for (let i = 0; i < collectionConfig.indexes.length; i++) {
          const index = collectionConfig.indexes[i];
          if (!index?.fields || index.fields.length === 0) {
            errors.push(`collections.${name}.indexes[${i}].fields is required`);
          }
        }
      }
    }
  }

  return errors;
}

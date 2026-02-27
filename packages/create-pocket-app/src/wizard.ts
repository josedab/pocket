/**
 * Interactive Post-Scaffold Wizard
 *
 * Generates additional configuration files based on user selections:
 * storage backend, sync server, cloud provider, and schema.
 *
 * @module create-pocket-app/wizard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StorageBackend = 'memory' | 'indexeddb' | 'opfs' | 'sqlite';
export type SyncOption = 'none' | 'websocket' | 'http' | 'peer-to-peer';
export type CloudProvider = 'none' | 'pocket-cloud' | 'self-hosted' | 'cloudflare';

export interface WizardConfig {
  readonly storage: StorageBackend;
  readonly sync: SyncOption;
  readonly cloud: CloudProvider;
  readonly collections: readonly string[];
  readonly auth: boolean;
  readonly encryption: boolean;
}

export interface WizardResult {
  readonly files: readonly { path: string; content: string }[];
  readonly dependencies: Record<string, string>;
  readonly instructions: readonly string[];
}

// ─── Storage Config ───────────────────────────────────────────────────────────

function getStorageDeps(storage: StorageBackend): Record<string, string> {
  switch (storage) {
    case 'memory':
      return { '@pocket/storage-memory': 'latest' };
    case 'indexeddb':
      return { '@pocket/storage-indexeddb': 'latest' };
    case 'opfs':
      return { '@pocket/storage-opfs': 'latest' };
    case 'sqlite':
      return { '@pocket/storage-sqlite': 'latest' };
  }
}

function getStorageImport(storage: StorageBackend): string {
  switch (storage) {
    case 'memory':
      return "import { createMemoryStorage } from '@pocket/storage-memory';";
    case 'indexeddb':
      return "import { createIndexedDBStorage } from '@pocket/storage-indexeddb';";
    case 'opfs':
      return "import { createOPFSStorage } from '@pocket/storage-opfs';";
    case 'sqlite':
      return "import { createSQLiteStorage } from '@pocket/storage-sqlite';";
  }
}

function getStorageFactory(storage: StorageBackend): string {
  switch (storage) {
    case 'memory':
      return 'createMemoryStorage()';
    case 'indexeddb':
      return "createIndexedDBStorage({ name: 'my-app' })";
    case 'opfs':
      return "createOPFSStorage({ name: 'my-app' })";
    case 'sqlite':
      return "createSQLiteStorage({ path: './data.db' })";
  }
}

// ─── Sync Config ──────────────────────────────────────────────────────────────

function getSyncDeps(sync: SyncOption): Record<string, string> {
  if (sync === 'none') return {};
  return { '@pocket/sync': 'latest' };
}

function getSyncConfig(sync: SyncOption): string {
  switch (sync) {
    case 'none':
      return '';
    case 'websocket':
      return `
// Sync configuration
import { createSyncEngine } from '@pocket/sync';

const sync = createSyncEngine({
  url: process.env.VITE_SYNC_URL ?? 'ws://localhost:3001',
  transport: 'websocket',
  autoConnect: true,
  retryOnDisconnect: true,
});
`;
    case 'http':
      return `
// Sync configuration
import { createSyncEngine } from '@pocket/sync';

const sync = createSyncEngine({
  url: process.env.VITE_SYNC_URL ?? 'http://localhost:3001',
  transport: 'http',
  pollIntervalMs: 5000,
});
`;
    case 'peer-to-peer':
      return `
// Sync configuration
import { createSyncEngine } from '@pocket/sync';

const sync = createSyncEngine({
  transport: 'mesh',
  discovery: 'lan',
});
`;
  }
}

// ─── Wizard Runner ────────────────────────────────────────────────────────────

/**
 * Run the post-scaffold wizard to generate config files.
 */
export function runWizard(projectDir: string, config: WizardConfig): WizardResult {
  const files: { path: string; content: string }[] = [];
  const dependencies: Record<string, string> = {};
  const instructions: string[] = [];

  // Storage dependencies
  Object.assign(dependencies, getStorageDeps(config.storage));

  // Sync dependencies
  Object.assign(dependencies, getSyncDeps(config.sync));

  // Auth dependencies
  if (config.auth) {
    dependencies['@pocket/auth'] = 'latest';
  }

  // Encryption dependencies
  if (config.encryption) {
    dependencies['@pocket/encryption'] = 'latest';
  }

  // Cloud dependencies
  if (config.cloud === 'pocket-cloud') {
    dependencies['@pocket/cloud'] = 'latest';
  }

  // Generate pocket.config.ts
  const configContent = generatePocketConfig(config);
  files.push({ path: 'src/pocket.config.ts', content: configContent });

  // Generate database setup file
  const dbSetup = generateDatabaseSetup(config);
  files.push({ path: 'src/db.ts', content: dbSetup });

  // Generate .env file
  const envContent = generateEnvFile(config);
  files.push({ path: '.env.example', content: envContent });

  // Generate schema file if collections specified
  if (config.collections.length > 0) {
    const schemaContent = generateSchemaFile(config.collections);
    files.push({ path: 'pocket.schema.json', content: schemaContent });
    instructions.push('Run `npx pocket generate` to generate types from your schema');
  }

  // Write files
  for (const file of files) {
    const fullPath = path.join(projectDir, file.path);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content);
  }

  if (config.sync !== 'none') {
    instructions.push('Set VITE_SYNC_URL in .env to your sync server');
  }

  if (config.cloud !== 'none') {
    instructions.push('Configure cloud credentials in .env');
  }

  return { files, dependencies, instructions };
}

function generatePocketConfig(config: WizardConfig): string {
  return `/**
 * Pocket Configuration
 * Generated by create-pocket-app wizard
 */

export const pocketConfig = {
  storage: '${config.storage}',
  sync: ${config.sync === 'none' ? 'false' : `'${config.sync}'`},
  auth: ${config.auth},
  encryption: ${config.encryption},
  cloud: ${config.cloud === 'none' ? 'false' : `'${config.cloud}'`},
  collections: ${JSON.stringify(config.collections, null, 4)},
} as const;

export type PocketConfig = typeof pocketConfig;
`;
}

function generateDatabaseSetup(config: WizardConfig): string {
  const lines: string[] = [
    '/**',
    ' * Database Setup',
    ' * Generated by create-pocket-app wizard',
    ' */',
    '',
    "import { Database } from '@pocket/core';",
    getStorageImport(config.storage),
  ];

  if (config.sync !== 'none') {
    lines.push(getSyncConfig(config.sync));
  }

  lines.push('');
  lines.push('export const db = Database.create({');
  lines.push("  name: 'my-pocket-app',");
  lines.push(`  storage: ${getStorageFactory(config.storage)},`);
  if (config.sync !== 'none') {
    lines.push('  sync,');
  }
  lines.push('});');
  lines.push('');
  lines.push('export default db;');

  return lines.join('\n');
}

function generateEnvFile(config: WizardConfig): string {
  const lines: string[] = ['# Pocket Environment Configuration', ''];

  if (config.sync !== 'none') {
    lines.push('# Sync server URL');
    lines.push('VITE_SYNC_URL=http://localhost:3001');
    lines.push('');
  }

  if (config.cloud === 'pocket-cloud') {
    lines.push('# Pocket Cloud');
    lines.push('VITE_POCKET_CLOUD_URL=https://api.pocket-db.dev');
    lines.push('VITE_POCKET_CLOUD_KEY=');
    lines.push('');
  }

  if (config.auth) {
    lines.push('# Authentication');
    lines.push('VITE_AUTH_SECRET=');
    lines.push('');
  }

  return lines.join('\n');
}

function generateSchemaFile(collections: readonly string[]): string {
  const schema = {
    version: '1.0.0',
    collections: collections.map((name) => ({
      name,
      fields: {
        title: { type: 'string', required: true },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    })),
  };

  return JSON.stringify(schema, null, 2) + '\n';
}

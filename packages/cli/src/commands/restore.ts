/**
 * @pocket/cli - Restore Command
 *
 * Restores data from a Pocket backup file.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { loadProjectConfig } from '../config/loader.js';

/**
 * Restore options
 */
export interface RestoreOptions {
  /** Input backup file path */
  file: string;
  /** Collections to restore (default: all in backup) */
  collections?: string[];
  /** Clear existing data before restore */
  clear?: boolean;
  /** Skip confirmation prompt */
  force?: boolean;
  /** Working directory */
  cwd?: string;
  /** Dry run - show what would be restored */
  dryRun?: boolean;
}

/**
 * Backup metadata type
 */
interface BackupMetadata {
  version: string;
  createdAt: string;
  database: string;
  format: string;
  collections: string[];
  totalDocuments: number;
}

/**
 * Collection backup data
 */
interface CollectionBackup {
  name: string;
  documents: unknown[];
  count: number;
}

/**
 * Full backup data structure
 */
interface BackupData {
  meta: BackupMetadata;
  collections: CollectionBackup[];
}

/**
 * NDJSON record type
 */
interface NdjsonRecord {
  type: 'meta' | 'document';
  collection?: string;
  data: unknown;
}

/**
 * Detect backup format from file extension
 */
function detectFormat(filePath: string): 'json' | 'ndjson' | 'sqlite' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ndjson') return 'ndjson';
  if (ext === '.sqlite' || ext === '.sql') return 'sqlite';
  return 'json';
}

/**
 * Read JSON backup file
 */
function readJsonBackup(filePath: string): BackupData {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as BackupData;
}

/**
 * Read NDJSON backup file
 */
function readNdjsonBackup(filePath: string): BackupData {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let meta: BackupMetadata | null = null;
  const collectionsMap = new Map<string, unknown[]>();

  for (const line of lines) {
    const record = JSON.parse(line) as NdjsonRecord;

    if (record.type === 'meta') {
      meta = record.data as BackupMetadata;
    } else if (record.type === 'document' && record.collection) {
      if (!collectionsMap.has(record.collection)) {
        collectionsMap.set(record.collection, []);
      }
      collectionsMap.get(record.collection)!.push(record.data);
    }
  }

  if (!meta) {
    throw new Error('Invalid NDJSON backup: missing metadata');
  }

  const collections: CollectionBackup[] = Array.from(collectionsMap.entries()).map(
    ([name, documents]) => ({
      name,
      documents,
      count: documents.length,
    })
  );

  return { meta, collections };
}

/**
 * Read SQLite dump file (stub)
 */
function readSqliteBackup(filePath: string): BackupData {
  // This would parse SQL INSERT statements to extract data
  // For now, we throw an error
  throw new Error(
    `SQLite restore is not yet supported. ` + `Please use JSON or NDJSON format. File: ${filePath}`
  );
}

/**
 * Save collection data (mock implementation)
 */
function saveCollectionData(
  collectionName: string,
  documents: unknown[],
  cwd: string,
  clear: boolean
): void {
  // In a real implementation, this would write to the actual storage adapter
  // For now, we write to .pocket/data directory
  const dataDir = path.join(cwd, '.pocket', 'data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const collectionFile = path.join(dataDir, `${collectionName}.json`);

  let existingDocs: unknown[] = [];
  if (!clear && fs.existsSync(collectionFile)) {
    try {
      existingDocs = JSON.parse(fs.readFileSync(collectionFile, 'utf-8'));
      if (!Array.isArray(existingDocs)) existingDocs = [];
    } catch {
      existingDocs = [];
    }
  }

  // Merge documents (in reality, would handle conflicts)
  const mergedDocs = clear ? documents : [...existingDocs, ...documents];

  fs.writeFileSync(collectionFile, JSON.stringify(mergedDocs, null, 2), 'utf-8');
}

/**
 * Prompt for confirmation
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Restore data from a backup file
 *
 * @param options - Restore options
 */
export async function restore(options: RestoreOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = path.resolve(cwd, options.file);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Backup file not found: ${options.file}`);
    process.exit(1);
  }

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  // Detect format and read backup
  const format = detectFormat(filePath);
  let backupData: BackupData;

  console.log(`\n\x1b[1mPocket Restore\x1b[0m\n`);
  console.log(`  File:        ${options.file}`);
  console.log(`  Format:      ${format}`);

  try {
    switch (format) {
      case 'ndjson':
        backupData = readNdjsonBackup(filePath);
        break;
      case 'sqlite':
        backupData = readSqliteBackup(filePath);
        break;
      default:
        backupData = readJsonBackup(filePath);
    }
  } catch (error) {
    console.error(
      `Error reading backup: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  // Display backup info
  console.log(`  Source DB:   ${backupData.meta.database}`);
  console.log(`  Created:     ${backupData.meta.createdAt}`);
  console.log(`  Documents:   ${backupData.meta.totalDocuments}`);

  // Determine collections to restore
  const availableCollections = backupData.collections.map((c) => c.name);
  const collectionsToRestore = options.collections?.length
    ? options.collections.filter((c) => availableCollections.includes(c))
    : availableCollections;

  if (collectionsToRestore.length === 0) {
    console.error('\nError: No matching collections found in backup.');
    process.exit(1);
  }

  console.log(`  Collections: ${collectionsToRestore.join(', ')}`);

  if (options.clear) {
    console.log(`\n  \x1b[33mWarning: Existing data will be cleared before restore.\x1b[0m`);
  }

  if (options.dryRun) {
    console.log(`\n  \x1b[33m[DRY RUN] No data will be modified.\x1b[0m`);
  }

  // Confirm restore
  if (!options.force && !options.dryRun) {
    const confirmed = await confirm('\nProceed with restore?');
    if (!confirmed) {
      console.log('\nRestore cancelled.\n');
      process.exit(0);
    }
  }

  // Perform restore
  console.log('\n  Restoring collections:\n');

  let restoredDocs = 0;

  for (const collectionName of collectionsToRestore) {
    const collectionBackup = backupData.collections.find((c) => c.name === collectionName);
    if (!collectionBackup) continue;

    const docCount = collectionBackup.documents.length;

    if (!options.dryRun) {
      saveCollectionData(collectionName, collectionBackup.documents, cwd, options.clear ?? false);
    }

    console.log(`    ${collectionName}: ${docCount} document(s)`);
    restoredDocs += docCount;
  }

  // Summary
  if (options.dryRun) {
    console.log(`\n  \x1b[33m[DRY RUN] Would restore ${restoredDocs} document(s)\x1b[0m\n`);
  } else {
    console.log(
      `\n\x1b[32m  ✓ Restored ${restoredDocs} document(s) to ${collectionsToRestore.length} collection(s)\x1b[0m\n`
    );
  }
}

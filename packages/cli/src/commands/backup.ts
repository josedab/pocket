/**
 * @pocket/cli - Backup Command
 *
 * Creates backups of Pocket database data.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../config/loader.js';

/**
 * Backup options
 */
export interface BackupOptions {
  /** Output file path */
  output?: string;
  /** Backup format: json, ndjson, or sqlite */
  format?: 'json' | 'ndjson' | 'sqlite';
  /** Collections to backup (default: all) */
  collections?: string[];
  /** Include metadata in backup */
  includeMeta?: boolean;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Working directory */
  cwd?: string;
  /** Dry run - show what would be backed up */
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
 * Generate a default backup filename
 */
function generateBackupFilename(dbName: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const extension = format === 'ndjson' ? 'ndjson' : format === 'sqlite' ? 'sqlite' : 'json';
  return `${dbName}-backup-${timestamp}.${extension}`;
}

/**
 * Read mock data for demonstration (would use actual storage in production)
 */
function getMockCollectionData(collectionName: string): unknown[] {
  // In a real implementation, this would read from the actual storage adapter
  // For now, we check if there's a .pocket/data directory with collection files
  const dataDir = path.join(process.cwd(), '.pocket', 'data');
  const collectionFile = path.join(dataDir, `${collectionName}.json`);

  if (fs.existsSync(collectionFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(collectionFile, 'utf-8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Write backup in JSON format
 */
function writeJsonBackup(backup: BackupData, outputPath: string, pretty: boolean): void {
  const content = JSON.stringify(backup, null, pretty ? 2 : undefined);
  fs.writeFileSync(outputPath, content, 'utf-8');
}

/**
 * Write backup in NDJSON format (newline-delimited JSON)
 */
function writeNdjsonBackup(backup: BackupData, outputPath: string): void {
  const lines: string[] = [];

  // First line is metadata
  lines.push(JSON.stringify({ type: 'meta', data: backup.meta }));

  // Each document is a separate line
  for (const collection of backup.collections) {
    for (const doc of collection.documents) {
      lines.push(JSON.stringify({ type: 'document', collection: collection.name, data: doc }));
    }
  }

  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Write backup as SQLite dump (stub - would require better-sqlite3)
 */
function writeSqliteBackup(backup: BackupData, outputPath: string): void {
  // This would generate actual SQLite SQL statements
  // For now, we create a SQL-like dump file

  const lines: string[] = [
    '-- Pocket Database Backup',
    `-- Created: ${backup.meta.createdAt}`,
    `-- Database: ${backup.meta.database}`,
    '',
  ];

  for (const collection of backup.collections) {
    lines.push(`-- Collection: ${collection.name}`);
    lines.push(`-- Documents: ${collection.count}`);
    lines.push(`CREATE TABLE IF NOT EXISTS "${collection.name}" (id TEXT PRIMARY KEY, data JSON);`);

    for (const doc of collection.documents) {
      const docObj = doc as Record<string, unknown>;
      const rawId = docObj._id ?? docObj.id ?? 'unknown';
      const id = typeof rawId === 'string' ? rawId : JSON.stringify(rawId);
      const jsonData = JSON.stringify(doc).replace(/'/g, "''");
      lines.push(`INSERT INTO "${collection.name}" (id, data) VALUES ('${id}', '${jsonData}');`);
    }

    lines.push('');
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}

/**
 * Create a backup of the database
 *
 * @param options - Backup options
 */
export async function backup(options: BackupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const format = options.format ?? 'json';
  const pretty = options.pretty ?? true;
  const includeMeta = options.includeMeta ?? true;

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  const dbName = config.database.name;
  const configCollections = Object.keys(config.collections ?? {});

  // Determine collections to backup
  const collectionsToBackup = options.collections?.length
    ? options.collections.filter((c) => configCollections.includes(c))
    : configCollections;

  if (collectionsToBackup.length === 0) {
    console.error('Error: No collections to backup.');
    process.exit(1);
  }

  // Determine output path
  const outputPath = options.output ?? generateBackupFilename(dbName, format);
  const absoluteOutput = path.resolve(cwd, outputPath);

  console.log(`\n\x1b[1mPocket Backup\x1b[0m\n`);
  console.log(`  Database:    ${dbName}`);
  console.log(`  Format:      ${format}`);
  console.log(`  Collections: ${collectionsToBackup.join(', ')}`);
  console.log(`  Output:      ${outputPath}`);

  if (options.dryRun) {
    console.log('\n  \x1b[33m[DRY RUN] No backup file will be created.\x1b[0m\n');
  }

  // Collect backup data
  const collections: CollectionBackup[] = [];
  let totalDocuments = 0;

  console.log('\n  Backing up collections:\n');

  for (const collectionName of collectionsToBackup) {
    const documents = getMockCollectionData(collectionName);
    collections.push({
      name: collectionName,
      documents,
      count: documents.length,
    });
    totalDocuments += documents.length;

    console.log(`    ${collectionName}: ${documents.length} document(s)`);
  }

  // Create backup object
  const backupData: BackupData = {
    meta: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      database: dbName,
      format,
      collections: collectionsToBackup,
      totalDocuments,
    },
    collections: includeMeta
      ? collections
      : collections.map(({ name, documents }) => ({ name, documents, count: documents.length })),
  };

  // Write backup
  if (!options.dryRun) {
    // Ensure output directory exists
    const outputDir = path.dirname(absoluteOutput);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    switch (format) {
      case 'ndjson':
        writeNdjsonBackup(backupData, absoluteOutput);
        break;
      case 'sqlite':
        writeSqliteBackup(backupData, absoluteOutput);
        break;
      default:
        writeJsonBackup(backupData, absoluteOutput, pretty);
    }

    const stats = fs.statSync(absoluteOutput);
    const sizeKb = (stats.size / 1024).toFixed(2);

    console.log(`\n\x1b[32m  ✓ Backup created: ${outputPath} (${sizeKb} KB)\x1b[0m`);
  }

  console.log(
    `\n  Total: ${totalDocuments} document(s) from ${collectionsToBackup.length} collection(s)\n`
  );
}

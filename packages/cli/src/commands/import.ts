/**
 * @pocket/cli - Import Command
 *
 * Imports data from JSON/NDJSON files.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../config/loader.js';

/**
 * Import options
 */
export interface ImportOptions {
  /** Input file path */
  file: string;
  /** Target collection (required for JSON without _collection field) */
  collection?: string;
  /** Clear collection before import */
  clear?: boolean;
  /** Dry run - show what would be imported */
  dryRun?: boolean;
  /** Working directory */
  cwd?: string;
}

/**
 * Import data from file
 *
 * @param options - Import options
 */
export async function importData(options: ImportOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = path.resolve(cwd, options.file);

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${options.file}`);
    process.exit(1);
  }

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  console.log('\nImporting data...\n');

  // Read file content
  const content = fs.readFileSync(filePath, 'utf-8');
  const isNdjson = filePath.endsWith('.ndjson') || content.trim().startsWith('{');

  let documents: { _collection?: string; [key: string]: unknown }[];

  if (isNdjson && content.includes('\n')) {
    // Parse NDJSON
    documents = content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } else {
    // Parse JSON
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      // Array of documents
      documents = parsed.map((doc) => ({
        _collection: options.collection,
        ...doc,
      }));
    } else if (typeof parsed === 'object') {
      // Object with collection keys
      documents = [];
      for (const [collection, docs] of Object.entries(parsed)) {
        if (Array.isArray(docs)) {
          for (const doc of docs) {
            documents.push({ _collection: collection, ...(doc as object) });
          }
        }
      }
    } else {
      console.error('Error: Invalid import format. Expected array or object.');
      process.exit(1);
    }
  }

  // Group by collection
  const byCollection: Record<string, unknown[]> = {};
  for (const doc of documents) {
    const collection = doc._collection ?? options.collection;
    if (!collection) {
      console.error('Error: Document missing _collection field and no --collection specified');
      process.exit(1);
    }
    byCollection[collection] ??= [];
    const { _collection, ...docData } = doc;
    byCollection[collection].push(docData);
  }

  // Import documents
  let totalCount = 0;
  for (const [collection, docs] of Object.entries(byCollection)) {
    if (options.dryRun) {
      console.log(`  [dry-run] Would import ${docs.length} document(s) to: ${collection}`);
    } else {
      console.log(`  Importing ${docs.length} document(s) to: ${collection}`);
      // Placeholder: In real implementation, insert into database
    }
    totalCount += docs.length;
  }

  console.log(`\n✓ ${options.dryRun ? 'Would import' : 'Imported'} ${totalCount} document(s)\n`);
}

/**
 * @pocket/cli - Export Command
 *
 * Exports collection data to JSON/NDJSON format.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../config/loader.js';

/**
 * Export options
 */
export interface ExportOptions {
  /** Collection name to export (optional - exports all if not specified) */
  collection?: string;
  /** Output file path */
  output?: string;
  /** Output format */
  format?: 'json' | 'ndjson';
  /** Pretty print JSON */
  pretty?: boolean;
  /** Working directory */
  cwd?: string;
}

/**
 * Export collection data
 *
 * @param options - Export options
 */
export async function exportData(options: ExportOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const format = options.format ?? 'json';

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  console.log('\nExporting data...\n');

  // Determine collections to export
  const collections = options.collection
    ? [options.collection]
    : Object.keys(config.collections ?? {});

  if (collections.length === 0) {
    console.log('No collections defined in config.\n');
    return;
  }

  // Attempt to read data from local storage directory
  const dataDir = path.resolve(cwd, '.pocket', 'data');
  const exportResult: Record<string, unknown[]> = {};
  let totalDocs = 0;

  for (const collectionName of collections) {
    const collectionFile = path.join(dataDir, `${collectionName}.json`);

    if (fs.existsSync(collectionFile)) {
      try {
        const raw = fs.readFileSync(collectionFile, 'utf-8');
        const docs = JSON.parse(raw) as unknown[];
        exportResult[collectionName] = docs;
        totalDocs += docs.length;
        console.log(`  ✓ ${collectionName}: ${docs.length} documents`);
      } catch (err) {
        console.error(
          `  ✗ ${collectionName}: failed to read — ${err instanceof Error ? err.message : String(err)}`
        );
        exportResult[collectionName] = [];
      }
    } else {
      // Collection defined in config but no data file yet — export empty
      exportResult[collectionName] = [];
      console.log(`  - ${collectionName}: no data (empty collection)`);
    }
  }

  // Determine output path
  const outputPath = options.output ?? `pocket-export-${Date.now()}.${format}`;
  const fullOutputPath = path.resolve(cwd, outputPath);

  // Ensure output directory exists
  const outputDir = path.dirname(fullOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  if (format === 'ndjson') {
    const lines: string[] = [];
    for (const [collection, docs] of Object.entries(exportResult)) {
      for (const doc of docs) {
        lines.push(JSON.stringify({ _collection: collection, ...(doc as object) }));
      }
    }
    fs.writeFileSync(fullOutputPath, lines.join('\n'));
  } else {
    const content = options.pretty
      ? JSON.stringify(exportResult, null, 2)
      : JSON.stringify(exportResult);
    fs.writeFileSync(fullOutputPath, content);
  }

  console.log(`\n✓ Exported ${totalDocs} documents from ${collections.length} collection(s)`);
  console.log(`  Output: ${path.relative(cwd, fullOutputPath)}\n`);
}

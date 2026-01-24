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

  // This is a placeholder - in a real implementation, we'd connect to the database
  // and export actual data. For now, we show the structure.
  const exportData: Record<string, unknown[]> = {};

  for (const collectionName of collections) {
    console.log(`  Exporting: ${collectionName}`);
    // Placeholder: In real implementation, query the database
    exportData[collectionName] = [];
  }

  // Determine output path
  const outputPath = options.output ?? `pocket-export-${Date.now()}.${format}`;
  const fullOutputPath = path.resolve(cwd, outputPath);

  // Write output
  if (format === 'ndjson') {
    const lines: string[] = [];
    for (const [collection, docs] of Object.entries(exportData)) {
      for (const doc of docs) {
        lines.push(JSON.stringify({ _collection: collection, ...(doc as object) }));
      }
    }
    fs.writeFileSync(fullOutputPath, lines.join('\n'));
  } else {
    const content = options.pretty
      ? JSON.stringify(exportData, null, 2)
      : JSON.stringify(exportData);
    fs.writeFileSync(fullOutputPath, content);
  }

  console.log(`\n✓ Exported to: ${path.relative(cwd, fullOutputPath)}\n`);
}

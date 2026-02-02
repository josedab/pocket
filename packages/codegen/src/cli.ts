/**
 * Pocket Code Generator CLI
 *
 * Usage: pocket-codegen [options]
 *
 * Options:
 *   --schema <path>   Path to schema definition file (default: pocket.schema.json)
 *   --output <path>   Output directory (default: ./src/generated)
 *   --generators <list>  Comma-separated list: types,hooks,crud,validation,migration
 *   --watch           Watch for schema changes
 *   --help            Show help
 *
 * @module @pocket/codegen
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodeGenerator } from './codegen.js';
import { CRUDGenerator } from './generators/crud-generator.js';
import type { PocketSchema } from './types.js';

export interface CLIOptions {
  schemaPath: string;
  outputDir: string;
  generators: string[];
  watch: boolean;
}

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    schemaPath: 'pocket.schema.json',
    outputDir: './src/generated',
    generators: ['types', 'hooks', 'crud', 'validation'],
    watch: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--schema':
        options.schemaPath = args[++i] ?? options.schemaPath;
        break;
      case '--output':
        options.outputDir = args[++i] ?? options.outputDir;
        break;
      case '--generators':
        options.generators = (args[++i] ?? '').split(',').map((g) => g.trim());
        break;
      case '--watch':
        options.watch = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg && !arg.startsWith('-')) {
          options.schemaPath = arg;
        }
    }
  }

  return options;
}

export function printHelp(): void {
  console.log(`
Pocket Code Generator

Usage: pocket-codegen [options]

Options:
  --schema <path>       Path to schema definition file (default: pocket.schema.json)
  --output <path>       Output directory (default: ./src/generated)
  --generators <list>   Comma-separated generators: types,hooks,crud,validation,migration
  --watch               Watch for schema changes and regenerate
  --help                Show this help message

Examples:
  pocket-codegen
  pocket-codegen --schema ./schema.json --output ./src/db
  pocket-codegen --generators types,crud --output ./generated
  `);
}

export async function runCLI(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // Read schema file
  const schemaPath = path.resolve(process.cwd(), options.schemaPath);
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    console.error('Create a pocket.schema.json file or specify --schema <path>');
    process.exit(1);
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  let schemaData: unknown;
  try {
    schemaData = JSON.parse(schemaContent);
  } catch {
    console.error(`Invalid JSON in schema file: ${schemaPath}`);
    process.exit(1);
  }

  // Parse and validate schema
  const generator = new CodeGenerator();
  const schema = generator.parseAndValidate(schemaData as string | PocketSchema);

  // Ensure output directory exists
  const outputDir = path.resolve(process.cwd(), options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // Run generators
  const outputs = generator.generate({
    schema,
    outputDir: options.outputDir,
    generateTypes: options.generators.includes('types'),
    generateHooks: options.generators.includes('hooks'),
    generateValidation: options.generators.includes('validation'),
    generateMigrations: options.generators.includes('migration'),
  });

  // Handle CRUD generator separately since it's new
  if (options.generators.includes('crud')) {
    const crudGenerator = new CRUDGenerator();
    const crudOutput = crudGenerator.generateCRUD(schema.collections);
    outputs.push(...crudOutput);
  }

  // Write output files
  let filesWritten = 0;
  for (const output of outputs) {
    const filePath = path.join(outputDir, output.path);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, output.content, 'utf-8');
    filesWritten++;
    console.log(`  ✓ ${output.path}`);
  }

  console.log(`\n✨ Generated ${filesWritten} file(s) in ${options.outputDir}`);

  // Watch mode
  if (options.watch) {
    console.log(`\n👀 Watching ${options.schemaPath} for changes...`);
    fs.watchFile(schemaPath, { interval: 1000 }, () => {
      console.log('\n🔄 Schema changed, regenerating...');
      void runCLI(args.filter((a) => a !== '--watch'));
    });
  }
}

// CLI entry point
if (typeof process !== 'undefined' && process.argv) {
  const isDirectRun = process.argv[1]?.includes('cli');
  if (isDirectRun) {
    void runCLI(process.argv.slice(2));
  }
}

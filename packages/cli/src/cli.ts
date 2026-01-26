/**
 * @pocket/cli - Command Line Interface
 *
 * The main entry point for the Pocket CLI tool.
 *
 * @module @pocket/cli
 */

import { exportData } from './commands/export.js';
import { generateTypes } from './commands/generate/types.js';
import { importData } from './commands/import.js';
import { init } from './commands/init.js';
import { create as migrateCreate } from './commands/migrate/create.js';
import { down as migrateDown } from './commands/migrate/down.js';
import { status as migrateStatus } from './commands/migrate/status.js';
import { up as migrateUp } from './commands/migrate/up.js';
import { studio } from './commands/studio.js';

/**
 * CLI version
 */
const VERSION = '0.1.0';

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = '';
  let subcommand: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else if (!subcommand && ['migrate', 'generate'].includes(command)) {
      subcommand = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, subcommand, positional, flags };
}

/**
 * Print main help message
 */
function printHelp(): void {
  console.log(`
Pocket CLI - Command-line tools for Pocket database

Usage: pocket <command> [options]

Commands:
  init                    Initialize a new Pocket project
  migrate create <name>   Create a new migration
  migrate up              Run pending migrations
  migrate down [n]        Rollback n migrations (default: 1)
  migrate status          Show migration status
  studio                  Launch data inspection UI
  export [collection]     Export data to JSON/NDJSON
  import <file>           Import data from JSON/NDJSON
  generate types          Generate TypeScript types from schema

Options:
  --help, -h              Show help
  --version, -v           Show version

Examples:
  pocket init                           Create pocket.config.ts
  pocket migrate create add-users       Create a new migration
  pocket migrate up                     Run pending migrations
  pocket migrate down 2                 Rollback last 2 migrations
  pocket studio                         Open data browser
  pocket export users                   Export users collection
  pocket import ./backup.json           Import from file
  pocket generate types                 Generate TypeScript types

For command-specific help:
  pocket <command> --help
`);
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(`pocket v${VERSION}`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle global flags
  if (args.flags.help || args.flags.h) {
    printHelp();
    process.exit(0);
  }

  if (args.flags.version || args.flags.v) {
    printVersion();
    process.exit(0);
  }

  // Handle commands
  try {
    switch (args.command) {
      case 'init':
        await init({
          name: args.positional[0] ?? (args.flags.name as string),
          force: args.flags.force === true,
          skipMigrations: args.flags['skip-migrations'] === true,
        });
        break;

      case 'migrate':
        switch (args.subcommand) {
          case 'create':
            if (!args.positional[0]) {
              console.error('Error: Migration name is required');
              console.error('Usage: pocket migrate create <name>');
              process.exit(1);
            }
            await migrateCreate({ name: args.positional[0] });
            break;

          case 'up':
            await migrateUp({
              count: args.positional[0] ? parseInt(args.positional[0], 10) : undefined,
              dryRun: args.flags['dry-run'] === true,
            });
            break;

          case 'down':
            await migrateDown({
              count: args.positional[0] ? parseInt(args.positional[0], 10) : 1,
              dryRun: args.flags['dry-run'] === true,
            });
            break;

          case 'status':
            await migrateStatus();
            break;

          default:
            console.error(`Unknown migrate command: ${args.subcommand}`);
            console.error('Available commands: create, up, down, status');
            process.exit(1);
        }
        break;

      case 'studio':
        await studio({
          port: args.flags.port ? parseInt(args.flags.port as string, 10) : undefined,
          open: args.flags['no-open'] !== true,
        });
        break;

      case 'export':
        await exportData({
          collection: args.positional[0],
          output: (args.flags.output as string) ?? (args.flags.o as string),
          format: (args.flags.format as 'json' | 'ndjson') ?? 'json',
          pretty: args.flags.pretty === true,
        });
        break;

      case 'import':
        if (!args.positional[0]) {
          console.error('Error: File path is required');
          console.error('Usage: pocket import <file>');
          process.exit(1);
        }
        await importData({
          file: args.positional[0],
          collection: args.flags.collection as string,
          clear: args.flags.clear === true,
          dryRun: args.flags['dry-run'] === true,
        });
        break;

      case 'generate':
        switch (args.subcommand) {
          case 'types':
            await generateTypes({
              output: (args.flags.output as string) ?? (args.flags.o as string),
            });
            break;

          default:
            console.error(`Unknown generate command: ${args.subcommand}`);
            console.error('Available commands: types');
            process.exit(1);
        }
        break;

      case '':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Run "pocket --help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run CLI
void main();

/**
 * @pocket/cli - Command Line Interface
 *
 * The main entry point for the Pocket CLI tool.
 *
 * @module @pocket/cli
 */

import { backup } from './commands/backup.js';
import { createPluginCommand } from './commands/create-plugin.js';
import { doctor } from './commands/doctor.js';
import { exportData } from './commands/export.js';
import {
  functionsDeployCommand,
  functionsInitCommand,
  functionsListCommand,
  functionsRemoveCommand,
} from './commands/functions.js';
import { generateTypes } from './commands/generate/types.js';
import { importData } from './commands/import.js';
import { init } from './commands/init.js';
import { create as migrateCreate } from './commands/migrate/create.js';
import { down as migrateDown } from './commands/migrate/down.js';
import { evolveSchema, formatEvolveResults, type StoredSchema } from './commands/migrate/evolve.js';
import { status as migrateStatus } from './commands/migrate/status.js';
import { up as migrateUp } from './commands/migrate/up.js';
import { restore } from './commands/restore.js';
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
  create-plugin <name>    Scaffold a new Pocket plugin project
  doctor                  Check project health and configuration
  migrate create <name>   Create a new migration
  migrate up              Run pending migrations
  migrate down [n]        Rollback n migrations (default: 1)
  migrate status          Show migration status
  migrate evolve          Detect schema changes and generate migrations
  studio                  Launch data inspection UI
  backup                  Create a backup of your data
  restore <file>          Restore data from a backup
  export [collection]     Export data to JSON/NDJSON
  import <file>           Import data from JSON/NDJSON
  generate types          Generate TypeScript types from schema
  functions:init          Initialize a starter functions config
  functions:deploy <cfg>  Deploy functions from config file
  functions:list <cfg>    List defined functions
  functions:remove <cfg> <name>  Remove a function by name

Options:
  --help, -h              Show help
  --version, -v           Show version

Examples:
  pocket init                           Create pocket.config.ts
  pocket create-plugin my-cache         Scaffold a new plugin project
  pocket doctor                         Check project health
  pocket migrate create add-users       Create a new migration
  pocket migrate up                     Run pending migrations
  pocket migrate down 2                 Rollback last 2 migrations
  pocket studio                         Open data browser (with schema view)
  pocket backup                         Backup all collections to JSON
  pocket backup --format ndjson         Backup in NDJSON format
  pocket restore ./backup.json          Restore from backup
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

      case 'create-plugin':
        if (!args.positional[0]) {
          console.error('Error: Plugin name is required');
          console.error('Usage: pocket create-plugin <name>');
          process.exit(1);
        }
        await createPluginCommand(args.positional[0], args.flags.output as string | undefined);
        break;

      case 'doctor':
        await doctor({
          quiet: args.flags.quiet === true,
        });
        break;

      case 'backup':
        await backup({
          output: (args.flags.output as string) ?? (args.flags.o as string),
          format: args.flags.format as 'json' | 'ndjson' | 'sqlite' | undefined,
          collections: args.positional.length > 0 ? args.positional : undefined,
          pretty: args.flags.pretty !== false,
          dryRun: args.flags['dry-run'] === true,
        });
        break;

      case 'restore':
        if (!args.positional[0]) {
          console.error('Error: Backup file path is required');
          console.error('Usage: pocket restore <file>');
          process.exit(1);
        }
        await restore({
          file: args.positional[0],
          collections: args.positional.slice(1).length > 0 ? args.positional.slice(1) : undefined,
          clear: args.flags.clear === true,
          force: args.flags.force === true,
          dryRun: args.flags['dry-run'] === true,
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

          case 'evolve': {
            const schemaPath = args.flags.schema as string | undefined;
            let currentSchemas: Record<string, StoredSchema> = {};

            if (schemaPath) {
              try {
                const { readFileSync } = await import('node:fs');
                const raw = readFileSync(schemaPath, 'utf-8');
                currentSchemas = JSON.parse(raw) as Record<string, StoredSchema>;
              } catch (e) {
                console.error(
                  `Error reading schema file: ${e instanceof Error ? e.message : String(e)}`
                );
                process.exit(1);
              }
            }

            const results = await evolveSchema(currentSchemas, {
              cwd: args.flags.cwd as string | undefined,
              collection: args.flags.collection as string | undefined,
              dryRun: args.flags['dry-run'] === true,
              allowLossy: args.flags['allow-lossy'] === true,
              outputDir: args.flags.output as string | undefined,
            });
            console.log(formatEvolveResults(results));
            break;
          }

          default:
            console.error(`Unknown migrate command: ${args.subcommand}`);
            console.error('Available commands: create, up, down, status, evolve');
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

      case 'functions:init':
        await functionsInitCommand(args.flags.output as string | undefined);
        break;

      case 'functions:deploy':
        if (!args.positional[0]) {
          console.error('Error: Config file path is required');
          console.error('Usage: pocket functions:deploy <config>');
          process.exit(1);
        }
        await functionsDeployCommand(args.positional[0], args.flags.output as string | undefined);
        break;

      case 'functions:list':
        if (!args.positional[0]) {
          console.error('Error: Config file path is required');
          console.error('Usage: pocket functions:list <config>');
          process.exit(1);
        }
        await functionsListCommand(args.positional[0]);
        break;

      case 'functions:remove':
        if (!args.positional[0] || !args.positional[1]) {
          console.error('Error: Config file path and function name are required');
          console.error('Usage: pocket functions:remove <config> <name>');
          process.exit(1);
        }
        await functionsRemoveCommand(args.positional[0], args.positional[1]);
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

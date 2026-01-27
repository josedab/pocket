/**
 * @pocket/cli - Doctor Command
 *
 * Performs health checks on the Pocket project configuration.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findConfigFile, loadProjectConfig, validateConfig } from '../config/loader.js';

/**
 * Doctor options
 */
export interface DoctorOptions {
  /** Working directory */
  cwd?: string;
  /** Only output issues, no success messages */
  quiet?: boolean;
}

/**
 * Check result type
 */
interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  suggestion?: string;
}

/**
 * Get Node.js version info
 */
function getNodeVersionInfo(): CheckResult {
  const version = process.versions.node;
  const [major] = version.split('.').map(Number);

  if ((major ?? 0) >= 18) {
    return {
      name: 'Node.js Version',
      status: 'pass',
      message: `Node.js v${version} (>=18 required)`,
    };
  } else if ((major ?? 0) >= 16) {
    return {
      name: 'Node.js Version',
      status: 'warn',
      message: `Node.js v${version} - Consider upgrading to v18+`,
      suggestion: 'Pocket works best with Node.js 18 or later for optimal performance.',
    };
  } else {
    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `Node.js v${version} is not supported`,
      suggestion: 'Please upgrade to Node.js 18 or later.',
    };
  }
}

/**
 * Check if pocket.config.ts exists and is valid
 */
async function checkConfig(cwd: string): Promise<CheckResult> {
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return {
      name: 'Configuration',
      status: 'fail',
      message: 'pocket.config.ts not found',
      suggestion: 'Run "pocket init" to create a configuration file.',
    };
  }

  try {
    const config = await loadProjectConfig(cwd);
    if (!config) {
      return {
        name: 'Configuration',
        status: 'fail',
        message: 'Failed to load configuration',
        suggestion: 'Check that your pocket.config.ts exports a valid configuration.',
      };
    }

    const errors = validateConfig(config);
    if (errors.length > 0) {
      return {
        name: 'Configuration',
        status: 'fail',
        message: `Configuration has ${errors.length} error(s): ${errors[0]}`,
        suggestion: 'Fix the configuration errors in pocket.config.ts.',
      };
    }

    return {
      name: 'Configuration',
      status: 'pass',
      message: `Valid configuration at ${path.basename(configPath)}`,
    };
  } catch (error) {
    return {
      name: 'Configuration',
      status: 'fail',
      message: `Error loading config: ${error instanceof Error ? error.message : String(error)}`,
      suggestion: 'Check the syntax of your pocket.config.ts file.',
    };
  }
}

/**
 * Check migrations directory
 */
async function checkMigrations(cwd: string): Promise<CheckResult> {
  const config = await loadProjectConfig(cwd);
  if (!config) {
    return {
      name: 'Migrations',
      status: 'warn',
      message: 'No configuration found',
      suggestion: 'Run "pocket init" first.',
    };
  }

  const migrationsDir = path.resolve(cwd, config.migrations?.directory ?? './migrations');

  if (!fs.existsSync(migrationsDir)) {
    return {
      name: 'Migrations',
      status: 'warn',
      message: 'Migrations directory does not exist',
      suggestion: `Create the migrations directory at ${config.migrations?.directory ?? './migrations'}`,
    };
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

  return {
    name: 'Migrations',
    status: 'pass',
    message: `Found ${files.length} migration file(s) in ${path.basename(migrationsDir)}/`,
  };
}

/**
 * Check migration status (applied vs pending)
 */
async function checkMigrationStatus(cwd: string): Promise<CheckResult> {
  const trackingFile = path.join(cwd, '.pocket', 'migrations.json');

  if (!fs.existsSync(trackingFile)) {
    return {
      name: 'Migration Status',
      status: 'warn',
      message: 'No migrations have been applied yet',
      suggestion: 'Run "pocket migrate up" to apply pending migrations.',
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
    const applied = data.applied ?? [];

    return {
      name: 'Migration Status',
      status: 'pass',
      message: `${applied.length} migration(s) applied`,
    };
  } catch {
    return {
      name: 'Migration Status',
      status: 'warn',
      message: 'Could not read migration status',
      suggestion: 'The .pocket/migrations.json file may be corrupted.',
    };
  }
}

/**
 * Check package versions for mismatches
 */
function checkPackageVersions(cwd: string): CheckResult {
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return {
      name: 'Package Versions',
      status: 'warn',
      message: 'No package.json found',
    };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    const pocketPackages = Object.entries(deps).filter(
      ([name]) => name === 'pocket' || name.startsWith('@pocket/')
    );

    if (pocketPackages.length === 0) {
      return {
        name: 'Package Versions',
        status: 'warn',
        message: 'No Pocket packages found in package.json',
        suggestion: 'Install Pocket with "npm install pocket" or "@pocket/core".',
      };
    }

    // Check for version mismatches
    const versions = new Set(
      pocketPackages
        .map(([, v]) => String(v).replace(/[\^~]/, ''))
        .filter((v) => !v.startsWith('workspace:'))
    );

    if (versions.size > 1) {
      return {
        name: 'Package Versions',
        status: 'warn',
        message: `Multiple Pocket package versions detected: ${[...versions].join(', ')}`,
        suggestion: 'Consider aligning all Pocket packages to the same version.',
      };
    }

    const packageList = pocketPackages.map(([name]) => name).join(', ');
    return {
      name: 'Package Versions',
      status: 'pass',
      message: `${pocketPackages.length} Pocket package(s): ${packageList}`,
    };
  } catch {
    return {
      name: 'Package Versions',
      status: 'warn',
      message: 'Could not parse package.json',
    };
  }
}

/**
 * Check if storage adapters are available
 */
async function checkStorageAdapters(): Promise<CheckResult> {
  const adapters: string[] = [];

  // Check for common storage adapter packages
  const adapterPackages = [
    ['@pocket/storage-indexeddb', 'IndexedDB'],
    ['@pocket/storage-opfs', 'OPFS'],
    ['@pocket/storage-memory', 'Memory'],
    ['@pocket/storage-sqlite', 'SQLite'],
  ];

  for (const [pkg, name] of adapterPackages) {
    try {
      await import(pkg!);
      adapters.push(name!);
    } catch {
      // Package not installed
    }
  }

  // Memory adapter is built into core, so at least that should be available
  if (!adapters.includes('Memory')) {
    adapters.push('Memory (built-in)');
  }

  return {
    name: 'Storage Adapters',
    status: adapters.length > 0 ? 'pass' : 'warn',
    message: `Available adapters: ${adapters.join(', ')}`,
    suggestion:
      adapters.length === 1
        ? 'Consider installing @pocket/storage-indexeddb for browser persistence.'
        : undefined,
  };
}

/**
 * Check TypeScript configuration
 */
function checkTypeScript(cwd: string): CheckResult {
  const tsconfigPath = path.join(cwd, 'tsconfig.json');

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'No tsconfig.json found',
      suggestion: 'TypeScript is recommended for better type safety with Pocket.',
    };
  }

  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    const issues: string[] = [];

    // Check for strict mode
    if (!tsconfig.compilerOptions?.strict) {
      issues.push('strict mode not enabled');
    }

    // Check module resolution
    const moduleRes = tsconfig.compilerOptions?.moduleResolution?.toLowerCase();
    if (moduleRes && !['bundler', 'node', 'node16', 'nodenext'].includes(moduleRes)) {
      issues.push('consider using "bundler" or "node16" moduleResolution');
    }

    if (issues.length > 0) {
      return {
        name: 'TypeScript',
        status: 'warn',
        message: `tsconfig.json issues: ${issues.join(', ')}`,
        suggestion: 'Update your tsconfig.json for optimal Pocket compatibility.',
      };
    }

    return {
      name: 'TypeScript',
      status: 'pass',
      message: 'TypeScript configured correctly',
    };
  } catch {
    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'Could not parse tsconfig.json',
    };
  }
}

/**
 * Format check result for display
 */
function formatResult(result: CheckResult, quiet: boolean): string {
  const icon =
    result.status === 'pass'
      ? '\x1b[32m✓\x1b[0m'
      : result.status === 'warn'
        ? '\x1b[33m⚠\x1b[0m'
        : '\x1b[31m✗\x1b[0m';

  if (quiet && result.status === 'pass') {
    return '';
  }

  let output = `  ${icon} ${result.name}: ${result.message}`;

  if (result.suggestion) {
    output += `\n    \x1b[2m${result.suggestion}\x1b[0m`;
  }

  return output;
}

/**
 * Run health checks on the Pocket project
 *
 * @param options - Doctor options
 */
export async function doctor(options: DoctorOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const quiet = options.quiet ?? false;

  console.log('\n\x1b[1mPocket Doctor\x1b[0m - Checking project health...\n');

  const checks: CheckResult[] = [];

  // Run all checks
  checks.push(getNodeVersionInfo());
  checks.push(await checkConfig(cwd));
  checks.push(await checkMigrations(cwd));
  checks.push(await checkMigrationStatus(cwd));
  checks.push(checkPackageVersions(cwd));
  checks.push(await checkStorageAdapters());
  checks.push(checkTypeScript(cwd));

  // Display results
  for (const result of checks) {
    const formatted = formatResult(result, quiet);
    if (formatted) {
      console.log(formatted);
    }
  }

  // Summary
  const passed = checks.filter((c) => c.status === 'pass').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  const failed = checks.filter((c) => c.status === 'fail').length;

  console.log('\n\x1b[1mSummary:\x1b[0m');
  console.log(
    `  \x1b[32m${passed} passed\x1b[0m, \x1b[33m${warnings} warnings\x1b[0m, \x1b[31m${failed} failed\x1b[0m\n`
  );

  if (failed > 0) {
    console.log('\x1b[31mSome checks failed. Please fix the issues above.\x1b[0m\n');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\x1b[33mAll critical checks passed with some warnings.\x1b[0m\n');
  } else {
    console.log('\x1b[32mAll checks passed! Your Pocket project is healthy.\x1b[0m\n');
  }
}

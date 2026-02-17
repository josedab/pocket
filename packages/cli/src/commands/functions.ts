/**
 * @pocket/cli - Functions Commands
 *
 * CLI commands for managing Pocket Functions: deploy, list, remove, and init.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A function definition in the config file
 */
export interface FunctionDefinition {
  /** Function name */
  name: string;
  /** Target collection */
  collection: string;
  /** Trigger event */
  trigger: string;
  /** Path to handler file */
  handlerFile: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result returned by all functions commands
 */
export interface FunctionsCommandResult {
  action: string;
  success: boolean;
  message: string;
  functions?: FunctionDefinition[];
}

/**
 * Validate that a function definition has all required fields.
 */
function validateDefinition(def: Partial<FunctionDefinition>, index: number): string | null {
  if (!def.name) return `Function at index ${index} is missing required field "name"`;
  if (!def.collection) return `Function "${def.name}" is missing required field "collection"`;
  if (!def.trigger) return `Function "${def.name}" is missing required field "trigger"`;
  return null;
}

/**
 * Read and parse a functions config file.
 */
function readConfig(configPath: string): FunctionDefinition[] {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Functions config must be a JSON array of function definitions');
  }
  return parsed as FunctionDefinition[];
}

/**
 * Deploy functions from a config file by generating a deployment manifest.
 *
 * @param configPath - Path to functions config JSON file
 * @param outputDir - Directory for the generated manifest (defaults to config file directory)
 */
export async function functionsDeployCommand(
  configPath: string,
  outputDir?: string,
): Promise<FunctionsCommandResult> {
  let definitions: FunctionDefinition[];
  try {
    definitions = readConfig(configPath);
  } catch (err) {
    return {
      action: 'deploy',
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Validate every definition
  for (let i = 0; i < definitions.length; i++) {
    const error = validateDefinition(definitions[i]!, i);
    if (error) {
      return { action: 'deploy', success: false, message: error };
    }
  }

  const dir = outputDir ?? path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    version: '1.0.0',
    deployedAt: new Date().toISOString(),
    functions: definitions,
  };

  const manifestPath = path.join(dir, 'functions-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    action: 'deploy',
    success: true,
    message: `Deployed ${definitions.length} function(s) to ${manifestPath}`,
    functions: definitions,
  };
}

/**
 * List all functions defined in a config file.
 *
 * @param configPath - Path to functions config JSON file
 */
export async function functionsListCommand(
  configPath: string,
): Promise<FunctionsCommandResult> {
  let definitions: FunctionDefinition[];
  try {
    definitions = readConfig(configPath);
  } catch (err) {
    return {
      action: 'list',
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    action: 'list',
    success: true,
    message: `Found ${definitions.length} function(s)`,
    functions: definitions,
  };
}

/**
 * Remove a function by name from the config file.
 *
 * @param configPath - Path to functions config JSON file
 * @param functionName - Name of the function to remove
 */
export async function functionsRemoveCommand(
  configPath: string,
  functionName: string,
): Promise<FunctionsCommandResult> {
  let definitions: FunctionDefinition[];
  try {
    definitions = readConfig(configPath);
  } catch (err) {
    return {
      action: 'remove',
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const filtered = definitions.filter((d) => d.name !== functionName);
  if (filtered.length === definitions.length) {
    return {
      action: 'remove',
      success: false,
      message: `Function "${functionName}" not found`,
    };
  }

  fs.writeFileSync(configPath, JSON.stringify(filtered, null, 2));

  return {
    action: 'remove',
    success: true,
    message: `Removed function "${functionName}"`,
    functions: filtered,
  };
}

/**
 * Initialize a starter functions config and sample handler file.
 *
 * @param outputPath - Directory for generated files (defaults to cwd)
 */
export async function functionsInitCommand(
  outputPath?: string,
): Promise<FunctionsCommandResult> {
  const dir = outputPath ?? process.cwd();
  fs.mkdirSync(dir, { recursive: true });

  const configFile = path.join(dir, 'pocket-functions.json');
  const handlerFile = path.join(dir, 'onUserInsert.ts');

  const exampleDef: FunctionDefinition[] = [
    {
      name: 'onUserInsert',
      collection: 'users',
      trigger: 'afterInsert',
      handlerFile: './onUserInsert.ts',
      timeout: 5000,
    },
  ];

  fs.writeFileSync(configFile, JSON.stringify(exampleDef, null, 2));

  const handlerContent = `/**
 * Sample Pocket Function handler
 */
export default async function onUserInsert(ctx: { collection: string; documentId: string }) {
  console.log(\`New document in \${ctx.collection}: \${ctx.documentId}\`);
}
`;
  fs.writeFileSync(handlerFile, handlerContent);

  return {
    action: 'init',
    success: true,
    message: `Created ${configFile} and ${handlerFile}`,
    functions: exampleDef,
  };
}

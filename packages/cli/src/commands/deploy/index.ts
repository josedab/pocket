/**
 * @pocket/cli - Enhanced Deploy Command
 *
 * Orchestrates the deployment workflow: detect framework, generate
 * platform-specific configuration, and provide deployment instructions.
 *
 * @module @pocket/cli/commands/deploy
 *
 * @example Deploy to Cloudflare Workers
 * ```typescript
 * import { deploy } from '@pocket/cli';
 *
 * const result = await deploy({
 *   target: 'cloudflare',
 *   projectName: 'my-app',
 * });
 *
 * for (const file of result.files) {
 *   console.log(`Generated: ${file.path}`);
 * }
 * console.log('Next steps:', result.nextSteps);
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateDeployConfig } from './config-generator.js';
import type {
  DeployTarget,
  ConfigGeneratorOptions,
  GeneratedFile,
  ConfigGeneratorResult,
} from './config-generator.js';

/**
 * Detected project framework.
 */
export type FrameworkType = 'nextjs' | 'remix' | 'sveltekit' | 'astro' | 'plain';

/**
 * Options for the enhanced deploy command.
 */
export interface EnhancedDeployOptions {
  /** Target deployment platform */
  target: DeployTarget;
  /** Project name */
  projectName?: string;
  /** Output directory for generated files */
  outputDir?: string;
  /** Working directory for framework detection */
  cwd?: string;
  /** Environment variables to inject */
  envVars?: Record<string, string>;
  /** Server port (for Fly.io and Deno) */
  port?: number;
  /** Enable dry-run mode (preview only, don't write files) */
  dryRun?: boolean;
  /** Skip framework auto-detection */
  skipDetection?: boolean;
  /** Cloudflare: enable Durable Objects */
  durableObjects?: boolean;
  /** Cloudflare: KV namespace bindings */
  kvNamespaces?: string[];
}

/**
 * Result of the enhanced deploy command.
 */
export interface EnhancedDeployResult {
  /** Detected framework */
  framework: FrameworkType;
  /** Deployment target */
  target: DeployTarget;
  /** Project name used */
  projectName: string;
  /** Generated files (with content) */
  files: GeneratedFile[];
  /** Files that were written to disk (empty in dry-run) */
  writtenFiles: string[];
  /** Deployment instructions */
  instructions: string[];
  /** Next steps for the developer */
  nextSteps: string[];
  /** Required CLI tools */
  requiredTools: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Detect the project framework by inspecting package.json dependencies.
 *
 * @param cwd - Working directory to check
 * @returns Detected framework type
 */
export function detectFramework(cwd: string): FrameworkType {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return 'plain';
  }

  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };

    if (deps.next) return 'nextjs';
    if (deps['@remix-run/node'] || deps['@remix-run/react']) return 'remix';
    if (deps['@sveltejs/kit']) return 'sveltekit';
    if (deps.astro) return 'astro';
  } catch {
    // Ignore parse errors
  }

  return 'plain';
}

/**
 * Get framework-specific deployment notes.
 */
function getFrameworkNotes(framework: FrameworkType, target: DeployTarget): string[] {
  const notes: string[] = [];

  switch (framework) {
    case 'nextjs':
      notes.push('Next.js detected — ensure your API routes are compatible with edge runtime.');
      if (target === 'cloudflare') {
        notes.push('Consider using @cloudflare/next-on-pages for full Next.js support.');
      }
      if (target === 'vercel') {
        notes.push('Vercel has native Next.js support — edge functions will work out of the box.');
      }
      break;

    case 'remix':
      notes.push('Remix detected — the generated entry point supplements your Remix server.');
      if (target === 'cloudflare') {
        notes.push('Use the @remix-run/cloudflare adapter for Remix on Cloudflare Workers.');
      }
      break;

    case 'sveltekit':
      notes.push('SvelteKit detected — use the appropriate SvelteKit adapter for your target.');
      if (target === 'cloudflare') {
        notes.push('Install @sveltejs/adapter-cloudflare for Workers support.');
      }
      if (target === 'vercel') {
        notes.push('Install @sveltejs/adapter-vercel for Vercel support.');
      }
      break;

    case 'astro':
      notes.push('Astro detected — enable SSR mode and use the appropriate output adapter.');
      if (target === 'cloudflare') {
        notes.push('Install @astrojs/cloudflare for Workers support.');
      }
      if (target === 'vercel') {
        notes.push('Install @astrojs/vercel for Vercel support.');
      }
      if (target === 'deno') {
        notes.push('Install @astrojs/deno for Deno Deploy support.');
      }
      break;

    case 'plain':
      notes.push('No framework detected — generating a standalone sync server entry point.');
      break;
  }

  return notes;
}

/**
 * Run the enhanced deploy workflow.
 *
 * Detects the project framework, generates platform-specific
 * configuration and entry point files, and optionally writes them to disk.
 *
 * @param options - Deploy options
 * @returns Deploy result with generated files and instructions
 *
 * @example Dry-run to preview generated files
 * ```typescript
 * const result = await deploy({
 *   target: 'fly',
 *   dryRun: true,
 * });
 *
 * for (const file of result.files) {
 *   console.log(`Would generate: ${file.path}`);
 *   console.log(file.content);
 * }
 * ```
 */
export async function deploy(options: EnhancedDeployOptions): Promise<EnhancedDeployResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const projectName = options.projectName ?? path.basename(cwd);
  const outputDir = options.outputDir ?? cwd;

  // Step 1: Detect framework
  const framework = options.skipDetection ? 'plain' : detectFramework(cwd);

  // Step 2: Generate config
  const generatorOptions: ConfigGeneratorOptions = {
    target: options.target,
    projectName,
    outputDir,
    envVars: options.envVars,
    port: options.port,
    durableObjects: options.durableObjects,
    kvNamespaces: options.kvNamespaces,
  };

  const configResult: ConfigGeneratorResult = generateDeployConfig(generatorOptions);

  // Step 3: Write files (unless dry-run)
  const writtenFiles: string[] = [];

  if (!dryRun) {
    for (const file of configResult.files) {
      const filePath = path.isAbsolute(file.path)
        ? file.path
        : path.resolve(outputDir, file.path);
      const dir = path.dirname(filePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, file.content, 'utf-8');
      writtenFiles.push(filePath);
    }
  }

  // Step 4: Build next steps
  const frameworkNotes = getFrameworkNotes(framework, options.target);

  const nextSteps = [
    ...frameworkNotes,
    ...configResult.instructions,
    'Run your deployment command to go live!',
  ];

  return {
    framework,
    target: options.target,
    projectName,
    files: configResult.files,
    writtenFiles,
    instructions: configResult.instructions,
    nextSteps,
    requiredTools: configResult.requiredTools,
    dryRun,
  };
}

// Re-export all submodules
export {
  generateDeployConfig,
  type DeployTarget,
  type ConfigGeneratorOptions,
  type GeneratedFile,
  type ConfigGeneratorResult,
} from './config-generator.js';

export {
  createPreview,
  listPreviews,
  getPreview,
  deletePreview,
  cleanupPreviews,
  comparePreviews,
  type PreviewOptions,
  type PreviewDeployment,
  type PreviewComparison,
  type PreviewDiff,
} from './preview.js';

export {
  recordDeployment,
  getDeploymentHistory,
  rollback,
  clearDeploymentHistory,
  type RecordDeploymentOptions,
  type DeploymentRecord,
  type RollbackOptions,
  type RollbackResult,
  type DeploymentDiff,
} from './rollback.js';

/**
 * CLI command handlers for plugin marketplace operations.
 */

import { createPluginRegistry } from './registry.js';
import type { MarketplacePluginCategory } from './types.js';

export interface CLIContext {
  registryUrl: string;
  authToken?: string;
  cwd: string;
}

export interface CLICommandResult {
  success: boolean;
  output: string;
  exitCode: number;
}

function createResult(success: boolean, output: string): CLICommandResult {
  return { success, output, exitCode: success ? 0 : 1 };
}

/**
 * Search the plugin registry.
 */
export async function pluginSearchCommand(
  ctx: CLIContext,
  query: string,
  options?: { category?: string; limit?: number },
): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    const result = await registry.search({
      query,
      category: options?.category as MarketplacePluginCategory | undefined,
      pageSize: options?.limit ?? 20,
    });

    if (result.plugins.length === 0) {
      return createResult(true, `No plugins found for "${query}".`);
    }

    const lines = [`Found ${result.total} plugin(s) for "${query}":\n`];
    for (const p of result.plugins) {
      const verified = p.verified ? ' ✓' : '';
      lines.push(`  ${p.name}@${p.version}${verified} — ${p.description}`);
      lines.push(`    downloads: ${p.downloads}  rating: ${p.rating.average.toFixed(1)}  category: ${p.category}`);
    }
    return createResult(true, lines.join('\n'));
  } catch (err) {
    return createResult(false, `Search failed: ${(err as Error).message}`);
  }
}

/**
 * Install a plugin from the registry.
 */
export async function pluginInstallCommand(
  ctx: CLIContext,
  name: string,
  version?: string,
): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    const result = await registry.install(name, version);

    const lines = [`Installed ${result.name}@${result.version} in ${result.duration}ms`];
    if (result.dependencies.length > 0) {
      lines.push(`  dependencies: ${result.dependencies.join(', ')}`);
    }
    if (result.warnings.length > 0) {
      lines.push(`  warnings:\n${result.warnings.map((w) => `    ⚠ ${w}`).join('\n')}`);
    }
    return createResult(result.success, lines.join('\n'));
  } catch (err) {
    return createResult(false, `Install failed: ${(err as Error).message}`);
  }
}

/**
 * Uninstall a plugin.
 */
export async function pluginUninstallCommand(
  ctx: CLIContext,
  name: string,
): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    await registry.uninstall(name);
    return createResult(true, `Uninstalled ${name}`);
  } catch (err) {
    return createResult(false, `Uninstall failed: ${(err as Error).message}`);
  }
}

/**
 * Publish the plugin in the current working directory.
 */
export async function pluginPublishCommand(
  ctx: CLIContext,
  options?: { dryRun?: boolean; tag?: string },
): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    const result = await registry.publish(
      { name: '', version: '', description: '', author: '', category: 'other', pocketVersion: '>=0.1.0' },
      { access: 'public', dryRun: options?.dryRun, tag: options?.tag },
    );
    return createResult(true, `Published ${result.version} → ${result.url}`);
  } catch (err) {
    return createResult(false, `Publish failed: ${(err as Error).message}`);
  }
}

/**
 * List installed plugins.
 */
export async function pluginListCommand(ctx: CLIContext): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    const installed = await registry.listInstalled();

    if (installed.length === 0) {
      return createResult(true, 'No plugins installed.');
    }

    const lines = [`Installed plugins (${installed.length}):\n`];
    for (const p of installed) {
      const status = p.enabled ? 'enabled' : 'disabled';
      lines.push(`  ${p.name}@${p.version} [${status}]`);
    }
    return createResult(true, lines.join('\n'));
  } catch (err) {
    return createResult(false, `List failed: ${(err as Error).message}`);
  }
}

/**
 * Show detailed info about a plugin.
 */
export async function pluginInfoCommand(
  ctx: CLIContext,
  name: string,
): Promise<CLICommandResult> {
  try {
    const registry = createPluginRegistry({ registryUrl: ctx.registryUrl, authToken: ctx.authToken });
    const plugin = await registry.getPlugin(name);

    if (!plugin) {
      return createResult(false, `Plugin "${name}" not found.`);
    }

    const lines = [
      `${plugin.displayName} (${plugin.name})`,
      `  version: ${plugin.version}`,
      `  author: ${plugin.author.name}`,
      `  license: ${plugin.license}`,
      `  category: ${plugin.category}`,
      `  downloads: ${plugin.downloads}`,
      `  rating: ${plugin.rating.average.toFixed(1)} (${plugin.rating.count} reviews)`,
      `  verified: ${plugin.verified ? 'yes' : 'no'}`,
      `  deprecated: ${plugin.deprecated ? 'yes' : 'no'}`,
      `  description: ${plugin.description}`,
    ];

    if (plugin.keywords.length > 0) {
      lines.push(`  keywords: ${plugin.keywords.join(', ')}`);
    }
    if (plugin.repository) {
      lines.push(`  repository: ${plugin.repository}`);
    }

    lines.push(`  versions: ${plugin.versions.map((v) => v.version).join(', ')}`);
    lines.push(`  compatibility: pocket-core ${plugin.compatibility.pocketCore}`);

    return createResult(true, lines.join('\n'));
  } catch (err) {
    return createResult(false, `Info failed: ${(err as Error).message}`);
  }
}

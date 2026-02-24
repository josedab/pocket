/**
 * PluginInstaller — Install, update, and manage Pocket plugins.
 *
 * Provides a programmatic API for plugin lifecycle management including
 * resolution, installation, version checking, and dependency management.
 * Works as the engine behind `pocket plugin install <name>`.
 *
 * @example
 * ```typescript
 * import { PluginInstaller } from '@pocket/plugin-sdk';
 *
 * const installer = new PluginInstaller({
 *   pluginsDir: './pocket-plugins',
 *   registryUrl: 'https://plugins.pocket-db.dev',
 * });
 *
 * // Install a plugin
 * const result = await installer.install('pocket-plugin-analytics');
 * console.log(result.installed, result.version);
 *
 * // List installed plugins
 * const plugins = installer.listInstalled();
 *
 * // Check for updates
 * const updates = await installer.checkUpdates();
 *
 * // Uninstall
 * await installer.uninstall('pocket-plugin-analytics');
 * ```
 */

import { Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface PluginInstallerConfig {
  /** Directory for installed plugins (default: './pocket-plugins') */
  pluginsDir?: string;
  /** Plugin registry URL */
  registryUrl?: string;
  /** Auto-resolve dependencies (default: true) */
  autoResolveDeps?: boolean;
  /** Pocket core version for compatibility checking */
  pocketVersion?: string;
}

export interface ManagedPlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  installedAt: number;
  updatedAt: number;
  enabled: boolean;
  dependencies: string[];
  pocketVersionRange: string;
}

export interface InstallResult {
  name: string;
  version: string;
  installed: boolean;
  alreadyInstalled: boolean;
  dependenciesInstalled: string[];
  error?: string;
}

export interface UpdateCheckResult {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  breaking: boolean;
}

export interface UninstallResult {
  name: string;
  uninstalled: boolean;
  dependentsWarning: string[];
  error?: string;
}

export type PluginInstallerEvent =
  | { type: 'install:start'; name: string }
  | { type: 'install:complete'; result: InstallResult }
  | { type: 'install:error'; name: string; error: string }
  | { type: 'uninstall:complete'; result: UninstallResult }
  | { type: 'update:available'; updates: UpdateCheckResult[] };

// ── Implementation ────────────────────────────────────────

export class PluginInstaller {
  private readonly config: Required<PluginInstallerConfig>;
  private readonly installed = new Map<string, ManagedPlugin>();
  private readonly eventsSubject = new Subject<PluginInstallerEvent>();

  readonly events$: Observable<PluginInstallerEvent> = this.eventsSubject.asObservable();

  constructor(config: PluginInstallerConfig = {}) {
    this.config = {
      pluginsDir: config.pluginsDir ?? './pocket-plugins',
      registryUrl: config.registryUrl ?? 'https://plugins.pocket-db.dev',
      autoResolveDeps: config.autoResolveDeps ?? true,
      pocketVersion: config.pocketVersion ?? '0.1.0',
    };
  }

  /**
   * Install a plugin by name.
   */
  async install(name: string, version?: string): Promise<InstallResult> {
    this.eventsSubject.next({ type: 'install:start', name });

    // Check if already installed
    const existing = this.installed.get(name);
    if (existing && (!version || existing.version === version)) {
      const result: InstallResult = {
        name,
        version: existing.version,
        installed: false,
        alreadyInstalled: true,
        dependenciesInstalled: [],
      };
      this.eventsSubject.next({ type: 'install:complete', result });
      return result;
    }

    try {
      // Resolve plugin metadata (simulated)
      const resolved = await this.resolvePlugin(name, version);

      // Check compatibility
      this.checkCompatibility(resolved.pocketVersionRange);

      // Install dependencies first
      const depsInstalled: string[] = [];
      if (this.config.autoResolveDeps && resolved.dependencies.length > 0) {
        for (const dep of resolved.dependencies) {
          if (!this.installed.has(dep)) {
            const depResult = await this.install(dep);
            if (depResult.installed) {
              depsInstalled.push(dep);
            }
          }
        }
      }

      // "Install" the plugin
      this.installed.set(name, {
        ...resolved,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        enabled: true,
      });

      const result: InstallResult = {
        name,
        version: resolved.version,
        installed: true,
        alreadyInstalled: false,
        dependenciesInstalled: depsInstalled,
      };

      this.eventsSubject.next({ type: 'install:complete', result });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.eventsSubject.next({ type: 'install:error', name, error: errorMsg });
      return {
        name,
        version: version ?? 'unknown',
        installed: false,
        alreadyInstalled: false,
        dependenciesInstalled: [],
        error: errorMsg,
      };
    }
  }

  /**
   * Uninstall a plugin by name.
   */
  async uninstall(name: string): Promise<UninstallResult> {
    const plugin = this.installed.get(name);
    if (!plugin) {
      return {
        name,
        uninstalled: false,
        dependentsWarning: [],
        error: `Plugin "${name}" is not installed`,
      };
    }

    // Check if other plugins depend on this one
    const dependents = this.findDependents(name);

    this.installed.delete(name);

    const result: UninstallResult = {
      name,
      uninstalled: true,
      dependentsWarning: dependents,
    };

    this.eventsSubject.next({ type: 'uninstall:complete', result });
    return result;
  }

  /**
   * List all installed plugins.
   */
  listInstalled(): ManagedPlugin[] {
    return [...this.installed.values()];
  }

  /**
   * Get an installed plugin by name.
   */
  getInstalled(name: string): ManagedPlugin | undefined {
    return this.installed.get(name);
  }

  /**
   * Enable or disable an installed plugin.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const plugin = this.installed.get(name);
    if (!plugin) return false;
    plugin.enabled = enabled;
    return true;
  }

  /**
   * Check for available updates.
   */
  async checkUpdates(): Promise<UpdateCheckResult[]> {
    const results: UpdateCheckResult[] = [];

    for (const [name, plugin] of this.installed) {
      const latest = await this.resolveLatestVersion(name);
      const updateAvailable = latest !== plugin.version;
      const breaking = updateAvailable && this.isMajorUpdate(plugin.version, latest);

      results.push({
        name,
        currentVersion: plugin.version,
        latestVersion: latest,
        updateAvailable,
        breaking,
      });
    }

    const available = results.filter((r) => r.updateAvailable);
    if (available.length > 0) {
      this.eventsSubject.next({ type: 'update:available', updates: available });
    }

    return results;
  }

  /**
   * Update a plugin to the latest version.
   */
  async update(name: string): Promise<InstallResult> {
    // Uninstall then reinstall
    await this.uninstall(name);
    return this.install(name);
  }

  /**
   * Destroy the installer and release resources.
   */
  destroy(): void {
    this.eventsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private async resolvePlugin(name: string, version?: string): Promise<ManagedPlugin> {
    // In production, this would fetch from the registry
    return {
      name,
      version: version ?? '1.0.0',
      description: `Plugin: ${name}`,
      author: 'community',
      installedAt: 0,
      updatedAt: 0,
      enabled: true,
      dependencies: [],
      pocketVersionRange: '>=0.1.0',
    };
  }

  private async resolveLatestVersion(name: string): Promise<string> {
    // Simulated: in production, queries the registry
    const installed = this.installed.get(name);
    return installed?.version ?? '1.0.0';
  }

  private checkCompatibility(versionRange: string): void {
    // Basic semver range check (simplified)
    const match = />=(\d+\.\d+\.\d+)/.exec(versionRange);
    if (match) {
      const required = match[1]!;
      if (this.compareVersions(this.config.pocketVersion, required) < 0) {
        throw new Error(
          `Plugin requires Pocket ${versionRange}, but current version is ${this.config.pocketVersion}`
        );
      }
    }
  }

  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  private isMajorUpdate(current: string, latest: string): boolean {
    const currentMajor = parseInt(current.split('.')[0] ?? '0', 10);
    const latestMajor = parseInt(latest.split('.')[0] ?? '0', 10);
    return latestMajor > currentMajor;
  }

  private findDependents(name: string): string[] {
    const dependents: string[] = [];
    for (const [pluginName, plugin] of this.installed) {
      if (plugin.dependencies.includes(name)) {
        dependents.push(pluginName);
      }
    }
    return dependents;
  }
}

/**
 * Create a PluginInstaller instance.
 */
export function createPluginInstaller(config?: PluginInstallerConfig): PluginInstaller {
  return new PluginInstaller(config);
}

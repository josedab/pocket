/**
 * Plugin Lifecycle Manager — manages plugin installation, activation, and teardown.
 *
 * @module @pocket/plugin-sdk/lifecycle-manager
 */

import { BehaviorSubject, type Observable } from 'rxjs';

export type PluginStatus = 'registered' | 'initializing' | 'active' | 'inactive' | 'error' | 'uninstalled';

export interface PluginInstance {
  id: string;
  name: string;
  version: string;
  status: PluginStatus;
  config: Record<string, unknown>;
  installedAt: number;
  activatedAt: number | null;
  error: string | null;
}

export interface PluginLifecycleHooks {
  onInstall?: (config: Record<string, unknown>) => Promise<void> | void;
  onActivate?: () => Promise<void> | void;
  onDeactivate?: () => Promise<void> | void;
  onUninstall?: () => Promise<void> | void;
  onConfigChange?: (newConfig: Record<string, unknown>) => Promise<void> | void;
}

export interface PluginRegistration {
  id: string;
  name: string;
  version: string;
  hooks?: PluginLifecycleHooks;
  config?: Record<string, unknown>;
}

/**
 * Manages the full lifecycle of plugins: install → activate → deactivate → uninstall.
 *
 * Exposes a reactive `status$` observable that emits the current list of plugins
 * whenever a change occurs.
 */
export class PluginLifecycleManager {
  private readonly plugins = new Map<string, PluginInstance>();
  private readonly hooks = new Map<string, PluginLifecycleHooks>();
  private readonly statusSubject = new BehaviorSubject<PluginInstance[]>([]);

  /** Reactive stream of all plugin instances. */
  readonly status$: Observable<PluginInstance[]> = this.statusSubject.asObservable();

  /**
   * Install and register a plugin.
   */
  async install(registration: PluginRegistration): Promise<PluginInstance> {
    if (this.plugins.has(registration.id)) {
      throw new Error(`Plugin "${registration.id}" is already installed`);
    }

    const instance: PluginInstance = {
      id: registration.id,
      name: registration.name,
      version: registration.version,
      status: 'registered',
      config: registration.config ?? {},
      installedAt: Date.now(),
      activatedAt: null,
      error: null,
    };

    this.plugins.set(registration.id, instance);
    if (registration.hooks) {
      this.hooks.set(registration.id, registration.hooks);
    }

    try {
      instance.status = 'initializing';
      this.emit();
      await registration.hooks?.onInstall?.(instance.config);
      instance.status = 'inactive';
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
    }

    this.emit();
    return { ...instance };
  }

  /**
   * Activate an installed plugin.
   */
  async activate(pluginId: string): Promise<void> {
    const instance = this.requirePlugin(pluginId);

    if (instance.status === 'active') {
      return;
    }

    try {
      await this.hooks.get(pluginId)?.onActivate?.();
      instance.status = 'active';
      instance.activatedAt = Date.now();
      instance.error = null;
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
    }

    this.emit();
  }

  /**
   * Deactivate an active plugin.
   */
  async deactivate(pluginId: string): Promise<void> {
    const instance = this.requirePlugin(pluginId);

    if (instance.status === 'inactive') {
      return;
    }

    try {
      await this.hooks.get(pluginId)?.onDeactivate?.();
      instance.status = 'inactive';
      instance.error = null;
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
    }

    this.emit();
  }

  /**
   * Uninstall a plugin, calling its onUninstall hook and removing it.
   */
  async uninstall(pluginId: string): Promise<void> {
    const instance = this.requirePlugin(pluginId);

    try {
      if (instance.status === 'active') {
        await this.hooks.get(pluginId)?.onDeactivate?.();
      }
      await this.hooks.get(pluginId)?.onUninstall?.();
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      this.emit();
      return;
    }

    instance.status = 'uninstalled';
    this.plugins.delete(pluginId);
    this.hooks.delete(pluginId);
    this.emit();
  }

  /**
   * Update the configuration for an installed plugin.
   */
  async updateConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    const instance = this.requirePlugin(pluginId);

    try {
      await this.hooks.get(pluginId)?.onConfigChange?.(config);
      instance.config = config;
      instance.error = null;
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
    }

    this.emit();
  }

  /**
   * Get a plugin instance by ID, or null if not installed.
   */
  getPlugin(pluginId: string): PluginInstance | null {
    const instance = this.plugins.get(pluginId);
    return instance ? { ...instance } : null;
  }

  /**
   * Get all plugins, optionally filtered by status.
   */
  getPlugins(status?: PluginStatus): PluginInstance[] {
    const all = Array.from(this.plugins.values()).map((p) => ({ ...p }));
    if (status) {
      return all.filter((p) => p.status === status);
    }
    return all;
  }

  /**
   * Get all active plugins.
   */
  getActivePlugins(): PluginInstance[] {
    return this.getPlugins('active');
  }

  /**
   * Check whether a plugin is installed.
   */
  isInstalled(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Tear down the lifecycle manager and complete the status observable.
   */
  destroy(): void {
    this.statusSubject.complete();
  }

  private requirePlugin(pluginId: string): PluginInstance {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }
    return instance;
  }

  private emit(): void {
    this.statusSubject.next(
      Array.from(this.plugins.values()).map((p) => ({ ...p })),
    );
  }
}

/**
 * Create a new PluginLifecycleManager instance.
 */
export function createLifecycleManager(): PluginLifecycleManager {
  return new PluginLifecycleManager();
}

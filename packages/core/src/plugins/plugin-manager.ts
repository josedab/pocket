import type { Document } from '../types/document.js';
import type {
  DeleteContext,
  DeleteHookResult,
  ErrorContext,
  GetContext,
  GetHookResult,
  InsertContext,
  InsertHookResult,
  PluginDefinition,
  PluginState,
  QueryContext,
  QueryHookResult,
  RegisteredPlugin,
  UpdateContext,
  UpdateHookResult,
} from './types.js';

/**
 * Manages plugins for a database
 */
export class PluginManager {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly collectionPlugins = new Map<string, Set<string>>();
  private initialized = false;

  /**
   * Register a plugin
   */
  register<T extends Document>(plugin: PluginDefinition<T>): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, {
      definition: plugin as PluginDefinition,
      state: 'pending',
    });
  }

  /**
   * Register a plugin for specific collections
   */
  registerForCollections<T extends Document>(
    plugin: PluginDefinition<T>,
    collections: string[]
  ): void {
    this.register(plugin);

    for (const collection of collections) {
      if (!this.collectionPlugins.has(collection)) {
        this.collectionPlugins.set(collection, new Set());
      }
      this.collectionPlugins.get(collection)!.add(plugin.name);
    }
  }

  /**
   * Unregister a plugin
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    if (plugin.definition.onDestroy && plugin.state === 'initialized') {
      try {
        await plugin.definition.onDestroy();
      } catch {
        // Ignore destroy errors
      }
    }

    this.plugins.delete(name);

    // Remove from collection mappings
    for (const [, pluginNames] of this.collectionPlugins) {
      pluginNames.delete(name);
    }
  }

  /**
   * Initialize all plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const sortedPlugins = this.getSortedPlugins();

    for (const { definition, state } of sortedPlugins) {
      if (state !== 'pending') continue;

      const registered = this.plugins.get(definition.name)!;

      try {
        if (definition.onInit) {
          await definition.onInit();
        }
        registered.state = 'initialized';
      } catch (error) {
        registered.state = 'error';
        registered.error = error instanceof Error ? error : new Error(String(error));
      }
    }

    this.initialized = true;
  }

  /**
   * Destroy all plugins
   */
  async destroy(): Promise<void> {
    const sortedPlugins = this.getSortedPlugins().reverse();

    for (const { definition, state } of sortedPlugins) {
      if (state !== 'initialized') continue;

      try {
        if (definition.onDestroy) {
          await definition.onDestroy();
        }
      } catch {
        // Ignore destroy errors
      }

      const registered = this.plugins.get(definition.name)!;
      registered.state = 'destroyed';
    }

    this.initialized = false;
  }

  /**
   * Run beforeInsert hooks
   */
  async runBeforeInsert<T extends Document>(
    context: InsertContext<T>
  ): Promise<InsertHookResult<T>> {
    const plugins = this.getPluginsForCollection(context.collection);
    let currentDoc = context.document;

    for (const plugin of plugins) {
      if (!plugin.definition.beforeInsert) continue;

      const result = await plugin.definition.beforeInsert({
        ...context,
        document: currentDoc,
      } as InsertContext);

      if (result) {
        if (result.skip || result.error) {
          return result as InsertHookResult<T>;
        }
        if (result.document) {
          currentDoc = result.document as typeof currentDoc;
        }
      }
    }

    return { document: currentDoc };
  }

  /**
   * Run afterInsert hooks
   */
  async runAfterInsert<T extends Document>(document: T, context: InsertContext<T>): Promise<void> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (plugin.definition.afterInsert) {
        await plugin.definition.afterInsert(document, context as InsertContext);
      }
    }
  }

  /**
   * Run beforeUpdate hooks
   */
  async runBeforeUpdate<T extends Document>(
    context: UpdateContext<T>
  ): Promise<UpdateHookResult<T>> {
    const plugins = this.getPluginsForCollection(context.collection);
    let currentChanges = context.changes;

    for (const plugin of plugins) {
      if (!plugin.definition.beforeUpdate) continue;

      const result = await plugin.definition.beforeUpdate({
        ...context,
        changes: currentChanges,
      } as UpdateContext);

      if (result) {
        if (result.skip || result.error) {
          return result as UpdateHookResult<T>;
        }
        if (result.changes) {
          currentChanges = result.changes as typeof currentChanges;
        }
      }
    }

    return { changes: currentChanges };
  }

  /**
   * Run afterUpdate hooks
   */
  async runAfterUpdate<T extends Document>(document: T, context: UpdateContext<T>): Promise<void> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (plugin.definition.afterUpdate) {
        await plugin.definition.afterUpdate(document, context as UpdateContext);
      }
    }
  }

  /**
   * Run beforeDelete hooks
   */
  async runBeforeDelete<T extends Document>(context: DeleteContext<T>): Promise<DeleteHookResult> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (!plugin.definition.beforeDelete) continue;

      const result = await plugin.definition.beforeDelete(context as DeleteContext);

      if (result && (result.skip || result.error)) {
        return result;
      }
    }

    return {};
  }

  /**
   * Run afterDelete hooks
   */
  async runAfterDelete<T extends Document>(context: DeleteContext<T>): Promise<void> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (plugin.definition.afterDelete) {
        await plugin.definition.afterDelete(context as DeleteContext);
      }
    }
  }

  /**
   * Run beforeQuery hooks
   */
  async runBeforeQuery<T extends Document>(context: QueryContext<T>): Promise<QueryHookResult<T>> {
    const plugins = this.getPluginsForCollection(context.collection);
    let currentSpec = context.spec;

    for (const plugin of plugins) {
      if (!plugin.definition.beforeQuery) continue;

      const result = await plugin.definition.beforeQuery({
        ...context,
        spec: currentSpec,
      } as QueryContext);

      if (result) {
        if (result.skip || result.error || result.results) {
          return result as QueryHookResult<T>;
        }
        if (result.spec) {
          currentSpec = result.spec as typeof currentSpec;
        }
      }
    }

    return { spec: currentSpec };
  }

  /**
   * Run afterQuery hooks
   */
  async runAfterQuery<T extends Document>(results: T[], context: QueryContext<T>): Promise<T[]> {
    const plugins = this.getPluginsForCollection(context.collection);
    let currentResults = results;

    for (const plugin of plugins) {
      if (!plugin.definition.afterQuery) continue;

      const transformedResults = await plugin.definition.afterQuery(
        currentResults,
        context as QueryContext
      );

      if (Array.isArray(transformedResults)) {
        currentResults = transformedResults as T[];
      }
    }

    return currentResults;
  }

  /**
   * Run beforeGet hooks
   */
  async runBeforeGet<T extends Document>(context: GetContext): Promise<GetHookResult<T>> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (!plugin.definition.beforeGet) continue;

      const result = await plugin.definition.beforeGet(context);

      if (result && (result.skip || result.error || result.document !== undefined)) {
        return result as GetHookResult<T>;
      }
    }

    return {};
  }

  /**
   * Run afterGet hooks
   */
  async runAfterGet<T extends Document>(
    document: T | null,
    context: GetContext
  ): Promise<T | null> {
    const plugins = this.getPluginsForCollection(context.collection);
    let currentDoc = document;

    for (const plugin of plugins) {
      if (!plugin.definition.afterGet) continue;

      const transformedDoc = await plugin.definition.afterGet(currentDoc, context);

      if (transformedDoc !== undefined) {
        currentDoc = transformedDoc as T | null;
      }
    }

    return currentDoc;
  }

  /**
   * Run error hooks
   */
  async runOnError(context: ErrorContext): Promise<void> {
    const plugins = this.getPluginsForCollection(context.collection);

    for (const plugin of plugins) {
      if (plugin.definition.onError) {
        try {
          await plugin.definition.onError(context);
        } catch {
          // Ignore errors in error handlers
        }
      }
    }
  }

  /**
   * Get registered plugin names
   */
  getPluginNames(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Get plugin state
   */
  getPluginState(name: string): PluginState | undefined {
    return this.plugins.get(name)?.state;
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get plugins sorted by priority
   */
  private getSortedPlugins(): RegisteredPlugin[] {
    return [...this.plugins.values()].sort((a, b) => {
      const priorityA = a.definition.priority ?? 0;
      const priorityB = b.definition.priority ?? 0;
      return priorityB - priorityA;
    });
  }

  /**
   * Get plugins for a collection
   */
  private getPluginsForCollection(collection: string): RegisteredPlugin[] {
    const collectionSpecificPlugins = this.collectionPlugins.get(collection);
    const sortedPlugins = this.getSortedPlugins();

    if (!collectionSpecificPlugins || collectionSpecificPlugins.size === 0) {
      // Return global plugins (those not assigned to specific collections)
      const assignedPlugins = new Set<string>();
      for (const [, plugins] of this.collectionPlugins) {
        for (const name of plugins) {
          assignedPlugins.add(name);
        }
      }

      return sortedPlugins.filter(
        (p) => p.state === 'initialized' && !assignedPlugins.has(p.definition.name)
      );
    }

    return sortedPlugins.filter(
      (p) => p.state === 'initialized' && collectionSpecificPlugins.has(p.definition.name)
    );
  }
}

/**
 * Create a plugin manager
 */
export function createPluginManager(): PluginManager {
  return new PluginManager();
}

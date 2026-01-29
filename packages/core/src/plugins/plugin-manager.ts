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
 * Manages the lifecycle and execution of database plugins.
 *
 * The PluginManager provides a hook-based extension system for intercepting
 * and modifying database operations. Plugins can:
 *
 * - **Transform data** before/after operations (insert, update, delete, query, get)
 * - **Validate** documents and block operations
 * - **Add side effects** like logging, analytics, or cache invalidation
 * - **Handle errors** centrally
 *
 * ## Plugin Lifecycle
 *
 * ```
 * register() → initialize() → [hooks run on operations] → destroy()
 *     │            │                                          │
 *     ▼            ▼                                          ▼
 *  pending → initialized ←──────────────────────────────→ destroyed
 *              │
 *              ▼ (on error)
 *            error
 * ```
 *
 * ## Hook Execution Order
 *
 * Plugins are executed in priority order (higher priority first).
 * For each operation:
 *
 * 1. All `before*` hooks run in priority order
 * 2. The database operation executes
 * 3. All `after*` hooks run in priority order
 *
 * ## Collection-Specific Plugins
 *
 * Plugins can be registered globally or for specific collections using
 * {@link registerForCollections}. Collection-specific plugins only run
 * for operations on those collections.
 *
 * @example
 * ```typescript
 * const manager = createPluginManager();
 *
 * // Register a validation plugin
 * manager.register({
 *   name: 'validator',
 *   priority: 100, // Run early
 *   beforeInsert: async (ctx) => {
 *     if (!ctx.document.title) {
 *       return { error: new Error('Title is required') };
 *     }
 *     return { document: ctx.document };
 *   },
 * });
 *
 * // Register a logging plugin for specific collections
 * manager.registerForCollections({
 *   name: 'audit-logger',
 *   afterInsert: async (doc, ctx) => {
 *     console.log(`Created ${ctx.collection}:${doc._id}`);
 *   },
 * }, ['users', 'orders']);
 *
 * await manager.initialize();
 * ```
 *
 * @see {@link PluginDefinition} for the plugin interface
 * @see {@link createPluginManager} for factory function
 */
export class PluginManager {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly collectionPlugins = new Map<string, Set<string>>();
  private initialized = false;

  /**
   * Registers a plugin for all collections (global plugin).
   *
   * Global plugins run for every database operation unless overridden
   * by collection-specific plugins. Plugin names must be unique.
   *
   * @typeParam T - The document type the plugin operates on
   * @param plugin - The plugin definition with name, hooks, and optional priority
   * @throws Error if a plugin with the same name is already registered
   *
   * @example
   * ```typescript
   * manager.register({
   *   name: 'timestamps',
   *   priority: 50,
   *   beforeInsert: async (ctx) => ({
   *     document: { ...ctx.document, createdAt: new Date() }
   *   }),
   *   beforeUpdate: async (ctx) => ({
   *     changes: { ...ctx.changes, updatedAt: new Date() }
   *   }),
   * });
   * ```
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
   * Registers a plugin for specific collections only.
   *
   * The plugin's hooks will only be invoked for operations on the
   * specified collections. This is useful for collection-specific
   * validation, transformations, or side effects.
   *
   * @typeParam T - The document type the plugin operates on
   * @param plugin - The plugin definition
   * @param collections - Array of collection names to apply the plugin to
   *
   * @example
   * ```typescript
   * // Encrypt sensitive fields only for the 'users' collection
   * manager.registerForCollections({
   *   name: 'user-encryption',
   *   beforeInsert: async (ctx) => ({
   *     document: { ...ctx.document, ssn: encrypt(ctx.document.ssn) }
   *   }),
   * }, ['users']);
   * ```
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
   * Unregisters and destroys a plugin by name.
   *
   * Calls the plugin's `onDestroy` hook if it exists and the plugin
   * was initialized. Removes the plugin from all collection mappings.
   *
   * @param name - The unique name of the plugin to remove
   *
   * @example
   * ```typescript
   * await manager.unregister('my-plugin');
   * ```
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
   * Initializes all registered plugins in priority order.
   *
   * Calls each plugin's `onInit` hook if defined. Plugins that fail
   * initialization are marked with `'error'` state and their error
   * is stored. Already initialized managers are no-ops.
   *
   * This method is typically called automatically by the Database
   * during creation, but can be called manually if needed.
   *
   * @example
   * ```typescript
   * manager.register(plugin1);
   * manager.register(plugin2);
   * await manager.initialize();
   *
   * // Check for initialization errors
   * if (manager.getPluginState('plugin1') === 'error') {
   *   console.error('Plugin failed to initialize');
   * }
   * ```
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
   * Destroys all plugins in reverse priority order.
   *
   * Calls each plugin's `onDestroy` hook for cleanup. Plugins are
   * destroyed in reverse priority order to ensure proper teardown
   * of dependencies. Errors during destruction are silently ignored.
   *
   * @example
   * ```typescript
   * // During database shutdown
   * await manager.destroy();
   * ```
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
   * Runs all `beforeInsert` hooks for the target collection.
   *
   * Each hook can:
   * - **Modify** the document by returning `{ document: modifiedDoc }`
   * - **Skip** the operation by returning `{ skip: true }`
   * - **Reject** with an error by returning `{ error: new Error(...) }`
   *
   * Hooks run in priority order. If a hook skips or errors, subsequent
   * hooks are not executed.
   *
   * @typeParam T - The document type
   * @param context - Insert context with collection name and document
   * @returns Result containing the (possibly modified) document, or skip/error
   *
   * @internal Used by Collection.insert()
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
   * Runs all `afterInsert` hooks for the target collection.
   *
   * After hooks are for side effects (logging, notifications, cache updates).
   * They cannot modify the inserted document.
   *
   * @typeParam T - The document type
   * @param document - The inserted document
   * @param context - Insert context with collection name
   *
   * @internal Used by Collection.insert()
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
   * Runs all `beforeUpdate` hooks for the target collection.
   *
   * Each hook can modify the changes object, skip, or reject the operation.
   * Useful for validation, computed fields, or access control.
   *
   * @typeParam T - The document type
   * @param context - Update context with collection, document ID, and changes
   * @returns Result containing (possibly modified) changes, or skip/error
   *
   * @internal Used by Collection.update()
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
   * Runs all `afterUpdate` hooks for the target collection.
   *
   * @typeParam T - The document type
   * @param document - The updated document
   * @param context - Update context with collection name and original changes
   *
   * @internal Used by Collection.update()
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
   * Runs all `beforeDelete` hooks for the target collection.
   *
   * Hooks can prevent deletion by returning `{ skip: true }` or
   * `{ error: new Error(...) }`. Useful for referential integrity
   * checks or soft-delete implementations.
   *
   * @typeParam T - The document type
   * @param context - Delete context with collection and document ID
   * @returns Empty object to proceed, or skip/error to prevent deletion
   *
   * @internal Used by Collection.delete()
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
   * Runs all `afterDelete` hooks for the target collection.
   *
   * @typeParam T - The document type
   * @param context - Delete context with collection and deleted document ID
   *
   * @internal Used by Collection.delete()
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
   * Runs all `beforeQuery` hooks for the target collection.
   *
   * Hooks can:
   * - **Modify** the query spec (add filters, change sort, etc.)
   * - **Short-circuit** by returning `{ results: [...] }` directly
   * - **Skip** or **error** to prevent the query
   *
   * @typeParam T - The document type
   * @param context - Query context with collection and query spec
   * @returns Modified spec, short-circuit results, or skip/error
   *
   * @internal Used by Collection.find()
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
   * Runs all `afterQuery` hooks for the target collection.
   *
   * After hooks can transform the results array (filter, map, decorate).
   * Each hook receives the output of the previous hook.
   *
   * @typeParam T - The document type
   * @param results - The query results to transform
   * @param context - Query context with collection and original spec
   * @returns The (possibly transformed) results array
   *
   * @internal Used by Collection.find()
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
   * Runs all `beforeGet` hooks for the target collection.
   *
   * Hooks can short-circuit by returning a document directly,
   * or prevent access with skip/error.
   *
   * @typeParam T - The document type
   * @param context - Get context with collection and document ID
   * @returns Short-circuit document, or skip/error, or empty to proceed
   *
   * @internal Used by Collection.get()
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
   * Runs all `afterGet` hooks for the target collection.
   *
   * Hooks can transform the returned document or return null
   * to hide it from the caller.
   *
   * @typeParam T - The document type
   * @param document - The retrieved document (or null if not found)
   * @param context - Get context with collection and document ID
   * @returns The (possibly transformed) document or null
   *
   * @internal Used by Collection.get()
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
   * Runs all `onError` hooks for the target collection.
   *
   * Error hooks are for logging and monitoring. They cannot
   * modify or suppress the error. Errors in error handlers
   * are silently ignored to prevent cascading failures.
   *
   * @param context - Error context with operation, collection, and error details
   *
   * @internal Used by Collection for error reporting
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
   * Returns the names of all registered plugins.
   *
   * @returns Array of plugin names in registration order
   */
  getPluginNames(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Returns the current state of a plugin.
   *
   * @param name - The plugin name
   * @returns The plugin state, or `undefined` if not registered
   *
   * @see {@link PluginState} for possible states
   */
  getPluginState(name: string): PluginState | undefined {
    return this.plugins.get(name)?.state;
  }

  /**
   * Checks if a plugin is registered.
   *
   * @param name - The plugin name to check
   * @returns `true` if the plugin is registered (in any state)
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Returns all plugins sorted by priority (highest first).
   *
   * Plugins with no priority default to 0. Higher priority plugins
   * run before lower priority plugins.
   *
   * @returns Sorted array of registered plugins
   * @internal
   */
  private getSortedPlugins(): RegisteredPlugin[] {
    return [...this.plugins.values()].sort((a, b) => {
      const priorityA = a.definition.priority ?? 0;
      const priorityB = b.definition.priority ?? 0;
      return priorityB - priorityA;
    });
  }

  /**
   * Returns the plugins applicable to a specific collection.
   *
   * If the collection has plugins registered via {@link registerForCollections},
   * only those plugins are returned. Otherwise, returns all global plugins
   * (those not assigned to any specific collection).
   *
   * Only initialized plugins are returned.
   *
   * @param collection - The collection name
   * @returns Array of applicable plugins, sorted by priority
   * @internal
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
 * Creates a new PluginManager instance.
 *
 * Factory function for creating plugin managers. The Database class
 * uses this internally, but you can create standalone managers for
 * testing or advanced use cases.
 *
 * @returns A new PluginManager instance
 *
 * @example
 * ```typescript
 * const manager = createPluginManager();
 * manager.register(myPlugin);
 * await manager.initialize();
 * ```
 */
export function createPluginManager(): PluginManager {
  return new PluginManager();
}

/**
 * Pocket plugin integration for materialized views.
 *
 * Provides a plugin factory that hooks into Pocket's plugin system
 * (afterInsert, afterUpdate, afterDelete) and routes change events
 * to the ViewManager for incremental view maintenance.
 *
 * @module view-plugin
 */

import type { Document, PluginDefinition, ChangeEvent, InsertContext, UpdateContext, DeleteContext } from '@pocket/core';
import type { ViewManager } from './view-manager.js';

/** Sequence counter for generating change event sequences */
let globalSequence = 0;

/**
 * Creates a Pocket plugin that routes document changes to a ViewManager.
 *
 * The plugin hooks into the afterInsert, afterUpdate, and afterDelete
 * lifecycle events and constructs ChangeEvent objects that are forwarded
 * to the ViewManager for incremental view maintenance.
 *
 * @param viewManager - The ViewManager to route changes to
 * @returns A PluginDefinition that can be registered with a Pocket database
 *
 * @example
 * ```typescript
 * import { createViewManager } from '@pocket/views';
 * import { createViewPlugin } from '@pocket/views';
 *
 * const viewManager = createViewManager();
 * const plugin = createViewPlugin(viewManager);
 *
 * // Register with Pocket database
 * db.registerPlugin(plugin);
 *
 * // Create views
 * viewManager.createView({
 *   name: 'active-users',
 *   collection: 'users',
 *   filter: { status: 'active' },
 * });
 *
 * // Views are now automatically updated when documents change
 * ```
 */
export function createViewPlugin(viewManager: ViewManager): PluginDefinition {
  return {
    name: 'pocket-views',
    version: '0.1.0',
    priority: 0,

    afterInsert: (document: Document, context: InsertContext): void => {
      const change: ChangeEvent<Document> = {
        operation: 'insert',
        documentId: document._id,
        document,
        isFromSync: false,
        timestamp: context.timestamp,
        sequence: ++globalSequence,
      };
      viewManager.processChange(context.collection, change);
    },

    afterUpdate: (document: Document, context: UpdateContext): void => {
      const change: ChangeEvent<Document> = {
        operation: 'update',
        documentId: document._id,
        document,
        previousDocument: context.existingDocument,
        isFromSync: false,
        timestamp: context.timestamp,
        sequence: ++globalSequence,
      };
      viewManager.processChange(context.collection, change);
    },

    afterDelete: (context: DeleteContext): void => {
      const change: ChangeEvent<Document> = {
        operation: 'delete',
        documentId: context.documentId,
        document: null,
        previousDocument: context.existingDocument ?? undefined,
        isFromSync: false,
        timestamp: context.timestamp,
        sequence: ++globalSequence,
      };
      viewManager.processChange(context.collection, change);
    },
  };
}

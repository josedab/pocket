/**
 * Auth Plugin - Pocket database plugin for authentication integration
 *
 * Creates a Pocket plugin that:
 * - Adds auth headers (Bearer token) to sync requests
 * - Adds user context to document operations (createdBy, updatedBy)
 * - Optionally blocks operations when not authenticated
 */

import type { PluginDefinition } from '@pocket/core';
import type { AuthManager } from './auth-manager.js';

/**
 * Configuration for the auth plugin
 */
export interface AuthPluginConfig {
  /** Block write operations when not authenticated (default: false) */
  requireAuth?: boolean;
  /** Field name for created-by tracking (default: '_createdBy') */
  createdByField?: string;
  /** Field name for updated-by tracking (default: '_updatedBy') */
  updatedByField?: string;
  /** Collections to apply the plugin to (empty = all) */
  collections?: string[];
}

/**
 * Creates a Pocket plugin that integrates authentication with database operations.
 *
 * The plugin:
 * - Adds `createdBy` to new documents with the current user ID
 * - Adds `updatedBy` to document updates with the current user ID
 * - Optionally blocks operations when the user is not authenticated
 * - Provides the auth token for sync operations via the plugin context
 *
 * @param authManager - The AuthManager instance to use
 * @param config - Optional plugin configuration
 * @returns A PluginDefinition for use with Pocket's plugin system
 *
 * @example
 * ```typescript
 * const auth = createAuthManager();
 * const plugin = createAuthPlugin(auth, {
 *   requireAuth: true,
 *   createdByField: '_createdBy',
 *   updatedByField: '_updatedBy',
 * });
 *
 * // Register with Pocket
 * db.registerPlugin(plugin);
 * ```
 */
export function createAuthPlugin(
  authManager: AuthManager,
  config: AuthPluginConfig = {}
): PluginDefinition {
  const {
    requireAuth = false,
    createdByField = '_createdBy',
    updatedByField = '_updatedBy',
  } = config;

  /**
   * Check if the user is authenticated, throwing if auth is required.
   */
  function assertAuthenticated(): void {
    if (requireAuth && !authManager.isAuthenticated()) {
      throw new Error('Authentication required: user must be logged in to perform this operation');
    }
  }

  /**
   * Get the current user ID, or undefined if not authenticated.
   */
  function getCurrentUserId(): string | undefined {
    return authManager.getUser()?.id;
  }

  return {
    name: 'pocket-auth',
    version: '0.1.0',
    priority: 90, // Run early to block unauthenticated operations

    onInit() {
      // Plugin initialization - no async setup needed
    },

    onDestroy() {
      // Plugin cleanup - nothing to dispose
    },

    beforeInsert(context) {
      assertAuthenticated();

      const userId = getCurrentUserId();

      if (userId) {
        const doc = context.document as Record<string, unknown>;
        return {
          document: {
            ...doc,
            [createdByField]: userId,
            [updatedByField]: userId,
          } as typeof context.document,
        };
      }

      return { document: context.document };
    },

    beforeUpdate(context) {
      assertAuthenticated();

      const userId = getCurrentUserId();

      if (userId) {
        const changes = context.changes as Record<string, unknown>;
        return {
          changes: {
            ...changes,
            [updatedByField]: userId,
          } as typeof context.changes,
        };
      }

      return { changes: context.changes };
    },

    beforeDelete(_context) {
      assertAuthenticated();
      // Allow delete to proceed
      return { skip: false };
    },

    beforeQuery(context) {
      assertAuthenticated();
      return { spec: context.spec };
    },

    beforeGet(_context) {
      assertAuthenticated();
      return {};
    },
  };
}

/**
 * Create a sync headers provider that adds Authorization header to sync requests.
 *
 * Returns a function that produces headers with the current Bearer token.
 * Useful for configuring sync adapters that need auth headers.
 *
 * @param authManager - The AuthManager instance
 * @returns A function that returns headers with the current auth token
 *
 * @example
 * ```typescript
 * const getHeaders = createSyncAuthHeaders(auth);
 *
 * const syncAdapter = createSyncAdapter({
 *   url: 'https://api.example.com/sync',
 *   headers: getHeaders,
 * });
 * ```
 */
export function createSyncAuthHeaders(
  authManager: AuthManager
): () => Record<string, string> {
  return (): Record<string, string> => {
    const token = authManager.getToken();
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {};
  };
}

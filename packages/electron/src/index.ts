/**
 * @pocket/electron - Electron Integration
 *
 * Provides database integration for Electron desktop applications.
 *
 * This package provides three entry points:
 * - `@pocket/electron/main` - Main process database management
 * - `@pocket/electron/preload` - IPC bridge for renderer communication
 * - `@pocket/electron/renderer` - Renderer process client
 *
 * @example
 * ```typescript
 * // main.ts (main process)
 * import { createMainDatabase } from '@pocket/electron/main';
 *
 * const db = await createMainDatabase({ name: 'my-app' });
 * db.registerIpcHandlers();
 *
 * // preload.ts
 * import { exposePocketAPI } from '@pocket/electron/preload';
 * exposePocketAPI();
 *
 * // renderer.ts (renderer process)
 * import { getPocketClient } from '@pocket/electron/renderer';
 *
 * const client = await getPocketClient();
 * const users = client.collection('users');
 * const allUsers = await users.getAll();
 * ```
 *
 * @module @pocket/electron
 */

// Re-export core types
export type { Collection, Database, Document, QueryBuilder, StorageAdapter } from '@pocket/core';

// Export IPC channel constants
export { IPC_CHANNELS } from './main/database.js';

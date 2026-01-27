/**
 * @pocket/electron/renderer - Renderer Process Module
 *
 * Exports for the Electron renderer process.
 *
 * @module @pocket/electron/renderer
 */

export {
  PocketClient,
  RendererCollection,
  createCollectionAccessor,
  createPocketClient,
  getPocketClient,
  type QueryOptions,
} from './client.js';

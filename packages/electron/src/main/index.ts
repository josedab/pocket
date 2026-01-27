/**
 * @pocket/electron/main - Main Process Module
 *
 * Exports for the Electron main process.
 *
 * @module @pocket/electron/main
 */

export {
  IPC_CHANNELS,
  MainProcessDatabase,
  PocketIpcChannels,
  createMainDatabase,
  type MainDatabaseConfig,
} from './database.js';

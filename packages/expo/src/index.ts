/**
 * @pocket/expo - Expo Integration
 *
 * Provides storage adapters and utilities for using Pocket with Expo.
 *
 * @module @pocket/expo
 */

// Storage adapters
export { createExpoSQLiteStorage, type ExpoSQLiteConfig } from './storage/expo-sqlite-adapter.js';

export {
  createExpoFileSystemStorage,
  type ExpoFileSystemConfig,
} from './storage/expo-filesystem-adapter.js';

// Re-export React hooks for convenience
export {
  PocketProvider,
  useCollection,
  useDatabase,
  useDocument,
  useFindOne,
  useLiveQuery,
  useMutation,
  useOptimisticMutation,
  usePocketContext,
  useQuery,
  useSyncStatus,
} from '@pocket/react';

// Re-export core types
export type { Collection, Database, Document, QueryBuilder, StorageAdapter } from '@pocket/core';

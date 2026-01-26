/**
 * React Native storage adapters for Pocket.
 *
 * This module provides two storage adapter implementations for
 * React Native applications:
 *
 * ## Available Adapters
 *
 * | Adapter | Speed | Use Case |
 * |---------|-------|----------|
 * | {@link MMKVDocumentStore} | Fast | Production apps (recommended) |
 * | {@link AsyncStorageDocumentStore} | Moderate | Quick prototyping |
 *
 * ## Choosing an Adapter
 *
 * **Use MMKV** when:
 * - Performance is important
 * - You need encryption support
 * - You want synchronous operations
 *
 * **Use AsyncStorage** when:
 * - You're prototyping quickly
 * - You don't want to install native modules
 * - You're using Expo without dev-clients
 *
 * @module storage
 *
 * @example Using MMKV (recommended)
 * ```typescript
 * import { MMKV } from 'react-native-mmkv';
 * import { createMMKVDocumentStore } from '@pocket/react-native';
 *
 * const mmkv = new MMKV();
 * const store = createMMKVDocumentStore<Todo>('todos', mmkv);
 * ```
 *
 * @example Using AsyncStorage
 * ```typescript
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { createAsyncStorageDocumentStore } from '@pocket/react-native';
 *
 * const store = createAsyncStorageDocumentStore<Todo>('todos', AsyncStorage);
 * ```
 */

export * from './async-storage-adapter.js';
export * from './mmkv-adapter.js';

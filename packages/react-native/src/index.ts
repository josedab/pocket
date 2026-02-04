/**
 * @pocket/react-native - React Native Integration for Pocket
 *
 * This package provides React Native-specific components, hooks, and storage
 * adapters for integrating Pocket into mobile applications.
 *
 * ## Features
 *
 * - **React Hooks**: Familiar hooks API for querying and mutating data
 * - **Storage Adapters**: AsyncStorage and MMKV adapters for persistence
 * - **Context Provider**: Share database instance across your app
 * - **Reactive Updates**: Automatic UI updates when data changes
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     React Native App                            │
 * │                                                                  │
 * │  ┌──────────────────────────────────────────────────────────┐  │
 * │  │                   PocketProvider                          │  │
 * │  │              (provides database context)                  │  │
 * │  │                                                            │  │
 * │  │  ┌────────────────────────────────────────────────────┐   │  │
 * │  │  │                    Hooks                            │   │  │
 * │  │  │  useQuery  useDocument  useMutation  useAll         │   │  │
 * │  │  └────────────────────────────────────────────────────┘   │  │
 * │  └──────────────────────────────────────────────────────────┘  │
 * │                             │                                   │
 * │                             ▼                                   │
 * │  ┌──────────────────────────────────────────────────────────┐  │
 * │  │                   Storage Adapters                        │  │
 * │  │  ┌───────────────────┐  ┌───────────────────┐            │  │
 * │  │  │  AsyncStorage     │  │  MMKV (faster)    │            │  │
 * │  │  │  (standard)       │  │  (recommended)    │            │  │
 * │  │  └───────────────────┘  └───────────────────┘            │  │
 * │  └──────────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```tsx
 * import { PocketProvider, useQuery, useMutation } from '@pocket/react-native';
 * import { createMMKVStorage } from '@pocket/react-native';
 * import { MMKV } from 'react-native-mmkv';
 *
 * // Create storage adapter
 * const mmkv = new MMKV();
 * const storage = createMMKVStorage(mmkv);
 *
 * // Wrap your app
 * function App() {
 *   return (
 *     <PocketProvider dbName="my-app" storage={storage}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 *
 * // Use hooks in components
 * function TodoList() {
 *   const { data: todos, isLoading } = useQuery<Todo>('todos');
 *   const { insert, remove } = useMutation<Todo>('todos');
 *
 *   if (isLoading) return <ActivityIndicator />;
 *
 *   return (
 *     <FlatList
 *       data={todos}
 *       renderItem={({ item }) => <TodoItem todo={item} onDelete={() => remove(item._id)} />}
 *     />
 *   );
 * }
 * ```
 *
 * ## Storage Options
 *
 * | Adapter | Performance | Bundle Size | Use Case |
 * |---------|-------------|-------------|----------|
 * | MMKV | Excellent | Small native | Production apps |
 * | AsyncStorage | Good | Standard | Quick prototyping |
 *
 * @packageDocumentation
 * @module @pocket/react-native
 *
 * @see {@link PocketProvider} for the context provider
 * @see {@link useQuery} for querying data
 * @see {@link useMutation} for mutations
 */

// Types
export type * from './types.js';

// Storage adapters
export * from './storage/index.js';

// Context and Provider
export * from './context.js';

// Hooks
export * from './hooks.js';

// Native SQLite storage
export * from './native-storage.js';

// Background sync
export * from './background-sync.js';

// Battery-aware sync
export * from './battery-aware-sync.js';

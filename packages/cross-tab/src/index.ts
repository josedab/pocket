/**
 * @pocket/cross-tab - Cross-tab synchronization for Pocket
 *
 * @example
 * ```typescript
 * import {
 *   createTabManager,
 *   createLeaderElection,
 *   createCrossTabSync,
 *   createDistributedLockManager,
 *   createUseTabsHook,
 *   createUseLeaderHook,
 * } from '@pocket/cross-tab';
 *
 * // Create managers
 * const tabManager = createTabManager({ debug: true });
 * await tabManager.initialize();
 *
 * const leaderElection = createLeaderElection(tabManager);
 * await leaderElection.initialize();
 *
 * const crossTabSync = createCrossTabSync(tabManager);
 * await crossTabSync.initialize();
 *
 * const lockManager = createDistributedLockManager(tabManager);
 * await lockManager.initialize();
 *
 * // React hooks
 * const useTabs = createUseTabsHook(React);
 * const useLeader = createUseLeaderHook(React);
 *
 * function MyComponent() {
 *   const { tabs, tabId } = useTabs(tabManager);
 *   const { isLeader } = useLeader(leaderElection);
 *
 *   return (
 *     <div>
 *       <p>Tab ID: {tabId}</p>
 *       <p>Is Leader: {isLeader ? 'Yes' : 'No'}</p>
 *       <p>Connected Tabs: {tabs.length}</p>
 *     </div>
 *   );
 * }
 *
 * // Sync data across tabs
 * crossTabSync.subscribe('todos', (message) => {
 *   if (message.type === 'change') {
 *     // Handle change from another tab
 *   }
 * });
 *
 * // Broadcast changes
 * crossTabSync.broadcastChange('todos', 'todo-1', { text: 'Updated' });
 *
 * // Distributed locks
 * const acquired = await lockManager.acquire('important-resource');
 * if (acquired) {
 *   try {
 *     // Do exclusive work
 *   } finally {
 *     lockManager.release('important-resource');
 *   }
 * }
 * ```
 */

// Types
export type {
  ChangePayload,
  CollectionSyncState,
  CrossTabConfig,
  CrossTabEvent,
  CrossTabEventType,
  CrossTabMessage,
  CrossTabMessageType,
  DistributedLock,
  LeaderState,
  LockPayload,
  SyncRequestPayload,
  SyncResponsePayload,
  TabInfo,
} from './types.js';

// Tab Manager
export { TabManager, createTabManager } from './tab-manager.js';

// Leader Election
export { LeaderElection, createLeaderElection } from './leader-election.js';

// Cross-Tab Sync
export { CrossTabSync, createCrossTabSync } from './cross-tab-sync.js';

// Distributed Lock
export { DistributedLockManager, createDistributedLockManager } from './distributed-lock.js';

// Connection Pool
export {
  ConnectionPool,
  createConnectionPool,
  type ConnectionPoolConfig,
  type ConnectionPoolStats,
  type ConnectionPoolStatus,
} from './connection-pool.js';

// Query Deduplicator
export {
  QueryDeduplicator,
  createQueryDeduplicator,
  type CachedQuery,
  type DeduplicatorStats,
  type QueryDeduplicatorConfig,
} from './query-deduplicator.js';

// Hooks
export type {
  ReactHooks,
  UseCrossTabSyncReturn,
  UseDistributedLockReturn,
  UseLeaderReturn,
  UseTabsReturn,
} from './hooks.js';

export {
  createUseCrossTabEventsHook,
  createUseCrossTabSyncHook,
  createUseDistributedLockHook,
  createUseLeaderHook,
  createUseTabsHook,
} from './hooks.js';

// Heartbeat Monitor
export {
  HeartbeatMonitor,
  createHeartbeatMonitor,
  type HeartbeatMonitorConfig,
  type HeartbeatMessage,
  type HeartbeatStatus,
} from './heartbeat.js';

// Cross-Device Settings Sync
export {
  CrossDeviceSync,
  createCrossDeviceSync,
  type CrossDeviceSyncConfig,
  type DeviceInfo,
  type DeviceSyncEvent,
  type DeviceSyncState,
  type DeviceSyncStatus,
  type SettingsEntry,
} from './cross-device-sync.js';

// Browser Compatibility Layer
export {
  createCompatSender,
  detectCapabilities,
  type BrowserCapabilities,
  type CrossTabSender,
  type CrossTabTransport,
} from './browser-compat.js';

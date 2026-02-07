/**
 * Core types for cross-platform mobile abstractions.
 *
 * Defines shared types for platform detection, network connectivity,
 * battery state, device capabilities, and mobile sync configuration.
 *
 * @module types
 */

// ────────────────────────────── Platform Types ──────────────────────────────

/**
 * Supported mobile platforms.
 */
export type MobilePlatform = 'ios' | 'android' | 'web' | 'expo';

/**
 * Screen orientation.
 */
export type ScreenOrientation = 'portrait' | 'landscape';

/**
 * Screen size category.
 */
export type ScreenSizeCategory = 'small' | 'medium' | 'large' | 'xlarge';

/**
 * Information about the current platform and device.
 */
export interface PlatformInfo {
  /** Detected platform */
  platform: MobilePlatform;

  /** Operating system version, if available */
  osVersion?: string;

  /** Device capabilities */
  capabilities: DeviceCapabilities;

  /** Screen dimensions */
  screen: ScreenInfo;
}

/**
 * Screen dimensions and orientation.
 */
export interface ScreenInfo {
  /** Screen width in logical pixels */
  width: number;

  /** Screen height in logical pixels */
  height: number;

  /** Current orientation */
  orientation: ScreenOrientation;

  /** Screen size category */
  sizeCategory: ScreenSizeCategory;
}

// ────────────────────────────── Network Types ──────────────────────────────

/**
 * Network connection type.
 */
export type ConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

/**
 * Network connectivity state.
 */
export type NetworkStatus = 'online' | 'offline' | 'metered';

/**
 * Full network state snapshot.
 */
export interface NetworkState {
  /** Current connectivity status */
  status: NetworkStatus;

  /** Connection type */
  connectionType: ConnectionType;

  /** Whether the connection is metered (e.g. cellular data) */
  isMetered: boolean;

  /** Timestamp of last state change */
  lastChanged: number;
}

/**
 * Sync strategy per connection type.
 */
export interface SyncStrategy {
  /** Whether sync is allowed */
  enabled: boolean;

  /** Maximum batch size for sync operations */
  batchSize: number;

  /** Minimum interval between syncs in milliseconds */
  intervalMs: number;
}

/**
 * Network-aware sync strategies keyed by connection type.
 */
export interface NetworkSyncStrategies {
  /** Strategy when on wifi */
  wifi: SyncStrategy;

  /** Strategy when on cellular */
  cellular: SyncStrategy;

  /** Strategy when offline (queue only) */
  offline: SyncStrategy;
}

// ────────────────────────────── Battery Types ──────────────────────────────

/**
 * Battery charging state.
 */
export type BatteryChargingState = 'charging' | 'discharging' | 'full' | 'unknown';

/**
 * Battery state snapshot.
 */
export interface BatteryState {
  /** Battery level between 0 and 1 */
  level: number;

  /** Current charging state */
  charging: BatteryChargingState;

  /** Whether battery level is considered low (below 20%) */
  isLow: boolean;
}

// ────────────────────────────── Device Capability Types ──────────────────────────────

/**
 * Device capabilities that may or may not be available.
 */
export interface DeviceCapabilities {
  /** Whether biometric authentication is available (Face ID, fingerprint) */
  biometrics: boolean;

  /** Whether secure storage is available (Keychain, Keystore) */
  secureStorage: boolean;

  /** Whether push notifications are supported */
  pushNotifications: boolean;

  /** Whether background fetch is supported */
  backgroundFetch: boolean;
}

// ────────────────────────────── Mobile Sync Configuration ──────────────────────────────

/**
 * Configuration for mobile sync behavior.
 */
export interface MobileSyncConfig {
  /** Sync strategies per network type */
  strategies: NetworkSyncStrategies;

  /** Whether to enable push-based sync */
  enablePushSync: boolean;

  /** Whether to enable battery-aware sync throttling */
  enableBatteryAwareness: boolean;

  /** Maximum offline queue size */
  maxQueueSize: number;

  /** Whether to persist the offline queue across app restarts */
  persistQueue: boolean;
}

// ────────────────────────────── Secure Storage Types ──────────────────────────────

/**
 * Access control level for secure storage items.
 */
export type SecureAccessControl =
  | 'whenUnlocked'
  | 'afterFirstUnlock'
  | 'always'
  | 'whenUnlockedThisDeviceOnly';

/**
 * Options for storing a secure value.
 */
export interface SecureStorageSetOptions {
  /** Access control level */
  accessControl?: SecureAccessControl;

  /** Whether biometric unlock is required to read */
  requireBiometrics?: boolean;
}

// ────────────────────────────── Push Sync Types ──────────────────────────────

/**
 * Push notification payload for triggering sync.
 */
export interface PushSyncPayload {
  /** Type of push event */
  type: 'sync' | 'background-fetch' | 'silent-push';

  /** Collections that need syncing */
  collections?: string[];

  /** Priority level */
  priority: 'low' | 'normal' | 'high';

  /** Timestamp of the push */
  timestamp: number;
}

/**
 * Result of a push-triggered sync operation.
 */
export interface PushSyncResult {
  /** Whether the sync succeeded */
  success: boolean;

  /** Number of items synced */
  synced: number;

  /** Number of items that failed */
  failed: number;

  /** Duration in milliseconds */
  duration: number;

  /** The push event that triggered this sync */
  trigger: PushSyncPayload;
}

// ────────────────────────────── Offline Queue Types ──────────────────────────────

/**
 * Priority level for queued operations.
 */
export type QueuePriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Type of mutation operation.
 */
export type MutationType = 'insert' | 'update' | 'delete';

/**
 * A queued offline mutation.
 */
export interface QueuedOperation {
  /** Unique operation ID */
  id: string;

  /** Collection name */
  collection: string;

  /** Type of mutation */
  type: MutationType;

  /** Operation payload */
  payload: unknown;

  /** Priority level */
  priority: QueuePriority;

  /** Timestamp when the operation was queued */
  timestamp: number;

  /** Number of replay attempts */
  retryCount: number;

  /** Maximum retries before eviction */
  maxRetries: number;
}

/**
 * Conflict resolution strategy for replaying queued operations.
 */
export type ConflictStrategy = 'client-wins' | 'server-wins' | 'merge' | 'manual';

/**
 * Result of replaying a single queued operation.
 */
export interface ReplayResult {
  /** The operation that was replayed */
  operation: QueuedOperation;

  /** Whether the replay succeeded */
  success: boolean;

  /** Error message if the replay failed */
  error?: string;
}

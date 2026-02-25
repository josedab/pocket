/**
 * @pocket/mobile - Cross-Platform Mobile Abstractions for Pocket
 *
 * This package provides platform-agnostic mobile abstractions that work
 * across React Native, Expo, and future native SDKs. It handles platform
 * detection, network connectivity, secure storage, push-based sync,
 * and offline operation queuing.
 *
 * ## Features
 *
 * - **Platform Detection**: Detect iOS, Android, Web, or Expo runtime
 * - **Network Manager**: Monitor connectivity and configure sync strategies
 * - **Secure Storage**: Encrypted key-value storage with biometric support
 * - **Push Sync**: Sync triggered by push notifications and background fetch
 * - **Offline Queue**: Queue mutations offline with priority-based replay
 *
 * ## Architecture
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                      @pocket/mobile                              │
 * │                                                                   │
 * │  ┌───────────────┐  ┌───────────────┐  ┌────────────────────┐   │
 * │  │  Platform      │  │  Network      │  │  Secure Storage    │   │
 * │  │  Detector      │  │  Manager      │  │  (Keychain/Store)  │   │
 * │  └───────────────┘  └───────────────┘  └────────────────────┘   │
 * │                                                                   │
 * │  ┌───────────────┐  ┌───────────────────────────────────────┐   │
 * │  │  Push Sync     │  │  Offline Queue                       │   │
 * │  │  (Silent Push) │  │  (Priority-based, conflict resolution)│   │
 * │  └───────────────┘  └───────────────────────────────────────┘   │
 * └──────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createPlatformDetector,
 *   createNetworkManager,
 *   createSecureStorage,
 *   createPushSync,
 *   createOfflineQueue,
 * } from '@pocket/mobile';
 *
 * // Detect platform and capabilities
 * const detector = createPlatformDetector();
 * const { platform, capabilities } = detector.detect();
 *
 * // Monitor network state
 * const network = createNetworkManager();
 * network.state$.subscribe((state) => {
 *   console.log('Network:', state.status);
 * });
 *
 * // Secure storage with biometrics
 * const storage = createSecureStorage({
 *   namespace: 'my-app',
 *   enableBiometrics: capabilities.biometrics,
 * });
 * await storage.set('auth-token', 'secret');
 *
 * // Push-based sync
 * const pushSync = createPushSync({ batchSize: 50 });
 * pushSync.enable();
 *
 * // Offline queue with conflict resolution
 * const queue = createOfflineQueue({
 *   maxSize: 1000,
 *   conflictStrategy: 'client-wins',
 * });
 * ```
 *
 * @packageDocumentation
 * @module @pocket/mobile
 */

// Types
export type * from './types.js';

// Platform detection
export * from './platform-detector.js';

// Network connectivity
export * from './network-manager.js';

// Secure storage
export * from './secure-storage.js';

// Push-based sync
export * from './push-sync.js';

// Offline operation queue
export * from './offline-queue.js';

// Background sync scheduling
export * from './background-sync.js';

// App lifecycle management
export * from './app-lifecycle.js';

// JSI Storage Engine (next-gen)
export {
  JSIStorageAdapter,
  createJSIStorageAdapter,
  decideSyncSchedule,
  getTurboModuleSpec,
  type BatterySchedulerConfig,
  type BatteryState,
  type PocketJSIModule,
  type PocketTurboModuleSpec,
  type SyncScheduleDecision,
} from './jsi-engine.js';

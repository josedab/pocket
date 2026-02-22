/**
 * @pocket/sync-server - Zero-config sync server for Pocket
 *
 * @example
 * ```typescript
 * import { createSyncServer, createMemoryStorage } from '@pocket/sync-server';
 *
 * // Create server with defaults
 * const server = createSyncServer({
 *   port: 8080,
 *   storage: createMemoryStorage(),
 * });
 *
 * // Start server
 * await server.start();
 *
 * // Handle events
 * server.onEvent((event) => {
 *   console.log(event.type, event.clientId);
 * });
 *
 * // Stop server
 * await server.stop();
 * ```
 *
 * @example CLI
 * ```bash
 * # Start with defaults
 * npx pocket-sync
 *
 * # Custom port
 * npx pocket-sync --port 3000
 *
 * # With debug logging
 * npx pocket-sync --debug
 * ```
 */

// Types
export type {
  AckMessage,
  ConnectMessage,
  ConnectedClient,
  ConnectedMessage,
  ErrorMessage,
  LogLevel,
  PullMessage,
  PushMessage,
  ServerEvent,
  ServerEventType,
  StorageBackend,
  SubscribeMessage,
  SyncChange,
  SyncCompressionConfig,
  SyncMessage,
  SyncMessageType,
  SyncRateLimiterConfig,
  SyncResponseMessage,
  SyncServerConfig,
  UnsubscribeMessage,
} from './types.js';

export { DEFAULT_SERVER_CONFIG } from './types.js';

// Sync Server
export { SyncServer, createSyncServer } from './sync-server.js';

// Storage backends
export { MemoryStorage, createMemoryStorage } from './storage/index.js';

// Middleware
export {
  DEFAULT_RATE_LIMITER_CONFIG,
  RateLimiter,
  createRateLimiter,
  rateLimiterMiddleware,
  type RateLimitResult,
  type RateLimiterConfig,
} from './middleware/index.js';

// Edge Adapter
export type {
  EdgeAdapterConfig,
  EdgeAdapterMetrics,
  EdgeRequest,
  EdgeResponse,
  EdgeRuntime,
} from './edge-adapter.js';

export { EdgeSyncAdapter, createEdgeAdapter, createOneLineSync } from './edge-adapter.js';

// Webhook Manager
export type { WebhookConfig, WebhookDelivery, WebhookEventType } from './webhook-manager.js';

export { WebhookManager, createWebhookManager } from './webhook-manager.js';

// Health Monitor
export type { HealthCheck, HealthStatus, MonitorConfig, ServerMetrics } from './health-monitor.js';

export { HealthMonitor, createServerHealthMonitor } from './health-monitor.js';

// Functions
export type {
  FunctionContext,
  FunctionRegistryConfig,
  FunctionResult,
  FunctionStats,
  PocketFunction,
  TriggerEvent,
} from './functions.js';

export { FunctionRegistry, createFunctionRegistry } from './functions.js';

// Webhooks
export type {
  RetryPolicy,
  WebhookConfig as WebhooksConfig,
  WebhookDelivery as WebhooksDelivery,
  WebhookEvent,
  WebhookManagerConfig,
  WebhookPayload,
  WebhookSender,
  WebhookStats,
} from './webhooks.js';

export { WebhookManager as WebhooksManager, createWebhookNotifier as createWebhooksManager } from './webhooks.js';

// Realtime Engine
export type {
  RealtimeConfig,
  RealtimeEvent,
  RealtimeSubscription,
  SubscriptionMatch,
} from './realtime.js';

export { RealtimeEngine, createRealtimeEngine } from './realtime.js';

// Realtime Adapter
export type {
  RealtimeAdapterConfig,
  RealtimeClientConnection,
  RealtimeProtocolMessage,
} from './realtime-adapter.js';

export { RealtimeAdapter, createRealtimeAdapter } from './realtime-adapter.js';

/**
 * @pocket/cloud - Managed Cloud Sync Service for Pocket
 *
 * This package provides one-line cloud sync integration for Pocket databases.
 * It wraps the `@pocket/sync` engine with Pocket Cloud managed service features:
 *
 * - Automatic endpoint discovery
 * - API key authentication
 * - Usage and quota monitoring
 * - Project management dashboard
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        Client Application                           │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                          CloudSync                                   │
 * │                                                                      │
 * │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
 * │  │ CloudClient  │  │ SyncEngine      │  │ Usage Monitor         │  │
 * │  │ (API calls)  │  │ (from @pocket/  │  │ (quota tracking)      │  │
 * │  │              │  │  sync)          │  │                       │  │
 * │  └──────────────┘  └─────────────────┘  └───────────────────────┘  │
 * │                                                                      │
 * │  ┌──────────────────────────────────────────────────────────────┐   │
 * │  │                   CloudDashboard                              │   │
 * │  │  (Project management, analytics, API keys)                    │   │
 * │  └──────────────────────────────────────────────────────────────┘   │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                      Pocket Cloud Service                            │
 * │                  (cloud.pocket-db.dev)                               │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createCloudSync } from '@pocket/cloud';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 *
 * // One-line cloud sync setup
 * const cloudSync = await createCloudSync({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_live_xxxxxxxx',
 *   collections: ['todos', 'notes']
 * });
 *
 * cloudSync.connect(db);
 * await cloudSync.start();
 * ```
 *
 * @packageDocumentation
 * @module @pocket/cloud
 *
 * @see {@link CloudSync} for the main cloud sync class
 * @see {@link CloudClient} for the cloud API client
 * @see {@link CloudDashboard} for project management
 * @see {@link CloudConfig} for configuration options
 */

// Types
export type {
  ApiKeyInfo,
  ApiKeyValidation,
  CloudAnalytics,
  CloudConfig,
  CloudEndpoint,
  CloudProject,
  CloudRegion,
  CloudStats,
  CloudStatus,
  CloudSyncOptions,
  CloudTier,
  UsageMetrics,
} from './types.js';

export {
  API_KEY_LIVE_PREFIX,
  API_KEY_MIN_LENGTH,
  API_KEY_TEST_PREFIX,
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_REGION,
  REGION_ENDPOINTS,
  TIER_LIMITS,
} from './types.js';

// Cloud Client
export { CloudClient, createCloudClient } from './cloud-client.js';

// Cloud Sync
export { CloudSync, createCloudSync, type CloudSyncStatus } from './cloud-sync.js';

// Cloud Dashboard
export {
  CloudDashboard,
  createCloudDashboard,
  type AnalyticsQueryOptions,
  type CreateApiKeyOptions,
  type CreateProjectOptions,
} from './cloud-dashboard.js';

// Provisioner
export {
  CloudProvisioner,
  createCloudProvisioner,
  type ProvisionOptions,
  type ProvisionResult,
} from './provisioner.js';

// Health Monitor
export {
  HealthMonitor,
  createHealthMonitor,
  type HealthCheckResult,
  type HealthMonitorConfig,
  type HealthStatus,
  type HealthSummary,
} from './health-monitor.js';

// Cloud Server
export {
  CloudSyncServer,
  createCloudSyncServer,
  type CloudServerConfig,
  type ServerAuthConfig,
  type ServerHealthCheck,
  type ServerStatus,
  type TenantMetrics,
} from './cloud-server.js';

// Project Manager
export {
  ProjectManager,
  createProjectManager,
  type ProjectEnvironment,
  type DeploymentRecord,
  type ProjectTeamMember,
  type ManagedProject,
} from './project-manager.js';

// Usage Analytics
export {
  UsageAnalytics,
  createUsageAnalytics,
  type UsageDataPoint,
  type UsageSummary,
  type UsageAlert,
} from './usage-analytics.js';

// Rate Limiter
export {
  RateLimiter,
  TieredRateLimiter,
  createRateLimiter,
  createTieredRateLimiter,
  TIER_RATE_LIMITS,
  type RateLimiterConfig,
  type RateLimitResult,
  type RateLimiterStatus,
} from './rate-limiter.js';

// Audit Logger
export {
  AuditLogger,
  createAuditLogger,
  type AuditAction,
  type AuditEntry,
  type AuditEntryInput,
  type AuditQueryFilter,
} from './audit-logger.js';

// Region Router
export {
  RegionRouter,
  createRegionRouter,
  type RegionRouterConfig,
  type RegionEndpoint,
} from './region-router.js';

// Billing
export {
  BillingManager,
  createBillingManager,
  TIER_PRICING,
  type BillingConfig,
  type BillingEvent,
  type BillingEventType,
  type BillingInterval,
  type CreateSubscriptionInput,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentMethodType,
  type AddPaymentMethodInput,
  type Subscription,
  type SubscriptionStatus,
  type UsageRecord,
  type UsageSummary as BillingUsageSummary,
} from './billing.js';

// Webhook Handler
export {
  WebhookHandler,
  createWebhookHandler,
  verifyWebhookSignature,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventCategory,
  type WebhookEventType,
  type WebhookHandlerConfig,
  type RegisterEndpointInput,
  type DeliveryRecord,
  type DeliveryStatus,
} from './webhook-handler.js';

// Quick Connect
export {
  connectToCloud,
  type QuickConnectConfig,
  type CloudConnection,
  type CloudConnectionEvent,
  type CloudUsageSnapshot,
} from './quick-connect.js';

// Auth Service
export {
  AuthService,
  createAuthService,
  ROLE_PERMISSIONS,
  type AuthServiceConfig,
  type AuthEvent,
  type AuthEventType,
  type OAuthProvider,
  type OAuthProviderConfig,
  type OAuthProfile,
  type OAuthResult,
  type Permission,
  type Session,
  type SessionStatus,
  type TokenPair,
  type TokenPayload,
  type TokenValidation,
  type UserRole,
} from './auth-service.js';

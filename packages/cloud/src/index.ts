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
 *   apiKey: 'pk_test_YOUR_API_KEY',
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
  type DeploymentRecord,
  type ManagedProject,
  type ProjectEnvironment,
  type ProjectTeamMember,
} from './project-manager.js';

// Usage Analytics
export {
  UsageAnalytics,
  createUsageAnalytics,
  type UsageAlert,
  type UsageDataPoint,
  type UsageSummary,
} from './usage-analytics.js';

// Rate Limiter
export {
  RateLimiter,
  TIER_RATE_LIMITS,
  TieredRateLimiter,
  createRateLimiter,
  createTieredRateLimiter,
  type RateLimitResult,
  type RateLimiterConfig,
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
  type RegionEndpoint,
  type RegionRouterConfig,
} from './region-router.js';

// Billing
export {
  BillingManager,
  TIER_PRICING,
  createBillingManager,
  type AddPaymentMethodInput,
  type BillingConfig,
  type BillingEvent,
  type BillingEventType,
  type BillingInterval,
  type UsageSummary as BillingUsageSummary,
  type CreateSubscriptionInput,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentMethodType,
  type Subscription,
  type SubscriptionStatus,
  type UsageRecord,
} from './billing.js';

// Webhook Handler
export {
  WebhookHandler,
  createWebhookHandler,
  verifyWebhookSignature,
  type DeliveryRecord,
  type DeliveryStatus,
  type RegisterEndpointInput,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventCategory,
  type WebhookEventType,
  type WebhookHandlerConfig,
} from './webhook-handler.js';

// Quick Connect
export {
  connectToCloud,
  connectWithRelay,
  type CloudConnection,
  type CloudConnectionEvent,
  type CloudUsageSnapshot,
  type QuickConnectConfig,
  type RelayCloudConnection,
  type RelayConnectConfig,
} from './quick-connect.js';

// Auth Service
export {
  AuthService,
  ROLE_PERMISSIONS,
  createAuthService,
  type AuthEvent,
  type AuthEventType,
  type AuthServiceConfig,
  type OAuthProfile,
  type OAuthProvider,
  type OAuthProviderConfig,
  type OAuthResult,
  type Permission,
  type Session,
  type SessionStatus,
  type TokenPair,
  type TokenPayload,
  type TokenValidation,
  type UserRole,
} from './auth-service.js';

// Cloud SDK
export {
  CloudSDK,
  createCloudSDK,
  type CloudSDKConfig,
  type CloudSDKStats,
  type CloudSDKStatus,
} from './cloud-sdk.js';

// Provisioning API
export {
  ProvisioningAPI,
  createProvisioningAPI,
  type PlanQuotas,
  type ProjectInfo,
  type ProjectPlan,
  type ProvisioningConfig,
  type ProvisioningEvent,
  type ProvisioningUsageMetrics,
} from './provisioning-api.js';

// Auto-Provisioning Pipeline
export {
  AutoProvisionPipeline,
  createAutoProvisionPipeline,
  type AutoProvisionConfig,
  type ProvisionPipelineResult,
  type ProvisionProgress,
  type ProvisionStep,
  type ProvisionStepName,
  type ProvisionStepStatus,
} from './auto-provision.js';

// Managed Relay
export {
  ManagedRelay,
  createManagedRelay,
  type ManagedRelayConfig,
  type RelayConnection,
  type RelayEvent,
  type RelayMetrics,
  type RelayStatus,
  type TenantRelayMetrics,
} from './managed-relay.js';

// Auto-Scaler
export {
  AutoScaler,
  createAutoScaler,
  type AutoScalerConfig,
  type AutoScalerState,
  type ScaleDirection,
  type ScalerMetrics,
  type ScalingDecision,
  type ScalingPolicy,
  type ScalingPolicyType,
} from './auto-scaler.js';

// Tenant Quota Tracker
export {
  DEFAULT_TIER_QUOTAS,
  TenantQuotaTracker,
  createTenantQuotaTracker,
  type QuotaCheckResult,
  type TenantQuotaState,
  type TierQuota,
} from './tenant-quota.js';

// Relay Deduplication
export { RelayDedup, createRelayDedup, type RelayDedupConfig } from './relay-dedup.js';

// Webhook Security
export {
  createWebhookHeaders,
  generateWebhookSignature,
  verifyWebhookPayload,
  type SignatureVerifyResult,
  type WebhookSecurityConfig,
} from './webhook-security.js';

// Zero-Config Cloud Sync
export {
  PocketCloud,
  createPocketCloud,
  type PocketCloudConfig,
  type PocketCloudStatus,
  type PocketCloudSyncStats,
  type SyncableDatabase,
} from './zero-config-cloud.js';

// Cloud Console
export { CloudConsole, createCloudConsole } from './cloud-console.js';
export type {
  ApiKey,
  ConsoleConfig,
  ConsoleEvent,
  ConsoleStats,
  Tenant,
  TenantUsage,
} from './cloud-console.js';

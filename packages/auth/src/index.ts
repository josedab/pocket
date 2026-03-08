/**
 * @pocket/auth - Local-first authentication for Pocket
 *
 * Provides JWT-based authentication with OAuth2, passkey (WebAuthn),
 * and credentials providers. Supports offline grace periods, automatic
 * token refresh, and integrates with Pocket's plugin system.
 *
 * @example
 * ```typescript
 * import {
 *   createAuthManager,
 *   createCredentialsProvider,
 *   createAuthPlugin,
 * } from '@pocket/auth';
 *
 * // Create auth manager
 * const auth = createAuthManager({
 *   tokenRefreshThresholdMs: 5 * 60 * 1000, // 5 minutes
 *   offlineGracePeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
 * });
 *
 * // Register a credentials provider
 * const credentials = createCredentialsProvider({
 *   loginEndpoint: '/api/auth/login',
 *   registerEndpoint: '/api/auth/register',
 * });
 * auth.registerProvider(credentials);
 *
 * // Login
 * const state = await auth.login('credentials', {
 *   email: 'user@example.com',
 *   password: 'password',
 * });
 *
 * // Create Pocket plugin for auth integration
 * const plugin = createAuthPlugin(auth, { requireAuth: true });
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  AuthConfig,
  AuthEvent,
  AuthProvider,
  AuthState,
  AuthUser,
  CredentialsConfig,
  JWTPayload,
  OAuth2Config,
  PasskeyConfig,
  TokenPair,
} from './types.js';

// Token Manager
export { TokenManager, createTokenManager } from './token-manager.js';

// Auth Manager
export { AuthManager, createAuthManager } from './auth-manager.js';

// Providers
export {
  CredentialsProvider,
  createCredentialsProvider,
} from './providers/credentials-provider.js';
export { OAuth2Provider, createOAuth2Provider } from './providers/oauth2-provider.js';
export { PasskeyProvider, createPasskeyProvider } from './providers/passkey-provider.js';

// Plugin
export { createAuthPlugin, createSyncAuthHeaders } from './auth-plugin.js';
export type { AuthPluginConfig } from './auth-plugin.js';

// Middleware
export { extractUser, requireRole, verifyToken } from './middleware.js';
export type { AuthMiddleware, AuthRequest, AuthResponse, NextFunction } from './middleware.js';

// Offline RBAC
export { OfflineRBAC, createOfflineRBAC } from './offline-rbac.js';
export type { PermissionCheck, RBACConfig, RBACState } from './offline-rbac.js';

// Offline-First Auth
export {
  InMemoryCredentialStorage,
  OfflineAuthManager,
  createOfflineAuth,
} from './offline-auth.js';
export type {
  CachedCredential,
  OfflineAuthConfig,
  OfflineAuthEvent,
  OfflineAuthState,
  OfflineCredentialStorage,
  OfflineSession,
} from './offline-auth.js';

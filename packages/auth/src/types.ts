/**
 * Types for Local-First Auth Module
 */

/**
 * Configuration for the auth module
 */
export interface AuthConfig {
  /** Storage backend for tokens: 'memory' (default) or 'indexeddb' */
  storage?: 'memory' | 'indexeddb';
  /** Refresh token before expiry in milliseconds (default: 5 minutes) */
  tokenRefreshThresholdMs?: number;
  /** Accept expired tokens when offline in milliseconds (default: 7 days) */
  offlineGracePeriodMs?: number;
  /** Callback invoked when auth state changes */
  onAuthStateChange?: (state: AuthState) => void;
}

/**
 * Current authentication state
 */
export interface AuthState {
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** The authenticated user, or null */
  user: AuthUser | null;
  /** The current access token, or null */
  token: string | null;
  /** Token expiry timestamp in milliseconds, or null */
  expiresAt: number | null;
  /** Whether the client is currently offline */
  isOffline: boolean;
}

/**
 * Authenticated user information
 */
export interface AuthUser {
  /** Unique user identifier */
  id: string;
  /** User email address */
  email?: string;
  /** User display name */
  name?: string;
  /** User roles for authorization */
  roles: string[];
  /** Additional user metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Access and refresh token pair
 */
export interface TokenPair {
  /** JWT access token */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Token lifetime in seconds */
  expiresIn: number;
  /** Token type, always 'Bearer' */
  tokenType: 'Bearer';
}

/**
 * Decoded JWT payload (base64 decoded, NOT cryptographically verified)
 */
export interface JWTPayload {
  /** Subject - user ID */
  sub: string;
  /** User email */
  email?: string;
  /** User display name */
  name?: string;
  /** User roles */
  roles: string[];
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Expiration timestamp (seconds) */
  exp: number;
  /** Issuer */
  iss?: string;
}

/**
 * Authentication provider interface
 */
export interface AuthProvider {
  /** Provider name identifier */
  name: string;
  /** Provider type */
  type: 'oauth2' | 'passkey' | 'credentials' | 'custom';
  /** Authenticate with the provider */
  authenticate(params: unknown): Promise<TokenPair>;
  /** Refresh an access token using a refresh token */
  refresh?(refreshToken: string): Promise<TokenPair>;
  /** Revoke a token */
  revoke?(token: string): Promise<void>;
}

/**
 * OAuth2 provider configuration
 */
export interface OAuth2Config {
  /** OAuth2 client ID */
  clientId: string;
  /** Authorization endpoint URL */
  authorizationUrl: string;
  /** Token endpoint URL */
  tokenUrl: string;
  /** Redirect URL after authorization */
  redirectUrl: string;
  /** OAuth2 scopes to request */
  scopes: string[];
  /** Provider name: 'google', 'github', 'custom' */
  provider: string;
}

/**
 * WebAuthn passkey provider configuration
 */
export interface PasskeyConfig {
  /** Relying party name (displayed to user) */
  rpName: string;
  /** Relying party ID (domain) */
  rpId: string;
  /** Origin URL */
  origin: string;
  /** Server endpoint for generating challenges */
  challengeEndpoint: string;
}

/**
 * Credentials (email/password) provider configuration
 */
export interface CredentialsConfig {
  /** Endpoint for login requests */
  loginEndpoint: string;
  /** Endpoint for registration requests */
  registerEndpoint: string;
}

/**
 * Auth events emitted by the auth manager
 */
export type AuthEvent =
  | { type: 'auth:login'; user: AuthUser }
  | { type: 'auth:logout' }
  | { type: 'auth:token-refreshed'; expiresAt: number }
  | { type: 'auth:token-expired' }
  | { type: 'auth:error'; error: Error }
  | { type: 'auth:offline-mode'; user: AuthUser };

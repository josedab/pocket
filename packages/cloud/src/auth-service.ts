/**
 * AuthService - JWT-based authentication and authorization for Pocket Cloud.
 *
 * Provides JWT token generation and validation, refresh token support,
 * session management, role-based access control, and OAuth2 provider
 * integration support.
 *
 * @module auth-service
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * User roles for role-based access control.
 *
 * - `'admin'`: Full access to all resources and settings
 * - `'developer'`: Read/write access to data and sync
 * - `'viewer'`: Read-only access
 */
export type UserRole = 'admin' | 'developer' | 'viewer';

/**
 * Status of a user session.
 */
export type SessionStatus = 'active' | 'expired' | 'revoked';

/**
 * Supported OAuth2 providers.
 */
export type OAuthProvider = 'github' | 'google' | 'microsoft' | 'custom';

/**
 * Permissions that can be granted to users.
 */
export type Permission =
  | 'sync:read'
  | 'sync:write'
  | 'data:read'
  | 'data:write'
  | 'data:delete'
  | 'project:read'
  | 'project:write'
  | 'project:admin'
  | 'billing:read'
  | 'billing:write'
  | 'team:read'
  | 'team:write';

/**
 * Role-to-permission mapping.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'sync:read', 'sync:write',
    'data:read', 'data:write', 'data:delete',
    'project:read', 'project:write', 'project:admin',
    'billing:read', 'billing:write',
    'team:read', 'team:write',
  ],
  developer: [
    'sync:read', 'sync:write',
    'data:read', 'data:write', 'data:delete',
    'project:read',
    'team:read',
  ],
  viewer: [
    'sync:read',
    'data:read',
    'project:read',
    'team:read',
  ],
};

/**
 * JWT token payload claims.
 *
 * @see {@link AuthService.generateToken}
 */
export interface TokenPayload {
  /** Subject (user ID) */
  sub: string;

  /** Tenant identifier */
  tenantId: string;

  /** User role */
  role: UserRole;

  /** Granted permissions */
  permissions: Permission[];

  /** Issued-at timestamp (seconds) */
  iat: number;

  /** Expiration timestamp (seconds) */
  exp: number;

  /** JWT ID */
  jti: string;
}

/**
 * Result of token generation.
 *
 * @see {@link AuthService.generateToken}
 */
export interface TokenPair {
  /** Access token (JWT) */
  accessToken: string;

  /** Refresh token */
  refreshToken: string;

  /** Access token expiration timestamp (ms) */
  expiresAt: number;

  /** Refresh token expiration timestamp (ms) */
  refreshExpiresAt: number;

  /** Token type */
  tokenType: 'Bearer';
}

/**
 * Result of token validation.
 *
 * @see {@link AuthService.validateToken}
 */
export interface TokenValidation {
  /** Whether the token is valid */
  valid: boolean;

  /** Decoded payload if valid */
  payload: TokenPayload | null;

  /** Error message if invalid */
  error: string | null;
}

/**
 * A user session record.
 *
 * @example
 * ```typescript
 * const session: Session = {
 *   id: 'sess_abc123',
 *   userId: 'user-1',
 *   tenantId: 'tenant-a',
 *   role: 'developer',
 *   status: 'active',
 *   ipAddress: '192.168.1.1',
 *   userAgent: 'Mozilla/5.0',
 *   createdAt: Date.now(),
 *   lastActiveAt: Date.now(),
 *   expiresAt: Date.now() + 86_400_000,
 * };
 * ```
 *
 * @see {@link AuthService.createSession}
 */
export interface Session {
  /** Unique session identifier */
  id: string;

  /** User identifier */
  userId: string;

  /** Tenant identifier */
  tenantId: string;

  /** User role for this session */
  role: UserRole;

  /** Session status */
  status: SessionStatus;

  /** Client IP address */
  ipAddress: string | null;

  /** Client user agent */
  userAgent: string | null;

  /** When the session was created */
  createdAt: number;

  /** When the session was last active */
  lastActiveAt: number;

  /** When the session expires */
  expiresAt: number;
}

/**
 * OAuth2 provider configuration.
 *
 * @see {@link AuthService.registerOAuthProvider}
 */
export interface OAuthProviderConfig {
  /** Provider identifier */
  provider: OAuthProvider;

  /** OAuth2 client ID */
  clientId: string;

  /** OAuth2 client secret */
  clientSecret: string;

  /** Authorization URL */
  authorizeUrl: string;

  /** Token exchange URL */
  tokenUrl: string;

  /** User info URL */
  userInfoUrl: string;

  /** OAuth2 scopes to request */
  scopes: string[];
}

/**
 * Result of an OAuth2 authentication flow.
 *
 * @see {@link AuthService.handleOAuthCallback}
 */
export interface OAuthResult {
  /** Whether authentication was successful */
  success: boolean;

  /** Generated token pair if successful */
  tokens: TokenPair | null;

  /** User profile from the provider */
  profile: OAuthProfile | null;

  /** Error message if failed */
  error: string | null;
}

/**
 * User profile from an OAuth2 provider.
 */
export interface OAuthProfile {
  /** Provider-assigned user ID */
  providerId: string;

  /** Provider name */
  provider: OAuthProvider;

  /** User email */
  email: string;

  /** Display name */
  name: string | null;

  /** Avatar URL */
  avatarUrl: string | null;
}

/**
 * Configuration for the auth service.
 *
 * @example
 * ```typescript
 * const config: AuthServiceConfig = {
 *   jwtSecret: 'my-secret-key',
 *   accessTokenTtlMs: 15 * 60 * 1000,
 *   refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
 *   sessionTtlMs: 24 * 60 * 60 * 1000,
 * };
 * ```
 *
 * @see {@link AuthService}
 */
export interface AuthServiceConfig {
  /** Secret key for signing JWT tokens */
  jwtSecret: string;

  /** Access token time-to-live in ms. @default 900000 (15 minutes) */
  accessTokenTtlMs?: number;

  /** Refresh token time-to-live in ms. @default 604800000 (7 days) */
  refreshTokenTtlMs?: number;

  /** Session time-to-live in ms. @default 86400000 (24 hours) */
  sessionTtlMs?: number;
}

/**
 * Auth event types for observability.
 */
export type AuthEventType =
  | 'token.generated'
  | 'token.refreshed'
  | 'token.invalid'
  | 'session.created'
  | 'session.expired'
  | 'session.revoked'
  | 'oauth.success'
  | 'oauth.failure';

/**
 * An auth event for observability.
 */
export interface AuthEvent {
  /** Unique event identifier */
  id: string;

  /** Event type */
  type: AuthEventType;

  /** User identifier */
  userId: string | null;

  /** Tenant identifier */
  tenantId: string | null;

  /** Additional event data */
  data: Record<string, unknown>;

  /** When the event occurred */
  timestamp: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Encode an object to a base64url string.
 */
function base64urlEncode(data: string): string {
  // Use a portable base64url encoding
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new TextEncoder().encode(data);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < bytes.length) result += chars[((b1 << 2) | (b2 >> 6)) & 0x3f];
    if (i + 2 < bytes.length) result += chars[b2 & 0x3f];
  }
  return result;
}

/**
 * Decode a base64url string to a UTF-8 string.
 */
function base64urlDecode(encoded: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const c0 = encoded[i]!;
    const c1 = encoded[i + 1];
    const c2 = encoded[i + 2];
    const c3 = encoded[i + 3];
    const b0 = chars.indexOf(c0);
    const b1 = c1 ? chars.indexOf(c1) : 0;
    const b2 = c2 ? chars.indexOf(c2) : 0;
    const b3 = c3 ? chars.indexOf(c3) : 0;
    bytes.push((b0 << 2) | (b1 >> 4));
    if (c2) bytes.push(((b1 << 4) | (b2 >> 2)) & 0xff);
    if (c3) bytes.push(((b2 << 6) | b3) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Create a simple HMAC-like signature using the secret and payload.
 */
function signPayload(data: string, secret: string): string {
  let hash = 0x811c9dc5;
  const combined = secret + '.' + data;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hash2 = hash >>> 0;
  return hash2.toString(36) + '_' + (hash2 ^ 0xdeadbeef).toString(36);
}

// ── AuthService ──────────────────────────────────────────────────────────────

/**
 * JWT-based authentication and authorization service for Pocket Cloud.
 *
 * AuthService provides:
 * - JWT token generation and validation
 * - Refresh token support
 * - Session management with expiration
 * - Role-based access control (admin, developer, viewer)
 * - OAuth2 provider integration support
 *
 * @example Basic usage
 * ```typescript
 * import { createAuthService } from '@pocket/cloud';
 *
 * const auth = createAuthService({ jwtSecret: 'my-secret-key' });
 *
 * // Generate tokens
 * const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
 *
 * // Validate a token
 * const result = auth.validateToken(tokens.accessToken);
 * if (result.valid) {
 *   console.log('User:', result.payload?.sub);
 * }
 *
 * // Check permissions
 * const canWrite = auth.hasPermission(tokens.accessToken, 'data:write');
 *
 * // Refresh tokens
 * const newTokens = auth.refreshToken(tokens.refreshToken);
 *
 * auth.destroy();
 * ```
 *
 * @see {@link createAuthService}
 * @see {@link AuthServiceConfig}
 */
export class AuthService {
  private readonly config: Required<AuthServiceConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<AuthEvent>();
  private readonly activeSessions$ = new BehaviorSubject<Map<string, Session>>(new Map());

  private readonly sessions = new Map<string, Session>();
  private readonly refreshTokens = new Map<string, { userId: string; tenantId: string; role: UserRole; expiresAt: number }>();
  private readonly revokedTokens = new Set<string>();
  private readonly oauthProviders = new Map<OAuthProvider, OAuthProviderConfig>();

  constructor(config: AuthServiceConfig) {
    this.config = {
      jwtSecret: config.jwtSecret,
      accessTokenTtlMs: config.accessTokenTtlMs ?? 15 * 60 * 1_000,
      refreshTokenTtlMs: config.refreshTokenTtlMs ?? 7 * 24 * 60 * 60 * 1_000,
      sessionTtlMs: config.sessionTtlMs ?? 24 * 60 * 60 * 1_000,
    };
  }

  // ── Token Management ───────────────────────────────────────────────────

  /**
   * Generate an access token and refresh token pair.
   *
   * @param userId - The user identifier
   * @param tenantId - The tenant identifier
   * @param role - The user role
   * @returns Token pair with access and refresh tokens
   *
   * @example
   * ```typescript
   * const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
   * console.log('Access token:', tokens.accessToken);
   * console.log('Expires at:', new Date(tokens.expiresAt));
   * ```
   */
  generateToken(userId: string, tenantId: string, role: UserRole): TokenPair {
    const now = Date.now();
    const permissions = ROLE_PERMISSIONS[role];
    const jti = generateId('tok');

    const payload: TokenPayload = {
      sub: userId,
      tenantId,
      role,
      permissions,
      iat: Math.floor(now / 1_000),
      exp: Math.floor((now + this.config.accessTokenTtlMs) / 1_000),
      jti,
    };

    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64urlEncode(JSON.stringify(payload));
    const signature = signPayload(`${header}.${body}`, this.config.jwtSecret);
    const accessToken = `${header}.${body}.${signature}`;

    const refreshToken = generateId('rt');
    const refreshExpiresAt = now + this.config.refreshTokenTtlMs;

    this.refreshTokens.set(refreshToken, {
      userId,
      tenantId,
      role,
      expiresAt: refreshExpiresAt,
    });

    this.emitEvent('token.generated', userId, tenantId, { jti });

    return {
      accessToken,
      refreshToken,
      expiresAt: now + this.config.accessTokenTtlMs,
      refreshExpiresAt,
      tokenType: 'Bearer',
    };
  }

  /**
   * Validate a JWT access token.
   *
   * @param token - The JWT access token to validate
   * @returns Validation result with decoded payload
   *
   * @example
   * ```typescript
   * const result = auth.validateToken(accessToken);
   * if (result.valid) {
   *   console.log('User:', result.payload?.sub);
   *   console.log('Role:', result.payload?.role);
   * } else {
   *   console.log('Invalid:', result.error);
   * }
   * ```
   */
  validateToken(token: string): TokenValidation {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, payload: null, error: 'Invalid token format' };
      }

      const header = parts[0]!;
      const body = parts[1]!;
      const signature = parts[2]!;
      const expectedSig = signPayload(`${header}.${body}`, this.config.jwtSecret);

      if (signature !== expectedSig) {
        this.emitEvent('token.invalid', null, null, { reason: 'Invalid signature' });
        return { valid: false, payload: null, error: 'Invalid signature' };
      }

      const payload = JSON.parse(base64urlDecode(body)) as TokenPayload;

      if (this.revokedTokens.has(payload.jti)) {
        this.emitEvent('token.invalid', payload.sub, payload.tenantId, { reason: 'Token revoked' });
        return { valid: false, payload: null, error: 'Token revoked' };
      }

      const nowSeconds = Math.floor(Date.now() / 1_000);
      if (payload.exp < nowSeconds) {
        this.emitEvent('token.invalid', payload.sub, payload.tenantId, { reason: 'Token expired' });
        return { valid: false, payload: null, error: 'Token expired' };
      }

      return { valid: true, payload, error: null };
    } catch {
      return { valid: false, payload: null, error: 'Token decode failed' };
    }
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New token pair or null if refresh token is invalid/expired
   *
   * @example
   * ```typescript
   * const newTokens = auth.refreshToken(oldTokens.refreshToken);
   * if (newTokens) {
   *   console.log('New access token:', newTokens.accessToken);
   * }
   * ```
   */
  refreshToken(refreshToken: string): TokenPair | null {
    const data = this.refreshTokens.get(refreshToken);
    if (!data) return null;

    if (data.expiresAt < Date.now()) {
      this.refreshTokens.delete(refreshToken);
      return null;
    }

    // Rotate: remove old refresh token
    this.refreshTokens.delete(refreshToken);

    const tokens = this.generateToken(data.userId, data.tenantId, data.role);
    this.emitEvent('token.refreshed', data.userId, data.tenantId, {});

    return tokens;
  }

  /**
   * Revoke a specific token by its JTI.
   *
   * @param jti - The JWT ID to revoke
   *
   * @example
   * ```typescript
   * auth.revokeToken('tok_abc123');
   * ```
   */
  revokeToken(jti: string): void {
    this.revokedTokens.add(jti);
  }

  // ── Permission Checking ────────────────────────────────────────────────

  /**
   * Check if a token has a specific permission.
   *
   * @param token - The JWT access token
   * @param permission - The permission to check
   * @returns Whether the token has the specified permission
   *
   * @example
   * ```typescript
   * if (auth.hasPermission(accessToken, 'data:write')) {
   *   // Allow write operation
   * }
   * ```
   */
  hasPermission(token: string, permission: Permission): boolean {
    const result = this.validateToken(token);
    if (!result.valid || !result.payload) return false;
    return result.payload.permissions.includes(permission);
  }

  /**
   * Check if a token has all of the specified permissions.
   *
   * @param token - The JWT access token
   * @param permissions - The permissions to check
   * @returns Whether the token has all specified permissions
   *
   * @example
   * ```typescript
   * if (auth.hasAllPermissions(accessToken, ['data:read', 'data:write'])) {
   *   // Allow read/write operation
   * }
   * ```
   */
  hasAllPermissions(token: string, permissions: Permission[]): boolean {
    const result = this.validateToken(token);
    if (!result.valid || !result.payload) return false;
    return permissions.every((p) => result.payload!.permissions.includes(p));
  }

  /**
   * Get permissions for a role.
   *
   * @param role - The user role
   * @returns Array of permissions granted to the role
   *
   * @example
   * ```typescript
   * const perms = auth.getPermissionsForRole('developer');
   * ```
   */
  getPermissionsForRole(role: UserRole): Permission[] {
    return [...ROLE_PERMISSIONS[role]];
  }

  // ── Session Management ─────────────────────────────────────────────────

  /**
   * Create a new user session.
   *
   * @param userId - The user identifier
   * @param tenantId - The tenant identifier
   * @param role - The user role
   * @param metadata - Optional session metadata
   * @returns The created session
   *
   * @example
   * ```typescript
   * const session = auth.createSession('user-1', 'tenant-a', 'developer', {
   *   ipAddress: '192.168.1.1',
   *   userAgent: 'Mozilla/5.0',
   * });
   * ```
   */
  createSession(
    userId: string,
    tenantId: string,
    role: UserRole,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Session {
    const now = Date.now();
    const session: Session = {
      id: generateId('sess'),
      userId,
      tenantId,
      role,
      status: 'active',
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + this.config.sessionTtlMs,
    };

    this.sessions.set(session.id, session);
    this.publishSessions();
    this.emitEvent('session.created', userId, tenantId, { sessionId: session.id });

    return session;
  }

  /**
   * Get a session by ID.
   *
   * @param sessionId - The session identifier
   * @returns The session or null if not found/expired
   */
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt < Date.now() && session.status === 'active') {
      session.status = 'expired';
      this.publishSessions();
      this.emitEvent('session.expired', session.userId, session.tenantId, { sessionId });
    }

    return { ...session };
  }

  /**
   * Touch a session to extend its last-active timestamp.
   *
   * @param sessionId - The session identifier
   * @returns The updated session or null if not found
   */
  touchSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (session?.status !== 'active') return null;

    if (session.expiresAt < Date.now()) {
      session.status = 'expired';
      this.publishSessions();
      return null;
    }

    session.lastActiveAt = Date.now();
    return { ...session };
  }

  /**
   * Revoke a session.
   *
   * @param sessionId - The session to revoke
   * @returns Whether the session was found and revoked
   *
   * @example
   * ```typescript
   * auth.revokeSession('sess_abc123');
   * ```
   */
  revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = 'revoked';
    this.publishSessions();
    this.emitEvent('session.revoked', session.userId, session.tenantId, { sessionId });

    return true;
  }

  /**
   * Get all active sessions for a user.
   *
   * @param userId - The user identifier
   * @returns Array of active sessions
   *
   * @example
   * ```typescript
   * const sessions = auth.getSessionsByUser('user-1');
   * ```
   */
  getSessionsByUser(userId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId && s.status === 'active')
      .map((s) => ({ ...s }));
  }

  /**
   * Revoke all sessions for a user.
   *
   * @param userId - The user identifier
   * @returns Number of sessions revoked
   *
   * @example
   * ```typescript
   * const count = auth.revokeAllSessions('user-1');
   * console.log(`Revoked ${count} sessions`);
   * ```
   */
  revokeAllSessions(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.status === 'active') {
        session.status = 'revoked';
        count++;
      }
    }
    if (count > 0) {
      this.publishSessions();
    }
    return count;
  }

  // ── OAuth2 Provider Integration ────────────────────────────────────────

  /**
   * Register an OAuth2 provider configuration.
   *
   * @param config - OAuth2 provider configuration
   *
   * @example
   * ```typescript
   * auth.registerOAuthProvider({
   *   provider: 'github',
   *   clientId: 'xxx',
   *   clientSecret: 'yyy',
   *   authorizeUrl: 'https://github.com/login/oauth/authorize',
   *   tokenUrl: 'https://github.com/login/oauth/access_token',
   *   userInfoUrl: 'https://api.github.com/user',
   *   scopes: ['user:email'],
   * });
   * ```
   */
  registerOAuthProvider(config: OAuthProviderConfig): void {
    this.oauthProviders.set(config.provider, config);
  }

  /**
   * Get the authorization URL for an OAuth2 provider.
   *
   * @param provider - The OAuth2 provider
   * @param state - CSRF state parameter
   * @param redirectUri - Redirect URI after authorization
   * @returns Authorization URL or null if provider not registered
   *
   * @example
   * ```typescript
   * const url = auth.getOAuthAuthorizeUrl('github', 'random-state', 'https://app.example.com/callback');
   * ```
   */
  getOAuthAuthorizeUrl(provider: OAuthProvider, state: string, redirectUri: string): string | null {
    const config = this.oauthProviders.get(provider);
    if (!config) return null;

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      scope: config.scopes.join(' '),
      response_type: 'code',
    });

    return `${config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Handle an OAuth2 callback and exchange the code for tokens.
   *
   * @param provider - The OAuth2 provider
   * @param code - The authorization code
   * @param tenantId - The tenant to associate with
   * @param role - The role to assign. @default 'developer'
   * @returns OAuth result with tokens and profile
   *
   * @example
   * ```typescript
   * const result = await auth.handleOAuthCallback('github', 'auth-code', 'tenant-a');
   * if (result.success) {
   *   console.log('Logged in as:', result.profile?.name);
   * }
   * ```
   */
  async handleOAuthCallback(
    provider: OAuthProvider,
    code: string,
    tenantId: string,
    role: UserRole = 'developer',
  ): Promise<OAuthResult> {
    const config = this.oauthProviders.get(provider);
    if (!config) {
      return { success: false, tokens: null, profile: null, error: `Provider not registered: ${provider}` };
    }

    try {
      // Exchange code for access token
      const tokenResponse = await globalThis.fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        this.emitEvent('oauth.failure', null, tenantId, { provider, reason: 'Token exchange failed' });
        return { success: false, tokens: null, profile: null, error: 'Token exchange failed' };
      }

      const tokenData = (await tokenResponse.json()) as { access_token: string };

      // Fetch user profile
      const userResponse = await globalThis.fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userResponse.ok) {
        this.emitEvent('oauth.failure', null, tenantId, { provider, reason: 'User info fetch failed' });
        return { success: false, tokens: null, profile: null, error: 'User info fetch failed' };
      }

      const userData = (await userResponse.json()) as Record<string, string>;
      const profile: OAuthProfile = {
        providerId: userData.id ?? userData.sub ?? '',
        provider,
        email: userData.email ?? '',
        name: userData.name ?? null,
        avatarUrl: userData.avatar_url ?? userData.picture ?? null,
      };

      const userId = `${provider}_${profile.providerId}`;
      const tokens = this.generateToken(userId, tenantId, role);

      this.emitEvent('oauth.success', userId, tenantId, { provider, email: profile.email });

      return { success: true, tokens, profile, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent('oauth.failure', null, tenantId, { provider, reason: message });
      return { success: false, tokens: null, profile: null, error: message };
    }
  }

  /**
   * List registered OAuth2 providers.
   *
   * @returns Array of registered provider names
   */
  listOAuthProviders(): OAuthProvider[] {
    return Array.from(this.oauthProviders.keys());
  }

  // ── Observables ────────────────────────────────────────────────────────

  /**
   * Get an observable stream of auth events.
   *
   * @returns Observable that emits auth events
   *
   * @example
   * ```typescript
   * auth.getEvents$().subscribe(event => {
   *   console.log('Auth event:', event.type, event.userId);
   * });
   * ```
   */
  getEvents$(): Observable<AuthEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get an observable of active session state changes.
   *
   * @returns Observable that emits the full session map on each change
   */
  getSessions$(): Observable<Map<string, Session>> {
    return this.activeSessions$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Permanently destroy the auth service and release all resources.
   *
   * Completes all observables. After calling destroy(), the service
   * cannot be reused.
   *
   * @example
   * ```typescript
   * auth.destroy();
   * ```
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.activeSessions$.complete();
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private publishSessions(): void {
    this.activeSessions$.next(new Map(this.sessions));
  }

  private emitEvent(
    type: AuthEventType,
    userId: string | null,
    tenantId: string | null,
    data: Record<string, unknown>,
  ): void {
    const event: AuthEvent = {
      id: generateId('auth_evt'),
      type,
      userId,
      tenantId,
      data,
      timestamp: Date.now(),
    };
    this.events$.next(event);
  }
}

/**
 * Create an auth service instance.
 *
 * Factory function that creates a configured {@link AuthService}.
 *
 * @param config - Auth service configuration
 * @returns A new AuthService instance
 *
 * @example
 * ```typescript
 * import { createAuthService } from '@pocket/cloud';
 *
 * const auth = createAuthService({ jwtSecret: 'my-secret-key' });
 *
 * const tokens = auth.generateToken('user-1', 'tenant-a', 'admin');
 * const valid = auth.validateToken(tokens.accessToken);
 * ```
 *
 * @see {@link AuthService}
 * @see {@link AuthServiceConfig}
 */
export function createAuthService(config: AuthServiceConfig): AuthService {
  return new AuthService(config);
}

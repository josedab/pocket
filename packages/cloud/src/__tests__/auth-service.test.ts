import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import {
  createAuthService,
  AuthService,
  ROLE_PERMISSIONS,
  type TokenPair,
  type Permission,
} from '../auth-service.js';

describe('AuthService', () => {
  let auth: AuthService;

  const defaultConfig = {
    jwtSecret: 'test-secret-key-for-signing',
  };

  beforeEach(() => {
    auth = createAuthService(defaultConfig);
  });

  afterEach(() => {
    auth.destroy();
  });

  // ── Factory ─────────────────────────────────────────────────────────────

  describe('createAuthService', () => {
    it('should create an AuthService instance', () => {
      expect(auth).toBeInstanceOf(AuthService);
    });

    it('should accept optional TTL config', () => {
      const custom = createAuthService({
        jwtSecret: 'secret',
        accessTokenTtlMs: 60_000,
        refreshTokenTtlMs: 3_600_000,
        sessionTtlMs: 7_200_000,
      });
      expect(custom).toBeInstanceOf(AuthService);
      custom.destroy();
    });
  });

  // ── generateToken ──────────────────────────────────────────────────────

  describe('generateToken', () => {
    it('should return a valid token pair', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
      expect(tokens.refreshExpiresAt).toBeGreaterThan(Date.now());
      expect(tokens.tokenType).toBe('Bearer');
    });

    it('should produce a JWT with three parts', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'admin');
      const parts = tokens.accessToken.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should include correct role permissions in the token', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'admin');
      const result = auth.validateToken(tokens.accessToken);
      expect(result.valid).toBe(true);
      expect(result.payload!.permissions).toEqual(ROLE_PERMISSIONS.admin);
    });
  });

  // ── validateToken ──────────────────────────────────────────────────────

  describe('validateToken', () => {
    it('should validate a valid token', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      const result = auth.validateToken(tokens.accessToken);

      expect(result.valid).toBe(true);
      expect(result.payload).not.toBeNull();
      expect(result.payload!.sub).toBe('user-1');
      expect(result.payload!.tenantId).toBe('tenant-a');
      expect(result.payload!.role).toBe('developer');
      expect(result.error).toBeNull();
    });

    it('should reject an expired token (short TTL)', () => {
      const shortTtlAuth = createAuthService({
        jwtSecret: 'secret',
        accessTokenTtlMs: 1, // 1ms
      });

      const tokens = shortTtlAuth.generateToken('user-1', 'tenant-a', 'developer');

      // Wait for token to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);
      const result = shortTtlAuth.validateToken(tokens.accessToken);
      vi.useRealTimers();

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
      expect(result.payload).toBeNull();

      shortTtlAuth.destroy();
    });

    it('should reject a tampered token', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      const tampered = tokens.accessToken.slice(0, -5) + 'xxxxx';
      const result = auth.validateToken(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('should reject an invalid format token', () => {
      const result = auth.validateToken('not.a.valid.jwt.token');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject a token signed with a different secret', () => {
      const otherAuth = createAuthService({ jwtSecret: 'different-secret' });
      const tokens = otherAuth.generateToken('user-1', 'tenant-a', 'developer');
      const result = auth.validateToken(tokens.accessToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
      otherAuth.destroy();
    });

    it('should reject a revoked token', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      const validation = auth.validateToken(tokens.accessToken);
      const jti = validation.payload!.jti;

      auth.revokeToken(jti);
      const result = auth.validateToken(tokens.accessToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token revoked');
    });
  });

  // ── refreshToken ───────────────────────────────────────────────────────

  describe('refreshToken', () => {
    it('should return new tokens with a valid refresh token', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      const newTokens = auth.refreshToken(tokens.refreshToken);

      expect(newTokens).not.toBeNull();
      expect(newTokens!.accessToken).toBeDefined();
      expect(newTokens!.refreshToken).toBeDefined();
      // Old refresh token should be rotated
      expect(newTokens!.refreshToken).not.toBe(tokens.refreshToken);
    });

    it('should return null for an invalid refresh token', () => {
      const result = auth.refreshToken('invalid_refresh_token');
      expect(result).toBeNull();
    });

    it('should not allow reuse of old refresh token after rotation', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      auth.refreshToken(tokens.refreshToken);
      // Old refresh token should be invalidated
      const result = auth.refreshToken(tokens.refreshToken);
      expect(result).toBeNull();
    });

    it('should return null for expired refresh token', () => {
      const shortAuth = createAuthService({
        jwtSecret: 'secret',
        refreshTokenTtlMs: 1, // 1ms
      });

      const tokens = shortAuth.generateToken('user-1', 'tenant-a', 'developer');

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);
      const result = shortAuth.refreshToken(tokens.refreshToken);
      vi.useRealTimers();

      expect(result).toBeNull();
      shortAuth.destroy();
    });
  });

  // ── hasPermission ──────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('should return true for granted permissions', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'admin');
      expect(auth.hasPermission(tokens.accessToken, 'billing:write')).toBe(true);
      expect(auth.hasPermission(tokens.accessToken, 'data:delete')).toBe(true);
    });

    it('should return false for an invalid token', () => {
      expect(auth.hasPermission('invalid-token', 'data:read')).toBe(false);
    });

    it('should respect viewer role limited permissions', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'viewer');
      expect(auth.hasPermission(tokens.accessToken, 'data:read')).toBe(true);
      expect(auth.hasPermission(tokens.accessToken, 'data:write')).toBe(false);
      expect(auth.hasPermission(tokens.accessToken, 'billing:write')).toBe(false);
    });

    it('should respect developer role permissions', () => {
      const tokens = auth.generateToken('user-1', 'tenant-a', 'developer');
      expect(auth.hasPermission(tokens.accessToken, 'data:write')).toBe(true);
      expect(auth.hasPermission(tokens.accessToken, 'billing:write')).toBe(false);
    });
  });

  // ── Role hierarchy ─────────────────────────────────────────────────────

  describe('role hierarchy', () => {
    it('admin should have more permissions than developer', () => {
      expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.developer.length);
    });

    it('developer should have more permissions than viewer', () => {
      expect(ROLE_PERMISSIONS.developer.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length);
    });

    it('admin should have all developer permissions', () => {
      for (const perm of ROLE_PERMISSIONS.developer) {
        expect(ROLE_PERMISSIONS.admin).toContain(perm);
      }
    });

    it('developer should have all viewer permissions', () => {
      for (const perm of ROLE_PERMISSIONS.viewer) {
        expect(ROLE_PERMISSIONS.developer).toContain(perm);
      }
    });
  });

  // ── Session Management ─────────────────────────────────────────────────

  describe('createSession and revokeSession', () => {
    it('should create a session', () => {
      const session = auth.createSession('user-1', 'tenant-a', 'developer');

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.tenantId).toBe('tenant-a');
      expect(session.role).toBe('developer');
      expect(session.status).toBe('active');
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should create session with metadata', () => {
      const session = auth.createSession('user-1', 'tenant-a', 'developer', {
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
      });
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.userAgent).toBe('TestAgent/1.0');
    });

    it('should revoke a session', () => {
      const session = auth.createSession('user-1', 'tenant-a', 'developer');
      const result = auth.revokeSession(session.id);
      expect(result).toBe(true);

      const retrieved = auth.getSession(session.id);
      expect(retrieved!.status).toBe('revoked');
    });

    it('should return false when revoking nonexistent session', () => {
      expect(auth.revokeSession('nonexistent')).toBe(false);
    });

    it('should find sessions by user', () => {
      auth.createSession('user-1', 'tenant-a', 'developer');
      auth.createSession('user-1', 'tenant-a', 'developer');
      auth.createSession('user-2', 'tenant-a', 'viewer');

      const sessions = auth.getSessionsByUser('user-1');
      expect(sessions).toHaveLength(2);
    });

    it('should revoke all sessions for a user', () => {
      auth.createSession('user-1', 'tenant-a', 'developer');
      auth.createSession('user-1', 'tenant-a', 'developer');
      const count = auth.revokeAllSessions('user-1');
      expect(count).toBe(2);
      expect(auth.getSessionsByUser('user-1')).toHaveLength(0);
    });
  });

  // ── OAuth Provider ─────────────────────────────────────────────────────

  describe('registerOAuthProvider', () => {
    it('should register an OAuth provider', () => {
      auth.registerOAuthProvider({
        provider: 'github',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['user:email'],
      });

      const providers = auth.listOAuthProviders();
      expect(providers).toContain('github');
    });

    it('should generate authorization URL', () => {
      auth.registerOAuthProvider({
        provider: 'github',
        clientId: 'my-client-id',
        clientSecret: 'secret',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['user:email'],
      });

      const url = auth.getOAuthAuthorizeUrl('github', 'state123', 'https://example.com/callback');
      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=my-client-id');
      expect(url).toContain('state=state123');
    });

    it('should return null for unregistered provider', () => {
      const url = auth.getOAuthAuthorizeUrl('google', 'state', 'https://example.com');
      expect(url).toBeNull();
    });
  });

  // ── Observables ────────────────────────────────────────────────────────

  describe('getEvents$', () => {
    it('should emit events on token generation', async () => {
      const eventPromise = firstValueFrom(auth.getEvents$().pipe(take(1)));
      auth.generateToken('user-1', 'tenant-a', 'developer');
      const event = await eventPromise;
      expect(event.type).toBe('token.generated');
      expect(event.userId).toBe('user-1');
    });

    it('should emit events on session creation', async () => {
      const eventsPromise = firstValueFrom(auth.getEvents$().pipe(take(1)));
      auth.createSession('user-1', 'tenant-a', 'developer');
      const event = await eventsPromise;
      expect(event.type).toBe('session.created');
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should complete event observable', () => {
      let completed = false;
      auth.getEvents$().subscribe({ complete: () => { completed = true; } });
      auth.destroy();
      expect(completed).toBe(true);
    });

    it('should complete sessions observable', () => {
      let completed = false;
      auth.getSessions$().subscribe({ complete: () => { completed = true; } });
      auth.destroy();
      expect(completed).toBe(true);
    });
  });
});

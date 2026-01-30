import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { AuthManager, createAuthManager } from '../auth-manager.js';
import { TokenManager, createTokenManager } from '../token-manager.js';
import { createAuthPlugin, createSyncAuthHeaders } from '../auth-plugin.js';
import type { AuthEvent, AuthProvider, AuthState, TokenPair } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers: create a minimal HS256-style JWT (unsigned, base64url only)
// The token manager only base64-decodes; it does NOT verify signatures.
// ---------------------------------------------------------------------------

function base64UrlEncode(obj: Record<string, unknown> | string): string {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  // Use Buffer in Node for tests
  const base64 = Buffer.from(str, 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(
  payload: Record<string, unknown>,
  expiresInSeconds = 3600
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };
  const headerPart = base64UrlEncode(header);
  const payloadPart = base64UrlEncode(fullPayload);
  const signaturePart = base64UrlEncode('fake-signature');
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

function createTokenPair(
  payload: Record<string, unknown>,
  expiresInSeconds = 3600
): TokenPair {
  return {
    accessToken: createJWT(payload, expiresInSeconds),
    refreshToken: 'refresh_token_123',
    expiresIn: expiresInSeconds,
    tokenType: 'Bearer',
  };
}

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function createMockProvider(
  name = 'mock',
  tokenPayload: Record<string, unknown> = {
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['user'],
  },
  expiresInSeconds = 3600
): AuthProvider & {
  authenticateMock: ReturnType<typeof vi.fn>;
  refreshMock: ReturnType<typeof vi.fn>;
  revokeMock: ReturnType<typeof vi.fn>;
} {
  const tokens = createTokenPair(tokenPayload, expiresInSeconds);

  const authenticateMock = vi.fn<(params: unknown) => Promise<TokenPair>>().mockResolvedValue(tokens);
  const refreshMock = vi.fn<(refreshToken: string) => Promise<TokenPair>>().mockResolvedValue(
    createTokenPair(tokenPayload, expiresInSeconds)
  );
  const revokeMock = vi.fn<(token: string) => Promise<void>>().mockResolvedValue(undefined);

  return {
    name,
    type: 'credentials',
    authenticate: authenticateMock,
    refresh: refreshMock,
    revoke: revokeMock,
    authenticateMock,
    refreshMock,
    revokeMock,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('TokenManager', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = createTokenManager();
  });

  describe('storeTokens / getAccessToken / getRefreshToken', () => {
    it('should store and retrieve tokens', () => {
      const tokens = createTokenPair({ sub: 'u1', roles: [] });
      tokenManager.storeTokens(tokens);

      expect(tokenManager.getAccessToken()).toBe(tokens.accessToken);
      expect(tokenManager.getRefreshToken()).toBe(tokens.refreshToken);
    });

    it('should return null when no tokens stored', () => {
      expect(tokenManager.getAccessToken()).toBeNull();
      expect(tokenManager.getRefreshToken()).toBeNull();
    });
  });

  describe('clearTokens', () => {
    it('should clear stored tokens', () => {
      const tokens = createTokenPair({ sub: 'u1', roles: [] });
      tokenManager.storeTokens(tokens);

      tokenManager.clearTokens();

      expect(tokenManager.getAccessToken()).toBeNull();
      expect(tokenManager.getRefreshToken()).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode a valid JWT payload', () => {
      const token = createJWT({
        sub: 'user-42',
        email: 'hello@world.com',
        name: 'Hello',
        roles: ['admin', 'user'],
      });

      const payload = tokenManager.decodeToken(token);

      expect(payload.sub).toBe('user-42');
      expect(payload.email).toBe('hello@world.com');
      expect(payload.name).toBe('Hello');
      expect(payload.roles).toEqual(['admin', 'user']);
      expect(payload.iat).toBeTypeOf('number');
      expect(payload.exp).toBeTypeOf('number');
    });

    it('should throw for invalid token format (missing parts)', () => {
      expect(() => tokenManager.decodeToken('not-a-jwt')).toThrow(
        'Invalid JWT format'
      );
    });

    it('should throw for token with invalid base64', () => {
      expect(() => tokenManager.decodeToken('a.!!!invalid!!!.c')).toThrow();
    });

    it('should throw for token missing required fields', () => {
      const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
      const payload = base64UrlEncode({ foo: 'bar' }); // missing sub, exp
      const sig = base64UrlEncode('sig');
      expect(() => tokenManager.decodeToken(`${header}.${payload}.${sig}`)).toThrow(
        'Invalid JWT payload'
      );
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for a non-expired token', () => {
      const token = createJWT({ sub: 'u', roles: [] }, 3600);
      expect(tokenManager.isTokenExpired(token)).toBe(false);
    });

    it('should return true for an expired token', () => {
      const token = createJWT({ sub: 'u', roles: [] }, -10); // expired 10s ago
      expect(tokenManager.isTokenExpired(token)).toBe(true);
    });

    it('should return true for an invalid token', () => {
      expect(tokenManager.isTokenExpired('invalid')).toBe(true);
    });
  });

  describe('getTokenExpiry', () => {
    it('should return expiry in milliseconds', () => {
      const token = createJWT({ sub: 'u', roles: [] }, 7200);
      const expiry = tokenManager.getTokenExpiry(token);

      // Should be roughly now + 7200 seconds (within 5s tolerance)
      const expectedMin = Date.now() + 7195 * 1000;
      const expectedMax = Date.now() + 7205 * 1000;
      expect(expiry).toBeGreaterThan(expectedMin);
      expect(expiry).toBeLessThan(expectedMax);
    });
  });

  describe('scheduleRefresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule a refresh before token expiry', async () => {
      const refreshThresholdMs = 60_000; // 1 minute
      const tm = createTokenManager({ tokenRefreshThresholdMs: refreshThresholdMs });

      // Token expires in 5 minutes
      const tokens = createTokenPair({ sub: 'u', roles: [] }, 300);
      tm.storeTokens(tokens);

      const onRefresh = vi.fn().mockResolvedValue(undefined);
      tm.scheduleRefresh(onRefresh);

      // Advance to just before refresh time (4 min = 240s; refresh at 240s)
      vi.advanceTimersByTime(230_000);
      expect(onRefresh).not.toHaveBeenCalled();

      // Advance past refresh threshold (300s - 60s = 240s from now)
      vi.advanceTimersByTime(15_000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should call refresh immediately when token is already within threshold', async () => {
      const refreshThresholdMs = 300_000; // 5 minutes
      const tm = createTokenManager({ tokenRefreshThresholdMs: refreshThresholdMs });

      // Token expires in 1 minute (within 5-minute threshold)
      const tokens = createTokenPair({ sub: 'u', roles: [] }, 60);
      tm.storeTokens(tokens);

      const onRefresh = vi.fn().mockResolvedValue(undefined);
      tm.scheduleRefresh(onRefresh);

      // Should be called immediately (within microtask)
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should not schedule refresh when no token is stored', () => {
      const tm = createTokenManager();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      tm.scheduleRefresh(onRefresh);

      vi.advanceTimersByTime(1_000_000);
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('should cancel previous refresh when scheduling a new one', () => {
      const tm = createTokenManager({ tokenRefreshThresholdMs: 60_000 });
      const tokens = createTokenPair({ sub: 'u', roles: [] }, 300);
      tm.storeTokens(tokens);

      const onRefresh1 = vi.fn().mockResolvedValue(undefined);
      const onRefresh2 = vi.fn().mockResolvedValue(undefined);

      tm.scheduleRefresh(onRefresh1);
      tm.scheduleRefresh(onRefresh2); // should cancel the first

      vi.advanceTimersByTime(300_000);

      expect(onRefresh1).not.toHaveBeenCalled();
      expect(onRefresh2).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('should clear tokens and cancel timers', () => {
      vi.useFakeTimers();

      const tm = createTokenManager();
      const tokens = createTokenPair({ sub: 'u', roles: [] }, 300);
      tm.storeTokens(tokens);

      const onRefresh = vi.fn().mockResolvedValue(undefined);
      tm.scheduleRefresh(onRefresh);

      tm.dispose();

      expect(tm.getAccessToken()).toBeNull();
      expect(tm.getRefreshToken()).toBeNull();

      vi.advanceTimersByTime(1_000_000);
      expect(onRefresh).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});

describe('AuthManager', () => {
  let authManager: AuthManager;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    authManager = createAuthManager();
    mockProvider = createMockProvider();
    authManager.registerProvider(mockProvider);
  });

  afterEach(() => {
    authManager.dispose();
  });

  describe('registerProvider', () => {
    it('should register a provider', () => {
      // Already registered in beforeEach, verify login works
      expect(authManager.isAuthenticated()).toBe(false);
    });

    it('should throw when registering duplicate provider name', () => {
      const dup = createMockProvider('mock');
      expect(() => authManager.registerProvider(dup)).toThrow(
        'Auth provider "mock" is already registered'
      );
    });
  });

  describe('login', () => {
    it('should authenticate and return auth state', async () => {
      const state = await authManager.login('mock', {
        email: 'test@example.com',
        password: 'pass',
      });

      expect(state.isAuthenticated).toBe(true);
      expect(state.user).not.toBeNull();
      expect(state.user!.id).toBe('user-1');
      expect(state.user!.email).toBe('test@example.com');
      expect(state.user!.name).toBe('Test User');
      expect(state.user!.roles).toEqual(['user']);
      expect(state.token).toBeTruthy();
      expect(state.expiresAt).toBeTypeOf('number');
    });

    it('should call provider.authenticate with params', async () => {
      const params = { email: 'a@b.com', password: 'x' };
      await authManager.login('mock', params);

      expect(mockProvider.authenticateMock).toHaveBeenCalledWith(params);
    });

    it('should throw for unknown provider', async () => {
      await expect(authManager.login('nonexistent')).rejects.toThrow(
        'Auth provider "nonexistent" is not registered'
      );
    });

    it('should emit auth:login event', async () => {
      const events: AuthEvent[] = [];
      authManager.events().subscribe((e) => events.push(e));

      await authManager.login('mock');

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('auth:login');
      if (events[0]!.type === 'auth:login') {
        expect(events[0]!.user.id).toBe('user-1');
      }
    });

    it('should emit auth:error event on failure', async () => {
      mockProvider.authenticateMock.mockRejectedValueOnce(new Error('fail'));

      const events: AuthEvent[] = [];
      authManager.events().subscribe((e) => events.push(e));

      await expect(authManager.login('mock')).rejects.toThrow('fail');

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('auth:error');
    });
  });

  describe('logout', () => {
    it('should clear auth state', async () => {
      await authManager.login('mock');
      expect(authManager.isAuthenticated()).toBe(true);

      await authManager.logout();

      expect(authManager.isAuthenticated()).toBe(false);
      expect(authManager.getUser()).toBeNull();
      expect(authManager.getToken()).toBeNull();
    });

    it('should attempt to revoke token', async () => {
      await authManager.login('mock');
      const token = authManager.getToken();

      await authManager.logout();

      expect(mockProvider.revokeMock).toHaveBeenCalledWith(token);
    });

    it('should emit auth:logout event', async () => {
      await authManager.login('mock');

      const events: AuthEvent[] = [];
      authManager.events().subscribe((e) => events.push(e));

      await authManager.logout();

      expect(events.some((e) => e.type === 'auth:logout')).toBe(true);
    });

    it('should not throw if revoke fails', async () => {
      await authManager.login('mock');
      mockProvider.revokeMock.mockRejectedValueOnce(new Error('network error'));

      await expect(authManager.logout()).resolves.not.toThrow();
      expect(authManager.isAuthenticated()).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return unauthenticated state initially', () => {
      const state = authManager.getState();

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.expiresAt).toBeNull();
      expect(state.isOffline).toBe(false);
    });

    it('should return authenticated state after login', async () => {
      await authManager.login('mock');
      const state = authManager.getState();

      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.id).toBe('user-1');
    });
  });

  describe('getUser / getToken / isAuthenticated', () => {
    it('should return null user before login', () => {
      expect(authManager.getUser()).toBeNull();
    });

    it('should return null token before login', () => {
      expect(authManager.getToken()).toBeNull();
    });

    it('should return false for isAuthenticated before login', () => {
      expect(authManager.isAuthenticated()).toBe(false);
    });

    it('should return user after login', async () => {
      await authManager.login('mock');
      const user = authManager.getUser();

      expect(user).not.toBeNull();
      expect(user!.id).toBe('user-1');
    });

    it('should return token after login', async () => {
      await authManager.login('mock');
      expect(authManager.getToken()).toBeTruthy();
    });

    it('should return true for isAuthenticated after login', async () => {
      await authManager.login('mock');
      expect(authManager.isAuthenticated()).toBe(true);
    });
  });

  describe('onAuthStateChange', () => {
    it('should emit initial state immediately', async () => {
      const state = await firstValueFrom(authManager.onAuthStateChange());

      expect(state.isAuthenticated).toBe(false);
    });

    it('should emit state changes on login and logout', async () => {
      const states: AuthState[] = [];
      const sub = authManager.onAuthStateChange().subscribe((s) => states.push(s));

      await authManager.login('mock');
      await authManager.logout();

      sub.unsubscribe();

      // Initial + login + logout = 3 states
      expect(states.length).toBeGreaterThanOrEqual(3);
      expect(states[0]!.isAuthenticated).toBe(false); // initial
      expect(states[1]!.isAuthenticated).toBe(true);  // after login
      expect(states[states.length - 1]!.isAuthenticated).toBe(false); // after logout
    });
  });

  describe('onAuthStateChange callback config', () => {
    it('should call onAuthStateChange config callback', async () => {
      const callback = vi.fn();
      const manager = createAuthManager({ onAuthStateChange: callback });
      const provider = createMockProvider();
      manager.registerProvider(provider);

      await manager.login('mock');

      expect(callback).toHaveBeenCalled();
      const lastCall = callback.mock.calls[callback.mock.calls.length - 1]![0] as AuthState;
      expect(lastCall.isAuthenticated).toBe(true);

      manager.dispose();
    });
  });

  describe('offline grace period', () => {
    it('should allow expired tokens when offline within grace period', async () => {
      // Create a manager with a long grace period
      const manager = createAuthManager({
        offlineGracePeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Create a provider with a token that expires in 1 second
      const provider = createMockProvider('mock', {
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
      }, 1);
      manager.registerProvider(provider);

      await manager.login('mock');

      // Simulate offline by mocking navigator.onLine
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        writable: true,
        configurable: true,
      });

      // Wait for token to expire
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const state = manager.getState();
      // Should still be authenticated due to offline grace period
      expect(state.isAuthenticated).toBe(true);
      expect(state.isOffline).toBe(true);

      // Restore
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });

      manager.dispose();
    });

    it('should reject expired tokens when online', async () => {
      const manager = createAuthManager({
        offlineGracePeriodMs: 7 * 24 * 60 * 60 * 1000,
      });

      const provider = createMockProvider('mock', {
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
      }, 1);
      manager.registerProvider(provider);

      await manager.login('mock');

      // Ensure online
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        writable: true,
        configurable: true,
      });

      // Wait for token to expire
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const state = manager.getState();
      expect(state.isAuthenticated).toBe(false);

      // Restore
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });

      manager.dispose();
    });
  });

  describe('auto-refresh scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule token refresh after login', async () => {
      // Provider that gives a token expiring in 10 minutes
      const provider = createMockProvider('refresh-test', {
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
      }, 600);

      const manager = createAuthManager({
        tokenRefreshThresholdMs: 60_000, // refresh 1 minute before expiry
      });
      manager.registerProvider(provider);

      await manager.login('refresh-test');

      // Advance to just before the refresh time (600s - 60s = 540s)
      expect(provider.refreshMock).not.toHaveBeenCalled();

      // Advance past the refresh threshold
      vi.advanceTimersByTime(545_000);
      // Need to flush promises
      await vi.runAllTimersAsync();

      expect(provider.refreshMock).toHaveBeenCalled();

      manager.dispose();
    });
  });

  describe('events', () => {
    it('should emit auth:login on login', async () => {
      const events: AuthEvent[] = [];
      authManager.events().subscribe((e) => events.push(e));

      await authManager.login('mock');

      const loginEvent = events.find((e) => e.type === 'auth:login');
      expect(loginEvent).toBeDefined();
      if (loginEvent?.type === 'auth:login') {
        expect(loginEvent.user.id).toBe('user-1');
      }
    });

    it('should emit auth:logout on logout', async () => {
      await authManager.login('mock');

      const events: AuthEvent[] = [];
      authManager.events().subscribe((e) => events.push(e));

      await authManager.logout();

      expect(events.some((e) => e.type === 'auth:logout')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should complete observables on dispose', async () => {
      let completed = false;
      authManager.onAuthStateChange().subscribe({
        complete: () => {
          completed = true;
        },
      });

      authManager.dispose();

      expect(completed).toBe(true);
    });

    it('should be idempotent', () => {
      authManager.dispose();
      expect(() => authManager.dispose()).not.toThrow();
    });
  });
});

describe('createAuthPlugin', () => {
  let authManager: AuthManager;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(async () => {
    authManager = createAuthManager();
    mockProvider = createMockProvider();
    authManager.registerProvider(mockProvider);
  });

  afterEach(() => {
    authManager.dispose();
  });

  it('should create a plugin with correct name', () => {
    const plugin = createAuthPlugin(authManager);
    expect(plugin.name).toBe('pocket-auth');
  });

  it('should add createdBy and updatedBy fields on insert', async () => {
    await authManager.login('mock');

    const plugin = createAuthPlugin(authManager);
    const context = {
      collection: 'todos',
      document: { title: 'Test', _id: '1' },
      timestamp: Date.now(),
    };

    const result = plugin.beforeInsert!(context as never);

    expect(result).toBeDefined();
    const doc = (result as { document: Record<string, unknown> }).document;
    expect(doc._createdBy).toBe('user-1');
    expect(doc._updatedBy).toBe('user-1');
  });

  it('should add updatedBy field on update', async () => {
    await authManager.login('mock');

    const plugin = createAuthPlugin(authManager);
    const context = {
      collection: 'todos',
      documentId: '1',
      changes: { title: 'Updated' },
      existingDocument: { _id: '1', title: 'Original' },
      timestamp: Date.now(),
    };

    const result = plugin.beforeUpdate!(context as never);

    expect(result).toBeDefined();
    const changes = (result as { changes: Record<string, unknown> }).changes;
    expect(changes._updatedBy).toBe('user-1');
  });

  it('should use custom field names', async () => {
    await authManager.login('mock');

    const plugin = createAuthPlugin(authManager, {
      createdByField: 'author',
      updatedByField: 'lastEditor',
    });

    const context = {
      collection: 'todos',
      document: { title: 'Test', _id: '1' },
      timestamp: Date.now(),
    };

    const result = plugin.beforeInsert!(context as never);
    const doc = (result as { document: Record<string, unknown> }).document;
    expect(doc.author).toBe('user-1');
    expect(doc.lastEditor).toBe('user-1');
  });

  it('should throw on insert when requireAuth is true and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: true });

    const context = {
      collection: 'todos',
      document: { title: 'Test', _id: '1' },
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeInsert!(context as never)).toThrow(
      'Authentication required'
    );
  });

  it('should not throw on insert when requireAuth is false and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: false });

    const context = {
      collection: 'todos',
      document: { title: 'Test', _id: '1' },
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeInsert!(context as never)).not.toThrow();
  });

  it('should throw on update when requireAuth is true and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: true });

    const context = {
      collection: 'todos',
      documentId: '1',
      changes: { title: 'Updated' },
      existingDocument: { _id: '1', title: 'Original' },
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeUpdate!(context as never)).toThrow(
      'Authentication required'
    );
  });

  it('should throw on delete when requireAuth is true and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: true });

    const context = {
      collection: 'todos',
      documentId: '1',
      existingDocument: null,
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeDelete!(context as never)).toThrow(
      'Authentication required'
    );
  });

  it('should throw on query when requireAuth is true and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: true });

    const context = {
      collection: 'todos',
      spec: {},
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeQuery!(context as never)).toThrow(
      'Authentication required'
    );
  });

  it('should throw on get when requireAuth is true and not authenticated', () => {
    const plugin = createAuthPlugin(authManager, { requireAuth: true });

    const context = {
      collection: 'todos',
      documentId: '1',
      timestamp: Date.now(),
    };

    expect(() => plugin.beforeGet!(context as never)).toThrow(
      'Authentication required'
    );
  });
});

describe('createSyncAuthHeaders', () => {
  it('should return auth headers when authenticated', async () => {
    const authManager = createAuthManager();
    const provider = createMockProvider();
    authManager.registerProvider(provider);

    await authManager.login('mock');

    const getHeaders = createSyncAuthHeaders(authManager);
    const headers = getHeaders();

    expect(headers.Authorization).toBeDefined();
    expect(headers.Authorization).toMatch(/^Bearer /);

    authManager.dispose();
  });

  it('should return empty headers when not authenticated', () => {
    const authManager = createAuthManager();

    const getHeaders = createSyncAuthHeaders(authManager);
    const headers = getHeaders();

    expect(headers.Authorization).toBeUndefined();
    expect(Object.keys(headers)).toHaveLength(0);

    authManager.dispose();
  });
});

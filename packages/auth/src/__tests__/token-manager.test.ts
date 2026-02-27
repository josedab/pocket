import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenManager, createTokenManager } from '../token-manager.js';

function base64UrlEncode(str: string): string {
  const base64 = Buffer.from(str, 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(payload: Record<string, unknown>, expiresInSeconds = 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(fullPayload));
  const signaturePart = base64UrlEncode('fake-signature');
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

describe('TokenManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('storeTokens / getAccessToken / getRefreshToken', () => {
    it('should store and retrieve tokens', () => {
      const tm = new TokenManager();
      const accessToken = createJWT({ sub: 'user-1', roles: ['admin'] });
      const refreshToken = 'refresh-token-123';

      tm.storeTokens({
        accessToken,
        refreshToken,
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      expect(tm.getAccessToken()).toBe(accessToken);
      expect(tm.getRefreshToken()).toBe(refreshToken);
    });

    it('should return null when no tokens stored', () => {
      const tm = new TokenManager();

      expect(tm.getAccessToken()).toBeNull();
      expect(tm.getRefreshToken()).toBeNull();
    });
  });

  describe('clearTokens', () => {
    it('should clear all tokens', () => {
      const tm = new TokenManager();
      tm.storeTokens({
        accessToken: createJWT({ sub: 'u', roles: [] }),
        refreshToken: 'refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      tm.clearTokens();

      expect(tm.getAccessToken()).toBeNull();
      expect(tm.getRefreshToken()).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode a valid JWT payload', () => {
      const tm = new TokenManager();
      const token = createJWT({
        sub: 'user-1',
        email: 'alice@test.com',
        name: 'Alice',
        roles: ['admin'],
      });

      const payload = tm.decodeToken(token);

      expect(payload.sub).toBe('user-1');
      expect(payload.email).toBe('alice@test.com');
      expect(payload.roles).toContain('admin');
    });

    it('should throw on invalid JWT format (not 3 parts)', () => {
      const tm = new TokenManager();

      expect(() => tm.decodeToken('not-a-jwt')).toThrow('Invalid JWT format');
      expect(() => tm.decodeToken('two.parts')).toThrow('Invalid JWT format');
    });

    it('should throw on invalid payload', () => {
      const tm = new TokenManager();
      const header = base64UrlEncode(JSON.stringify({ alg: 'HS256' }));
      // payload missing required fields
      const payload = base64UrlEncode(JSON.stringify({ foo: 'bar' }));
      const token = `${header}.${payload}.sig`;

      expect(() => tm.decodeToken(token)).toThrow('Invalid JWT payload');
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for non-expired token', () => {
      const tm = new TokenManager();
      const token = createJWT({ sub: 'u', roles: [] }, 3600);

      expect(tm.isTokenExpired(token)).toBe(false);
    });

    it('should return true for expired token', () => {
      const tm = new TokenManager();
      const token = createJWT({ sub: 'u', roles: [] }, -10);

      expect(tm.isTokenExpired(token)).toBe(true);
    });

    it('should return true for malformed token', () => {
      const tm = new TokenManager();

      expect(tm.isTokenExpired('invalid')).toBe(true);
    });
  });

  describe('getTokenExpiry', () => {
    it('should return expiry timestamp in milliseconds', () => {
      const tm = new TokenManager();
      const token = createJWT({ sub: 'u', roles: [] }, 3600);

      const expiry = tm.getTokenExpiry(token);
      const now = Date.now();

      expect(expiry).toBeGreaterThan(now);
      expect(expiry).toBeLessThanOrEqual(now + 3600 * 1000 + 1000);
    });
  });

  describe('scheduleRefresh', () => {
    it('should schedule refresh before expiry', () => {
      vi.useFakeTimers();
      const tm = new TokenManager({ tokenRefreshThresholdMs: 60000 });
      const token = createJWT({ sub: 'u', roles: [] }, 3600);
      tm.storeTokens({
        accessToken: token,
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      let refreshCalled = false;
      tm.scheduleRefresh(async () => {
        refreshCalled = true;
      });

      // Advance to near expiry (3600s - 60s = 3540s)
      vi.advanceTimersByTime(3540 * 1000 + 100);

      expect(refreshCalled).toBe(true);
    });

    it('should refresh immediately when token is within threshold', () => {
      const tm = new TokenManager({ tokenRefreshThresholdMs: 300000 }); // 5 min threshold
      const token = createJWT({ sub: 'u', roles: [] }, 60); // expires in 60s
      tm.storeTokens({
        accessToken: token,
        refreshToken: 'r',
        expiresIn: 60,
        tokenType: 'Bearer',
      });

      let refreshCalled = false;
      tm.scheduleRefresh(async () => {
        refreshCalled = true;
      });

      // Should be called immediately since 60s < 5min threshold
      expect(refreshCalled).toBe(true);
    });

    it('should not schedule when no access token', () => {
      const tm = new TokenManager();

      // Should not throw
      tm.scheduleRefresh(async () => {});
    });

    it('should cancel previous schedule', () => {
      vi.useFakeTimers();
      const tm = new TokenManager({ tokenRefreshThresholdMs: 60000 });
      const token = createJWT({ sub: 'u', roles: [] }, 3600);
      tm.storeTokens({
        accessToken: token,
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      let callCount = 0;
      tm.scheduleRefresh(async () => {
        callCount++;
      });
      tm.scheduleRefresh(async () => {
        callCount++;
      });

      vi.advanceTimersByTime(4000 * 1000);

      expect(callCount).toBe(1);
    });
  });

  describe('cancelScheduledRefresh', () => {
    it('should cancel scheduled refresh', () => {
      vi.useFakeTimers();
      const tm = new TokenManager({ tokenRefreshThresholdMs: 60000 });
      const token = createJWT({ sub: 'u', roles: [] }, 3600);
      tm.storeTokens({
        accessToken: token,
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      let refreshCalled = false;
      tm.scheduleRefresh(async () => {
        refreshCalled = true;
      });
      tm.cancelScheduledRefresh();

      vi.advanceTimersByTime(4000 * 1000);

      expect(refreshCalled).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should clear tokens and cancel timers', () => {
      const tm = new TokenManager();
      tm.storeTokens({
        accessToken: createJWT({ sub: 'u', roles: [] }),
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      tm.dispose();

      expect(tm.getAccessToken()).toBeNull();
      expect(tm.getRefreshToken()).toBeNull();
    });
  });

  describe('factory function', () => {
    it('should create token manager via createTokenManager', () => {
      const tm = createTokenManager();
      expect(tm).toBeInstanceOf(TokenManager);
    });

    it('should accept config', () => {
      const tm = createTokenManager({ tokenRefreshThresholdMs: 120000 });
      expect(tm).toBeInstanceOf(TokenManager);
    });
  });

  describe('edge cases', () => {
    it('should handle scheduleRefresh with expired access token', () => {
      const tm = new TokenManager({ tokenRefreshThresholdMs: 60000 });
      const expiredToken = createJWT({ sub: 'u', roles: [] }, -100); // already expired
      tm.storeTokens({
        accessToken: expiredToken,
        refreshToken: 'r',
        expiresIn: -100,
        tokenType: 'Bearer',
      });

      let refreshCalled = false;
      tm.scheduleRefresh(async () => {
        refreshCalled = true;
      });

      // Should refresh immediately since token is already past threshold
      expect(refreshCalled).toBe(true);
    });

    it('should handle scheduleRefresh with malformed access token', () => {
      const tm = new TokenManager();
      tm.storeTokens({
        accessToken: 'not-a-jwt',
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      // Should not throw - gracefully handles decode failure
      tm.scheduleRefresh(async () => {});
    });

    it('should handle rapid concurrent scheduleRefresh calls', () => {
      vi.useFakeTimers();
      const tm = new TokenManager({ tokenRefreshThresholdMs: 60000 });
      const token = createJWT({ sub: 'u', roles: [] }, 3600);
      tm.storeTokens({
        accessToken: token,
        refreshToken: 'r',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      let callCount = 0;
      // Schedule 3 times rapidly - only last should fire
      tm.scheduleRefresh(async () => {
        callCount++;
      });
      tm.scheduleRefresh(async () => {
        callCount++;
      });
      tm.scheduleRefresh(async () => {
        callCount++;
      });

      vi.advanceTimersByTime(4000 * 1000);

      expect(callCount).toBe(1);
    });

    it('should handle storeTokens overwriting previous tokens', () => {
      const tm = new TokenManager();
      const token1 = createJWT({ sub: 'user-1', roles: [] });
      const token2 = createJWT({ sub: 'user-2', roles: [] });

      tm.storeTokens({
        accessToken: token1,
        refreshToken: 'r1',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });
      tm.storeTokens({
        accessToken: token2,
        refreshToken: 'r2',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      expect(tm.getAccessToken()).toBe(token2);
      expect(tm.getRefreshToken()).toBe('r2');

      const decoded = tm.decodeToken(tm.getAccessToken()!);
      expect(decoded.sub).toBe('user-2');
    });
  });
});

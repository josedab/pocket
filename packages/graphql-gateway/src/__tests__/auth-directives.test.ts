import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthDirectiveHandler,
  createAuthDirectiveHandler,
} from '../auth-directives.js';
import type {
  UserContext,
  FieldDirective,
  MiddlewareContext,
} from '../auth-directives.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a fake JWT from a payload object (header.payload.signature). */
function fakeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

/** A valid payload whose expiry is far in the future. */
function validPayload(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { sub: 'user-1', roles: ['admin', 'editor'], iat: now, exp: now + 3600 };
}

/** A payload whose expiry is in the past. */
function expiredPayload(): Record<string, unknown> {
  const past = Math.floor(Date.now() / 1000) - 7200;
  return { sub: 'user-2', roles: ['viewer'], iat: past - 3600, exp: past };
}

/* ================================================================== */
/*  AuthDirectiveHandler                                               */
/* ================================================================== */

describe('AuthDirectiveHandler', () => {
  let handler: AuthDirectiveHandler;

  beforeEach(() => {
    handler = createAuthDirectiveHandler({ jwtSecret: 'test-secret' });
  });

  /* ---------------------------------------------------------------- */
  /*  Factory                                                          */
  /* ---------------------------------------------------------------- */

  describe('createAuthDirectiveHandler', () => {
    it('returns an AuthDirectiveHandler instance', () => {
      expect(handler).toBeInstanceOf(AuthDirectiveHandler);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  validateToken                                                     */
  /* ---------------------------------------------------------------- */

  describe('validateToken', () => {
    it('decodes a valid token and returns UserContext', () => {
      const token = fakeToken(validPayload());
      const user = handler.validateToken(token);

      expect(user.userId).toBe('user-1');
      expect(user.roles).toEqual(['admin', 'editor']);
      expect(user.issuedAt).toBeGreaterThan(0);
      expect(user.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws for an expired token', () => {
      const token = fakeToken(expiredPayload());
      expect(() => handler.validateToken(token)).toThrow('token has expired');
    });

    it('throws for an invalid token format', () => {
      expect(() => handler.validateToken('not-a-jwt')).toThrow('invalid token format');
    });

    it('throws for an empty token', () => {
      expect(() => handler.validateToken('')).toThrow('token is required');
    });

    it('falls back to defaults when optional fields are missing', () => {
      const token = fakeToken({ sub: 'u1' });
      const user = handler.validateToken(token);

      expect(user.userId).toBe('u1');
      expect(user.roles).toEqual(['viewer']);
      expect(user.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  /* ---------------------------------------------------------------- */
  /*  checkRoles                                                        */
  /* ---------------------------------------------------------------- */

  describe('checkRoles', () => {
    const adminUser: UserContext = {
      userId: 'u1',
      roles: ['admin'],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    };

    const viewerUser: UserContext = {
      userId: 'u2',
      roles: ['viewer'],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    };

    it('allows when user has a required role', () => {
      expect(() => handler.checkRoles(adminUser, ['admin', 'editor'])).not.toThrow();
    });

    it('rejects when user lacks all required roles', () => {
      expect(() => handler.checkRoles(viewerUser, ['admin', 'editor'])).toThrow(
        'does not have any of the required roles',
      );
    });

    it('allows when requiredRoles is empty', () => {
      expect(() => handler.checkRoles(viewerUser, [])).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  checkRateLimit                                                    */
  /* ---------------------------------------------------------------- */

  describe('checkRateLimit', () => {
    it('allows requests within the limit', () => {
      expect(handler.checkRateLimit('key1', 3)).toBe(true);
      expect(handler.checkRateLimit('key1', 3)).toBe(true);
      expect(handler.checkRateLimit('key1', 3)).toBe(true);
    });

    it('rejects requests exceeding the limit', () => {
      handler.checkRateLimit('key2', 2);
      handler.checkRateLimit('key2', 2);
      expect(handler.checkRateLimit('key2', 2)).toBe(false);
    });

    it('uses default limit when max is not provided', () => {
      // default max is 100 — first call should be fine
      expect(handler.checkRateLimit('key3')).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  clearRateLimits                                                   */
  /* ---------------------------------------------------------------- */

  describe('clearRateLimits', () => {
    it('resets all counters so previously exhausted keys are allowed again', () => {
      handler.checkRateLimit('key4', 1);
      expect(handler.checkRateLimit('key4', 1)).toBe(false);

      handler.clearRateLimits();

      expect(handler.checkRateLimit('key4', 1)).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  buildMiddlewareChain                                              */
  /* ---------------------------------------------------------------- */

  describe('buildMiddlewareChain', () => {
    it('creates a working middleware chain', () => {
      const directives: FieldDirective[] = [{ directive: 'auth' }];
      const chain = handler.buildMiddlewareChain(directives);

      const result = chain({
        token: fakeToken(validPayload()),
        fieldName: 'testField',
      });

      expect(result.allowed).toBe(true);
      expect(result.user?.userId).toBe('user-1');
    });

    it('executes directives in order (auth → roles → rateLimit)', () => {
      const directives: FieldDirective[] = [
        { directive: 'auth' },
        { directive: 'roles', args: { roles: ['admin'] } },
        { directive: 'rateLimit', args: { max: 1000, window: 60000 } },
      ];

      const chain = handler.buildMiddlewareChain(directives);
      const result = chain({
        token: fakeToken(validPayload()),
        fieldName: 'protectedField',
      });

      expect(result.allowed).toBe(true);
      expect(result.user?.roles).toContain('admin');
    });

    it('short-circuits when auth fails', () => {
      const directives: FieldDirective[] = [
        { directive: 'auth' },
        { directive: 'roles', args: { roles: ['admin'] } },
      ];

      const chain = handler.buildMiddlewareChain(directives);
      const result = chain({ token: '', fieldName: 'f' });

      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('short-circuits when roles check fails', () => {
      const directives: FieldDirective[] = [
        { directive: 'auth' },
        { directive: 'roles', args: { roles: ['admin'] } },
      ];

      // viewer-only token
      const token = fakeToken({
        sub: 'viewer-user',
        roles: ['viewer'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const chain = handler.buildMiddlewareChain(directives);
      const result = chain({ token, fieldName: 'f' });

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('does not have any of the required roles');
    });

    it('short-circuits when rate limit is exceeded', () => {
      const directives: FieldDirective[] = [
        { directive: 'auth' },
        { directive: 'rateLimit', args: { max: 1, window: 60000 } },
      ];

      const token = fakeToken(validPayload());
      const chain = handler.buildMiddlewareChain(directives);

      const ctx: MiddlewareContext = { token, fieldName: 'limited' };

      // First call succeeds
      expect(chain(ctx).allowed).toBe(true);
      // Second call exceeds limit
      expect(chain(ctx).allowed).toBe(false);
    });
  });
});

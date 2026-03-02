import { describe, expect, it, vi } from 'vitest';
import {
  extractUser,
  requireRole,
  verifyToken,
  type AuthRequest,
  type AuthResponse,
} from '../middleware.js';

// HS256 JWT creation using Web Crypto API for actual signature verification
async function createSignedJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 3600
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };

  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerPart}.${payloadPart}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const signaturePart = base64UrlEncodeBuffer(new Uint8Array(signature));

  return `${data}.${signaturePart}`;
}

function base64UrlEncode(str: string): string {
  const base64 = Buffer.from(str, 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeBuffer(buf: Uint8Array): string {
  const base64 = Buffer.from(buf).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createMockResponse(): AuthResponse & { statusCode: number; body: unknown } {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
    },
  };
  return res;
}

const TEST_SECRET = 'test-secret-key-for-jwt-signing';

describe('verifyToken middleware', () => {
  it('should attach user to request for valid token', async () => {
    const token = await createSignedJWT(
      { sub: 'user-1', email: 'alice@test.com', name: 'Alice', roles: ['admin'] },
      TEST_SECRET
    );

    const req: AuthRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.id).toBe('user-1');
    expect(req.user!.email).toBe('alice@test.com');
    expect(req.user!.roles).toContain('admin');
  });

  it('should reject request without authorization header', async () => {
    const req: AuthRequest = { headers: {} };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as any).error).toContain('required');
  });

  it('should reject expired token', async () => {
    const token = await createSignedJWT(
      { sub: 'user-1', roles: [] },
      TEST_SECRET,
      -10 // expired 10 seconds ago
    );

    const req: AuthRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as any).error).toContain('expired');
  });

  it('should reject malformed token', async () => {
    const req: AuthRequest = {
      headers: { authorization: 'Bearer not.a.valid.jwt.token' },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('should reject token signed with wrong secret', async () => {
    const token = await createSignedJWT({ sub: 'user-1', roles: [] }, 'wrong-secret');

    const req: AuthRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('should reject non-HS256 algorithm', async () => {
    // Manually craft a token with RS256 header
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64UrlEncode(
      JSON.stringify({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, roles: [] })
    );
    const token = `${header}.${payload}.fake-sig`;

    const req: AuthRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('should handle empty bearer token', async () => {
    const req: AuthRequest = {
      headers: { authorization: 'Bearer ' },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await verifyToken(TEST_SECRET)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('extractUser', () => {
  it('should return user from authenticated request', () => {
    const req: AuthRequest = {
      headers: {},
      user: { id: 'user-1', email: 'a@b.com', name: 'Alice', roles: ['admin'] },
    };

    expect(extractUser(req)).toEqual(req.user);
  });

  it('should return null for unauthenticated request', () => {
    const req: AuthRequest = { headers: {} };
    expect(extractUser(req)).toBeNull();
  });
});

describe('requireRole middleware', () => {
  it('should allow user with matching role', () => {
    const req: AuthRequest = {
      headers: {},
      user: { id: 'user-1', email: 'a@b.com', name: 'Alice', roles: ['admin'] },
    };
    const res = createMockResponse();
    const next = vi.fn();

    requireRole(['admin'])(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should allow user with one of multiple required roles', () => {
    const req: AuthRequest = {
      headers: {},
      user: { id: 'user-1', email: 'a@b.com', name: 'Alice', roles: ['editor'] },
    };
    const res = createMockResponse();
    const next = vi.fn();

    requireRole(['admin', 'editor'])(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should reject user without required role', () => {
    const req: AuthRequest = {
      headers: {},
      user: { id: 'user-1', email: 'a@b.com', name: 'Alice', roles: ['viewer'] },
    };
    const res = createMockResponse();
    const next = vi.fn();

    requireRole(['admin'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('should reject unauthenticated user', () => {
    const req: AuthRequest = { headers: {} };
    const res = createMockResponse();
    const next = vi.fn();

    requireRole(['admin'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

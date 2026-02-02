/**
 * Server-side Auth Middleware
 *
 * Provides Express-compatible middleware functions for token verification,
 * user extraction, and role-based access control. Designed for use with
 * @pocket/server or any Express-compatible HTTP server.
 */

import type { AuthUser, JWTPayload } from './types.js';

/**
 * Minimal request interface compatible with Express and other HTTP frameworks.
 */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  /** User attached by auth middleware */
  user?: AuthUser;
}

/**
 * Minimal response interface compatible with Express.
 */
export interface AuthResponse {
  status(code: number): AuthResponse;
  json(body: unknown): void;
}

/**
 * Express-compatible next function.
 */
export type NextFunction = (error?: unknown) => void;

/**
 * Middleware function type.
 */
export type AuthMiddleware = (
  req: AuthRequest,
  res: AuthResponse,
  next: NextFunction
) => void | Promise<void>;

/**
 * HMAC-SHA256 signature verification using Web Crypto API.
 *
 * @param data - The data that was signed (header.payload)
 * @param signature - The signature to verify (base64url encoded)
 * @param secret - The HMAC secret key
 * @returns Whether the signature is valid
 */
async function verifyHS256Signature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();

  // Import the secret key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Decode the signature from base64url
  let base64 = signature.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = base64.length % 4;
  if (paddingNeeded === 2) {
    base64 += '==';
  } else if (paddingNeeded === 3) {
    base64 += '=';
  }

  let signatureBytes: Uint8Array;
  if (typeof atob === 'function') {
    const binary = atob(base64);
    signatureBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      signatureBytes[i] = binary.charCodeAt(i);
    }
  } else {
    signatureBytes = new Uint8Array(Buffer.from(base64, 'base64'));
  }

  // Verify the signature
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(data)
  );
}

/**
 * Base64url decode a string.
 */
function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = base64.length % 4;
  if (paddingNeeded === 2) {
    base64 += '==';
  } else if (paddingNeeded === 3) {
    base64 += '=';
  }

  if (typeof atob === 'function') {
    return atob(base64);
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Decode and verify a JWT token with an HMAC-SHA256 secret.
 *
 * @param token - The JWT token string
 * @param secret - The HMAC secret for signature verification
 * @returns The decoded payload if valid
 * @throws Error if the token is invalid, expired, or signature verification fails
 */
async function decodeAndVerifyToken(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error('Invalid token format');
  }

  // Verify the header indicates HS256
  const header = JSON.parse(base64UrlDecode(headerPart)) as { alg: string; typ: string };
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}. Only HS256 is supported.`);
  }

  // Verify signature
  const data = `${headerPart}.${payloadPart}`;
  const isValid = await verifyHS256Signature(data, signaturePart, secret);

  if (!isValid) {
    throw new Error('Invalid token signature');
  }

  // Decode payload
  const payload = JSON.parse(base64UrlDecode(payloadPart)) as JWTPayload;

  // Check expiration
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error('Token has expired');
  }

  return payload;
}

/**
 * Extract the Bearer token from the Authorization header.
 *
 * @param req - The request object
 * @returns The token string, or null if not present
 */
function extractBearerToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization ?? req.headers.Authorization;

  if (!authHeader) {
    return null;
  }

  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headerValue);
  return match?.[1] ?? null;
}

/**
 * Create a token verification middleware.
 *
 * Extracts the Bearer token from the Authorization header, verifies the
 * HMAC-SHA256 signature, checks expiration, and attaches the decoded
 * user to `req.user`.
 *
 * @param secret - The HMAC-SHA256 secret for token verification
 * @returns Express-compatible middleware function
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { verifyToken } from '@pocket/auth';
 *
 * const app = express();
 * app.use('/api', verifyToken('my-jwt-secret'));
 *
 * app.get('/api/profile', (req, res) => {
 *   res.json({ user: req.user });
 * });
 * ```
 */
export function verifyToken(secret: string): AuthMiddleware {
  return async (req: AuthRequest, res: AuthResponse, next: NextFunction) => {
    const token = extractBearerToken(req);

    if (!token) {
      res.status(401).json({ error: 'Authorization token is required' });
      return;
    }

    try {
      const payload = await decodeAndVerifyToken(token, secret);
      req.user = extractUserFromPayload(payload);
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      res.status(401).json({ error: message });
    }
  };
}

/**
 * Extract user information from a request that has been through verifyToken middleware.
 *
 * @param req - The request object (must have been processed by verifyToken)
 * @returns The AuthUser, or null if not authenticated
 */
export function extractUser(req: AuthRequest): AuthUser | null {
  return req.user ?? null;
}

/**
 * Create a role-based access control middleware.
 *
 * Requires the request to have been processed by verifyToken first.
 * Checks that the authenticated user has at least one of the required roles.
 *
 * @param roles - Array of role names, user must have at least one
 * @returns Express-compatible middleware function
 *
 * @example
 * ```typescript
 * app.delete('/api/users/:id',
 *   verifyToken('secret'),
 *   requireRole(['admin']),
 *   (req, res) => {
 *     // Only admins reach here
 *     res.json({ deleted: true });
 *   }
 * );
 * ```
 */
export function requireRole(roles: string[]): AuthMiddleware {
  return (req: AuthRequest, res: AuthResponse, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasRole = user.roles.some((role) => roles.includes(role));

    if (!hasRole) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        userRoles: user.roles,
      });
      return;
    }

    next();
  };
}

/**
 * Extract an AuthUser from a decoded JWT payload.
 *
 * @param payload - The decoded JWT payload
 * @returns AuthUser object
 */
function extractUserFromPayload(payload: JWTPayload): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    roles: payload.roles ?? [],
  };
}

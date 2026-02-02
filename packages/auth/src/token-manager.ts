/**
 * Token Manager - Securely stores and manages JWT tokens
 *
 * Handles token storage, decoding (base64 only - verification is server-side),
 * expiry checking, and auto-refresh scheduling.
 */

import type { AuthConfig, JWTPayload, TokenPair } from './types.js';

/**
 * Default refresh threshold: 5 minutes before expiry
 */
const DEFAULT_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Base64url decode a string to a regular string.
 * Handles the URL-safe base64 variant used in JWTs.
 */
function base64UrlDecode(input: string): string {
  // Replace URL-safe characters with standard base64 characters
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  const paddingNeeded = base64.length % 4;
  if (paddingNeeded === 2) {
    base64 += '==';
  } else if (paddingNeeded === 3) {
    base64 += '=';
  }

  // Decode using atob (available in browsers and Node 16+)
  // For environments without atob, fall back to Buffer
  if (typeof atob === 'function') {
    return atob(base64);
  }

  // Node.js fallback
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Manages JWT token storage, decoding, and refresh scheduling.
 *
 * Tokens are stored in memory by default. The manager does NOT perform
 * cryptographic verification - that is the server's responsibility.
 * It only performs base64 decoding to read token claims.
 *
 * @example
 * ```typescript
 * const tokenManager = createTokenManager({ tokenRefreshThresholdMs: 60000 });
 *
 * tokenManager.storeTokens({
 *   accessToken: 'eyJ...',
 *   refreshToken: 'refresh_...',
 *   expiresIn: 3600,
 *   tokenType: 'Bearer',
 * });
 *
 * const payload = tokenManager.decodeToken(tokenManager.getAccessToken()!);
 * console.log(payload.sub); // user ID
 * ```
 */
export class TokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly refreshThresholdMs: number;

  constructor(config?: Pick<AuthConfig, 'tokenRefreshThresholdMs'>) {
    this.refreshThresholdMs = config?.tokenRefreshThresholdMs ?? DEFAULT_REFRESH_THRESHOLD_MS;
  }

  /**
   * Store a token pair (access + refresh tokens).
   */
  storeTokens(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  /**
   * Get the current access token, or null if not stored.
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Get the current refresh token, or null if not stored.
   */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /**
   * Clear all stored tokens and cancel any scheduled refresh.
   */
  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.cancelScheduledRefresh();
  }

  /**
   * Check if a JWT token has expired.
   *
   * @param token - The JWT access token to check
   * @returns true if the token is expired
   */
  isTokenExpired(token: string): boolean {
    try {
      const expiry = this.getTokenExpiry(token);
      return Date.now() >= expiry;
    } catch {
      // If we cannot decode the token, consider it expired
      return true;
    }
  }

  /**
   * Get the expiry timestamp of a JWT token in milliseconds.
   *
   * @param token - The JWT access token
   * @returns Expiry timestamp in milliseconds since epoch
   * @throws Error if the token cannot be decoded
   */
  getTokenExpiry(token: string): number {
    const payload = this.decodeToken(token);
    // JWT exp is in seconds, convert to milliseconds
    return payload.exp * 1000;
  }

  /**
   * Decode a JWT token payload without cryptographic verification.
   *
   * This performs base64url decoding only. The token signature is NOT
   * verified - that must be done server-side with the signing secret.
   *
   * @param token - The JWT token string
   * @returns The decoded JWT payload
   * @throws Error if the token format is invalid
   */
  decodeToken(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format: expected 3 parts separated by dots');
    }

    const payloadPart = parts[1];
    if (!payloadPart) {
      throw new Error('Invalid JWT format: missing payload');
    }

    try {
      const decoded = base64UrlDecode(payloadPart);
      const payload = JSON.parse(decoded) as JWTPayload;

      if (!payload.sub || typeof payload.exp !== 'number') {
        throw new Error('Invalid JWT payload: missing required fields (sub, exp)');
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid JWT')) {
        throw error;
      }
      throw new Error(`Failed to decode JWT payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Schedule an automatic token refresh before the access token expires.
   *
   * The refresh is scheduled to occur `tokenRefreshThresholdMs` milliseconds
   * before the token expires. If the token is already within the refresh
   * threshold, the refresh callback is invoked immediately.
   *
   * @param onRefresh - Async callback to perform the token refresh
   */
  scheduleRefresh(onRefresh: () => Promise<void>): void {
    this.cancelScheduledRefresh();

    if (!this.accessToken) {
      return;
    }

    try {
      const expiryMs = this.getTokenExpiry(this.accessToken);
      const now = Date.now();
      const refreshAt = expiryMs - this.refreshThresholdMs;
      const delay = refreshAt - now;

      if (delay <= 0) {
        // Token is already within the refresh window, refresh immediately
        void onRefresh();
      } else {
        this.refreshTimer = setTimeout(() => {
          void onRefresh();
        }, delay);
      }
    } catch {
      // Cannot decode token; do not schedule refresh
    }
  }

  /**
   * Cancel any previously scheduled refresh timer.
   */
  cancelScheduledRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Clean up resources (cancel timers).
   */
  dispose(): void {
    this.clearTokens();
  }
}

/**
 * Create a new TokenManager instance.
 *
 * @param config - Optional configuration for refresh threshold
 * @returns A new TokenManager
 */
export function createTokenManager(
  config?: Pick<AuthConfig, 'tokenRefreshThresholdMs'>
): TokenManager {
  return new TokenManager(config);
}

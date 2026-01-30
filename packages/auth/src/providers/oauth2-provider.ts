/**
 * OAuth2 Provider - Implements OAuth2 Authorization Code Flow with PKCE
 *
 * Provides a secure OAuth2 authentication flow suitable for public clients
 * (SPAs, mobile apps). Uses PKCE (Proof Key for Code Exchange) to prevent
 * authorization code interception attacks.
 */

import type { AuthProvider, OAuth2Config, TokenPair } from '../types.js';

/**
 * Generate a cryptographically random string for PKCE code_verifier.
 * Uses Web Crypto API when available, falls back to Math.random.
 *
 * @param length - Length of the verifier (default: 64)
 * @returns Random URL-safe string
 */
function generateCodeVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map((byte) => chars[byte % chars.length])
      .join('');
  }

  // Fallback for environments without Web Crypto
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)] ?? '';
  }
  return result;
}

/**
 * Generate a PKCE code_challenge from a code_verifier using SHA-256.
 *
 * @param verifier - The code_verifier string
 * @returns Base64url-encoded SHA-256 hash of the verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hash);

    // Base64url encode
    let binary = '';
    for (const byte of hashArray) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // If no Web Crypto, fall back to plain challenge (less secure)
  return verifier;
}

/**
 * Parameters for the OAuth2 authenticate call.
 * If a code is provided, it exchanges the code for tokens.
 * Otherwise, it generates the authorization URL for the client to navigate to.
 */
interface OAuth2AuthenticateParams {
  /** Authorization code from the OAuth2 callback */
  code?: string;
  /** State parameter for CSRF protection */
  state?: string;
}

/**
 * OAuth2 authentication provider implementing the Authorization Code Flow with PKCE.
 *
 * Usage:
 * 1. Call authenticate() without a code to get the authorization URL
 * 2. Redirect the user to the authorization URL
 * 3. Handle the callback and call handleCallback(code) to exchange the code for tokens
 *
 * @example
 * ```typescript
 * const oauth2 = createOAuth2Provider({
 *   clientId: 'my-app',
 *   authorizationUrl: 'https://auth.example.com/authorize',
 *   tokenUrl: 'https://auth.example.com/token',
 *   redirectUrl: 'https://myapp.com/callback',
 *   scopes: ['openid', 'profile', 'email'],
 *   provider: 'custom',
 * });
 *
 * // Step 1: Get authorization URL
 * const tokens = await oauth2.authenticate({});
 * // tokens.accessToken contains the authorization URL as a signal
 *
 * // Step 2: After redirect, exchange code
 * const authTokens = await oauth2.handleCallback('auth_code_here');
 * ```
 */
export class OAuth2Provider implements AuthProvider {
  readonly name: string;
  readonly type = 'oauth2' as const;

  private readonly config: OAuth2Config;
  private codeVerifier: string | null = null;
  private state: string | null = null;

  constructor(config: OAuth2Config) {
    this.config = config;
    this.name = `oauth2:${config.provider}`;
  }

  /**
   * Start the OAuth2 PKCE flow.
   *
   * When called without a code, generates the authorization URL and returns
   * a special TokenPair where accessToken contains the URL to navigate to.
   *
   * When called with a code (from the OAuth2 callback), exchanges it for tokens.
   *
   * @param params - Optional OAuth2AuthenticateParams with code and state
   * @returns TokenPair (real tokens if code provided, or URL signal if not)
   */
  async authenticate(params: unknown): Promise<TokenPair> {
    const oauthParams = (params ?? {}) as OAuth2AuthenticateParams;

    if (oauthParams.code) {
      return this.handleCallback(oauthParams.code);
    }

    // Generate PKCE parameters
    this.codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(this.codeVerifier);
    this.state = generateCodeVerifier(32);

    // Build authorization URL
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUrl);
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', this.state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    // Return the URL in a special format - the app is responsible
    // for navigating to this URL
    return {
      accessToken: url.toString(),
      refreshToken: '',
      expiresIn: 0,
      tokenType: 'Bearer',
    };
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * @param code - The authorization code from the OAuth2 callback
   * @returns TokenPair with access and refresh tokens
   * @throws Error if no PKCE flow was initiated or the token exchange fails
   */
  async handleCallback(code: string): Promise<TokenPair> {
    if (!this.codeVerifier) {
      throw new Error('No PKCE flow initiated. Call authenticate() first.');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUrl,
      client_id: this.config.clientId,
      code_verifier: this.codeVerifier,
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OAuth2 token exchange failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    // Clear PKCE state after successful exchange
    this.codeVerifier = null;
    this.state = null;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresIn: data.expires_in,
      tokenType: 'Bearer',
    };
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New TokenPair with fresh access and refresh tokens
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OAuth2 token refresh failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresIn: data.expires_in,
      tokenType: 'Bearer',
    };
  }

  /**
   * Revoke a token (access or refresh).
   *
   * Attempts to revoke the token at the provider's token endpoint.
   * If the provider does not support revocation, this is a no-op.
   *
   * @param token - The token to revoke
   */
  async revoke(token: string): Promise<void> {
    // Use the token URL base to construct a revocation endpoint
    const revocationUrl = this.config.tokenUrl.replace('/token', '/revoke');

    const body = new URLSearchParams({
      token,
      client_id: this.config.clientId,
    });

    try {
      await fetch(revocationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch {
      // Token revocation is best-effort
    }
  }

  /**
   * Get the current PKCE state parameter for validation.
   */
  getState(): string | null {
    return this.state;
  }
}

/**
 * Create an OAuth2 authentication provider.
 *
 * @param config - OAuth2 configuration
 * @returns A new OAuth2Provider instance
 */
export function createOAuth2Provider(config: OAuth2Config): OAuth2Provider {
  return new OAuth2Provider(config);
}

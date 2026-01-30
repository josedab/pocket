/**
 * Credentials Provider - Email/password authentication
 *
 * Simple credentials-based authentication that posts to login/register
 * endpoints and receives JWT tokens in response.
 */

import type { AuthProvider, CredentialsConfig, TokenPair } from '../types.js';

/**
 * Parameters for credentials authentication (login)
 */
interface CredentialsLoginParams {
  email: string;
  password: string;
}

/**
 * Parameters for credentials registration
 */
interface CredentialsRegisterParams {
  email: string;
  password: string;
  name?: string;
}

/**
 * Server response for auth endpoints
 */
interface CredentialsTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Email/password credentials authentication provider.
 *
 * Authenticates users by posting credentials to a login endpoint and
 * receiving JWT tokens. Also supports user registration via a separate
 * endpoint.
 *
 * @example
 * ```typescript
 * const credentials = createCredentialsProvider({
 *   loginEndpoint: 'https://api.example.com/auth/login',
 *   registerEndpoint: 'https://api.example.com/auth/register',
 * });
 *
 * // Login
 * const tokens = await credentials.authenticate({
 *   email: 'user@example.com',
 *   password: 'securePassword123',
 * });
 *
 * // Register new user
 * const newTokens = await credentials.register({
 *   email: 'newuser@example.com',
 *   password: 'securePassword123',
 *   name: 'New User',
 * });
 * ```
 */
export class CredentialsProvider implements AuthProvider {
  readonly name = 'credentials';
  readonly type = 'credentials' as const;

  private readonly config: CredentialsConfig;

  constructor(config: CredentialsConfig) {
    this.config = config;
  }

  /**
   * Authenticate with email and password.
   *
   * Posts the credentials to the configured login endpoint and returns
   * the token pair from the server response.
   *
   * @param params - Object with email and password
   * @returns TokenPair from the server
   * @throws Error if credentials are missing or the request fails
   */
  async authenticate(params: unknown): Promise<TokenPair> {
    const credentials = params as CredentialsLoginParams;

    if (!credentials?.email || !credentials?.password) {
      throw new Error('Email and password are required');
    }

    const response = await fetch(this.config.loginEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid email or password');
      }
      const errorBody = await response.text();
      throw new Error(`Authentication failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as CredentialsTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: 'Bearer',
    };
  }

  /**
   * Register a new user with email, password, and optional name.
   *
   * Posts the registration data to the configured register endpoint
   * and returns the token pair from the server response. The user
   * is automatically logged in after registration.
   *
   * @param params - Object with email, password, and optional name
   * @returns TokenPair from the server
   * @throws Error if required fields are missing or the request fails
   */
  async register(params: CredentialsRegisterParams): Promise<TokenPair> {
    if (!params.email || !params.password) {
      throw new Error('Email and password are required for registration');
    }

    const response = await fetch(this.config.registerEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        name: params.name,
      }),
    });

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error('A user with this email already exists');
      }
      const errorBody = await response.text();
      throw new Error(`Registration failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as CredentialsTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: 'Bearer',
    };
  }
}

/**
 * Create a credentials authentication provider.
 *
 * @param config - Credentials provider configuration with login/register endpoints
 * @returns A new CredentialsProvider instance
 */
export function createCredentialsProvider(config: CredentialsConfig): CredentialsProvider {
  return new CredentialsProvider(config);
}

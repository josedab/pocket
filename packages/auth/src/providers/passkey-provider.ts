/**
 * Passkey Provider - WebAuthn-based passwordless authentication
 *
 * Implements passkey (WebAuthn) authentication using the Web Authentication API.
 * Supports both registration (creating new credentials) and authentication
 * (verifying existing credentials).
 */

import type { AuthProvider, PasskeyConfig, TokenPair } from '../types.js';

/**
 * Encode an ArrayBuffer to a base64url string.
 *
 * @param buffer - The ArrayBuffer to encode
 * @returns Base64url-encoded string
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url string to an ArrayBuffer.
 *
 * @param base64url - The base64url-encoded string
 * @returns Decoded ArrayBuffer
 */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = base64.length % 4;
  if (paddingNeeded === 2) {
    base64 += '==';
  } else if (paddingNeeded === 3) {
    base64 += '=';
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Parameters for passkey authentication
 */
interface PasskeyAuthenticateParams {
  /** Action: 'register' for new credential or 'authenticate' for existing */
  action?: 'register' | 'authenticate';
  /** Username for registration */
  username?: string;
  /** User display name for registration */
  displayName?: string;
}

/**
 * Server response for registration challenge
 */
interface RegistrationChallengeResponse {
  challenge: string;
  userId: string;
  excludeCredentials?: {
    id: string;
    type: string;
  }[];
}

/**
 * Server response for authentication challenge
 */
interface AuthenticationChallengeResponse {
  challenge: string;
  allowCredentials?: {
    id: string;
    type: string;
  }[];
}

/**
 * Server response after credential verification
 */
interface VerificationResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Passkey authentication provider using the WebAuthn API.
 *
 * The flow:
 * 1. Request a challenge from the server
 * 2. Use navigator.credentials.create() or .get() with the challenge
 * 3. Send the credential response back to the server for verification
 * 4. Receive tokens from the server
 *
 * @example
 * ```typescript
 * const passkey = createPasskeyProvider({
 *   rpName: 'My App',
 *   rpId: 'myapp.com',
 *   origin: 'https://myapp.com',
 *   challengeEndpoint: 'https://api.myapp.com/auth/passkey',
 * });
 *
 * // Register a new passkey
 * await passkey.register('user@example.com');
 *
 * // Authenticate with existing passkey
 * const tokens = await passkey.authenticate({});
 * ```
 */
export class PasskeyProvider implements AuthProvider {
  readonly name = 'passkey';
  readonly type = 'passkey' as const;

  private readonly config: PasskeyConfig;

  constructor(config: PasskeyConfig) {
    this.config = config;
  }

  /**
   * Authenticate with an existing passkey or register a new one.
   *
   * @param params - PasskeyAuthenticateParams with action type
   * @returns TokenPair from the server after credential verification
   */
  async authenticate(params: unknown): Promise<TokenPair> {
    const passkeyParams = (params ?? {}) as PasskeyAuthenticateParams;

    if (passkeyParams.action === 'register') {
      return this.register(passkeyParams.username ?? '', passkeyParams.displayName);
    }

    return this.authenticateWithPasskey();
  }

  /**
   * Register a new passkey credential.
   *
   * Requests a registration challenge from the server, creates a new
   * public key credential using navigator.credentials.create(), and
   * sends the attestation response back for verification.
   *
   * @param username - The username to register
   * @param displayName - Optional display name
   * @returns TokenPair from the server
   */
  async register(username: string, displayName?: string): Promise<TokenPair> {
    // Step 1: Get registration challenge from server
    const challengeResponse = await fetch(`${this.config.challengeEndpoint}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName }),
    });

    if (!challengeResponse.ok) {
      throw new Error(`Failed to get registration challenge: ${challengeResponse.status}`);
    }

    const challengeData = (await challengeResponse.json()) as RegistrationChallengeResponse;

    // Step 2: Create credential using WebAuthn API
    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToArrayBuffer(challengeData.challenge),
      rp: {
        name: this.config.rpName,
        id: this.config.rpId,
      },
      user: {
        id: new TextEncoder().encode(challengeData.userId),
        name: username,
        displayName: displayName ?? username,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: challengeData.excludeCredentials?.map((cred) => ({
        id: base64UrlToArrayBuffer(cred.id),
        type: 'public-key' as const,
      })),
    };

    const credential = (await navigator.credentials.create({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error('Passkey registration was cancelled or failed');
    }

    const attestationResponse = credential.response as AuthenticatorAttestationResponse;

    // Step 3: Send attestation to server for verification
    const verifyResponse = await fetch(`${this.config.challengeEndpoint}/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: arrayBufferToBase64Url(attestationResponse.attestationObject),
          clientDataJSON: arrayBufferToBase64Url(attestationResponse.clientDataJSON),
        },
      }),
    });

    if (!verifyResponse.ok) {
      throw new Error(`Passkey registration verification failed: ${verifyResponse.status}`);
    }

    const tokenData = (await verifyResponse.json()) as VerificationResponse;

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: 'Bearer',
    };
  }

  /**
   * Authenticate with an existing passkey.
   *
   * Requests an authentication challenge from the server, retrieves an
   * existing credential using navigator.credentials.get(), and sends
   * the assertion response back for verification.
   *
   * @returns TokenPair from the server
   */
  private async authenticateWithPasskey(): Promise<TokenPair> {
    // Step 1: Get authentication challenge from server
    const challengeResponse = await fetch(`${this.config.challengeEndpoint}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!challengeResponse.ok) {
      throw new Error(`Failed to get authentication challenge: ${challengeResponse.status}`);
    }

    const challengeData = (await challengeResponse.json()) as AuthenticationChallengeResponse;

    // Step 2: Get credential using WebAuthn API
    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToArrayBuffer(challengeData.challenge),
      rpId: this.config.rpId,
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials: challengeData.allowCredentials?.map((cred) => ({
        id: base64UrlToArrayBuffer(cred.id),
        type: 'public-key' as const,
      })),
    };

    const credential = (await navigator.credentials.get({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error('Passkey authentication was cancelled or failed');
    }

    const assertionResponse = credential.response as AuthenticatorAssertionResponse;

    // Step 3: Send assertion to server for verification
    const verifyResponse = await fetch(`${this.config.challengeEndpoint}/authenticate/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: arrayBufferToBase64Url(assertionResponse.authenticatorData),
          clientDataJSON: arrayBufferToBase64Url(assertionResponse.clientDataJSON),
          signature: arrayBufferToBase64Url(assertionResponse.signature),
          userHandle: assertionResponse.userHandle
            ? arrayBufferToBase64Url(assertionResponse.userHandle)
            : null,
        },
      }),
    });

    if (!verifyResponse.ok) {
      throw new Error(`Passkey authentication verification failed: ${verifyResponse.status}`);
    }

    const tokenData = (await verifyResponse.json()) as VerificationResponse;

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: 'Bearer',
    };
  }
}

/**
 * Create a passkey authentication provider.
 *
 * @param config - Passkey/WebAuthn configuration
 * @returns A new PasskeyProvider instance
 */
export function createPasskeyProvider(config: PasskeyConfig): PasskeyProvider {
  return new PasskeyProvider(config);
}

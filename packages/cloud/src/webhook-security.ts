/**
 * Webhook signature verification and replay protection.
 *
 * Provides HMAC-SHA256 signature generation/verification for webhook
 * payloads and timestamp-based replay attack prevention.
 *
 * @module webhook-security
 */

/** Signature verification result */
export interface SignatureVerifyResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Webhook security configuration */
export interface WebhookSecurityConfig {
  /** Signing secret for HMAC generation */
  readonly signingSecret: string;
  /** Maximum age of webhook in ms before considered a replay (default: 300000 = 5 min) */
  readonly maxAgeMs?: number;
  /** Header name for signature (default: 'x-pocket-signature') */
  readonly signatureHeader?: string;
  /** Header name for timestamp (default: 'x-pocket-timestamp') */
  readonly timestampHeader?: string;
}

/**
 * Generates HMAC-SHA256 signature for a webhook payload.
 * Uses Web Crypto API (works in browsers and Node.js 18+).
 */
export async function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const message = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, msgData);
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies a webhook signature and checks for replay attacks.
 *
 * @example
 * ```typescript
 * const result = await verifyWebhookPayload({
 *   payload: requestBody,
 *   signature: headers['x-pocket-signature'],
 *   timestamp: parseInt(headers['x-pocket-timestamp']),
 *   config: { signingSecret: process.env.WEBHOOK_SECRET },
 * });
 *
 * if (!result.valid) {
 *   return res.status(401).json({ error: result.reason });
 * }
 * ```
 */
export async function verifyWebhookPayload(input: {
  payload: string;
  signature: string;
  timestamp: number;
  config: WebhookSecurityConfig;
}): Promise<SignatureVerifyResult> {
  const { payload, signature, timestamp, config } = input;
  const maxAge = config.maxAgeMs ?? 300_000;

  // Check timestamp freshness (replay protection)
  const age = Math.abs(Date.now() - timestamp);
  if (age > maxAge) {
    return {
      valid: false,
      reason: `Webhook timestamp too old (${Math.round(age / 1000)}s, max ${Math.round(maxAge / 1000)}s)`,
    };
  }

  // Verify signature
  const expected = await generateWebhookSignature(payload, config.signingSecret, timestamp);

  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Create signed webhook headers for outgoing webhooks.
 */
export async function createWebhookHeaders(
  payload: string,
  config: WebhookSecurityConfig,
): Promise<Record<string, string>> {
  const timestamp = Date.now();
  const signature = await generateWebhookSignature(payload, config.signingSecret, timestamp);
  const sigHeader = config.signatureHeader ?? 'x-pocket-signature';
  const tsHeader = config.timestampHeader ?? 'x-pocket-timestamp';

  return {
    [sigHeader]: signature,
    [tsHeader]: String(timestamp),
    'content-type': 'application/json',
  };
}

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

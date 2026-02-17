import { describe, it, expect } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookPayload,
  createWebhookHeaders,
} from '../webhook-security.js';

const SECRET = 'test-signing-secret-12345';
const PAYLOAD = '{"event":"sync.completed","data":{"collections":["todos"]}}';

describe('Webhook Security', () => {
  describe('signature generation', () => {
    it('should generate a hex signature', async () => {
      const sig = await generateWebhookSignature(PAYLOAD, SECRET, 1000);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent signatures', async () => {
      const ts = Date.now();
      const sig1 = await generateWebhookSignature(PAYLOAD, SECRET, ts);
      const sig2 = await generateWebhookSignature(PAYLOAD, SECRET, ts);
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different payloads', async () => {
      const ts = Date.now();
      const sig1 = await generateWebhookSignature('payload1', SECRET, ts);
      const sig2 = await generateWebhookSignature('payload2', SECRET, ts);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', async () => {
      const ts = Date.now();
      const sig1 = await generateWebhookSignature(PAYLOAD, 'secret1', ts);
      const sig2 = await generateWebhookSignature(PAYLOAD, 'secret2', ts);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verification', () => {
    it('should verify valid signature', async () => {
      const ts = Date.now();
      const sig = await generateWebhookSignature(PAYLOAD, SECRET, ts);
      const result = await verifyWebhookPayload({
        payload: PAYLOAD,
        signature: sig,
        timestamp: ts,
        config: { signingSecret: SECRET },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const result = await verifyWebhookPayload({
        payload: PAYLOAD,
        signature: 'invalid_signature_' + '0'.repeat(46),
        timestamp: Date.now(),
        config: { signingSecret: SECRET },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid signature');
    });

    it('should reject expired timestamps (replay protection)', async () => {
      const oldTimestamp = Date.now() - 600_000; // 10 min ago
      const sig = await generateWebhookSignature(PAYLOAD, SECRET, oldTimestamp);
      const result = await verifyWebhookPayload({
        payload: PAYLOAD,
        signature: sig,
        timestamp: oldTimestamp,
        config: { signingSecret: SECRET, maxAgeMs: 300_000 },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too old');
    });

    it('should accept timestamps within window', async () => {
      const ts = Date.now() - 1000; // 1 second ago
      const sig = await generateWebhookSignature(PAYLOAD, SECRET, ts);
      const result = await verifyWebhookPayload({
        payload: PAYLOAD,
        signature: sig,
        timestamp: ts,
        config: { signingSecret: SECRET },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('header creation', () => {
    it('should create signed headers', async () => {
      const headers = await createWebhookHeaders(PAYLOAD, { signingSecret: SECRET });
      expect(headers['x-pocket-signature']).toMatch(/^[0-9a-f]{64}$/);
      expect(headers['x-pocket-timestamp']).toBeTruthy();
      expect(headers['content-type']).toBe('application/json');
    });

    it('should use custom header names', async () => {
      const headers = await createWebhookHeaders(PAYLOAD, {
        signingSecret: SECRET,
        signatureHeader: 'x-custom-sig',
        timestampHeader: 'x-custom-ts',
      });
      expect(headers['x-custom-sig']).toBeTruthy();
      expect(headers['x-custom-ts']).toBeTruthy();
    });

    it('should produce verifiable headers', async () => {
      const headers = await createWebhookHeaders(PAYLOAD, { signingSecret: SECRET });
      const result = await verifyWebhookPayload({
        payload: PAYLOAD,
        signature: headers['x-pocket-signature']!,
        timestamp: parseInt(headers['x-pocket-timestamp']!),
        config: { signingSecret: SECRET },
      });
      expect(result.valid).toBe(true);
    });
  });
});

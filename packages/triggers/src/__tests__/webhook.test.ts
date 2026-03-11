import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebhookExecutor, type WebhookExecutor } from '../webhook.js';

describe('WebhookExecutor', () => {
  let executor: WebhookExecutor;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }));
  });

  afterEach(() => {
    executor?.destroy();
    vi.restoreAllMocks();
  });

  describe('basic send', () => {
    it('should send a single payload via POST', async () => {
      executor = createWebhookExecutor({ url: 'https://example.com/hook', method: 'POST' });
      const result = await executor.send({ event: 'test' });
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('should include Content-Type and custom headers', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        headers: { 'X-Custom': 'value' },
      });
      await executor.send({ data: 1 });
      const callArgs = vi.mocked(fetch).mock.calls[0]!;
      const headers = callArgs[1]!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Custom']).toBe('value');
    });

    it('should include Authorization header when authHeader is set', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        authHeader: 'Bearer token123',
      });
      await executor.send({ data: 1 });
      const callArgs = vi.mocked(fetch).mock.calls[0]!;
      const headers = callArgs[1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer token123');
    });
  });

  describe('HMAC signature', () => {
    it('should add X-Webhook-Signature header when secret is configured', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        secret: 'my-secret-key',
      });
      await executor.send({ event: 'test' });
      const callArgs = vi.mocked(fetch).mock.calls[0]!;
      const headers = callArgs[1]!.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toBeDefined();
      expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should produce consistent signatures for same payload + secret', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        secret: 'test-secret',
      });
      await executor.send({ value: 42 });
      await executor.send({ value: 42 });

      const call1Headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>;
      const call2Headers = vi.mocked(fetch).mock.calls[1]![1]!.headers as Record<string, string>;
      expect(call1Headers['X-Webhook-Signature']).toBe(call2Headers['X-Webhook-Signature']);
    });

    it('should not add signature when secret is not set', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
      });
      await executor.send({ event: 'test' });
      const callArgs = vi.mocked(fetch).mock.calls[0]!;
      const headers = callArgs[1]!.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('should retry on failure with exponential backoff', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' } as Response);

      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        retries: 2,
        retryDelayMs: 10,
      });
      const result = await executor.send({ data: 1 });
      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should return failure after all retries exhausted', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('permanent error'));

      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        retries: 1,
        retryDelayMs: 10,
      });
      const result = await executor.send({ data: 1 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('permanent error');
    });

    it('should retry on non-ok HTTP status', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' } as Response);

      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        retries: 2,
        retryDelayMs: 10,
      });
      const result = await executor.send({ data: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe('batching', () => {
    it('should batch payloads when batchSize > 1', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        batchSize: 3,
      });

      // First two are queued
      await executor.send({ n: 1 });
      await executor.send({ n: 2 });
      expect(fetch).not.toHaveBeenCalled();

      // Third triggers the batch
      await executor.send({ n: 3 });
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('should track pending count', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        batchSize: 5,
      });

      await executor.send({ n: 1 });
      await executor.send({ n: 2 });
      expect(executor.getPendingCount()).toBe(2);
    });

    it('should flush pending batch', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        batchSize: 10,
      });

      await executor.send({ n: 1 });
      await executor.send({ n: 2 });
      await executor.flush();
      expect(fetch).toHaveBeenCalledOnce();
      expect(executor.getPendingCount()).toBe(0);
    });
  });

  describe('sendBatch', () => {
    it('should send multiple payloads sequentially', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
      });

      const result = await executor.sendBatch([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.success)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('error callback', () => {
    it('should call onError when batch delivery fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('batch fail'));
      const onError = vi.fn();

      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        batchSize: 2,
        batchIntervalMs: 10,
        retries: 0,
        retryDelayMs: 1,
        onError,
      });

      await executor.send({ n: 1 });
      // Wait for batch interval timer to fire and retry to complete
      await new Promise((r) => setTimeout(r, 200));
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('should throw after destroy', () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
      });
      executor.destroy();
      expect(() => executor.send({ data: 1 })).rejects.toThrow('destroyed');
    });

    it('should clear pending batch on destroy', async () => {
      executor = createWebhookExecutor({
        url: 'https://example.com/hook',
        method: 'POST',
        batchSize: 10,
      });
      await executor.send({ n: 1 });
      executor.destroy();
      expect(executor.getPendingCount()).toBe(0);
    });
  });
});

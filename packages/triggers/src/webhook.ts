import type { WebhookConfig } from './types.js';

interface SendResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export class WebhookExecutor {
  private readonly config: Required<
    Pick<WebhookConfig, 'url' | 'method' | 'retries' | 'retryDelayMs' | 'batchSize' | 'batchIntervalMs'>
  > & WebhookConfig;
  private pendingBatch: unknown[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: WebhookConfig) {
    this.config = {
      retries: config.retries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      batchSize: config.batchSize ?? 1,
      batchIntervalMs: config.batchIntervalMs ?? 0,
      ...config,
    };
  }

  async send(payload: unknown): Promise<SendResult> {
    this.ensureNotDestroyed();

    if (this.config.batchSize > 1) {
      return this.enqueue(payload);
    }
    return this.doSend(payload);
  }

  async sendBatch(payloads: unknown[]): Promise<{ results: Array<{ success: boolean; error?: string }> }> {
    this.ensureNotDestroyed();
    const results: Array<{ success: boolean; error?: string }> = [];
    for (const payload of payloads) {
      const result = await this.doSend(payload);
      results.push({ success: result.success, error: result.error });
    }
    return { results };
  }

  getPendingCount(): number {
    return this.pendingBatch.length;
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.pendingBatch.length > 0) {
      const batch = this.pendingBatch.splice(0);
      await this.doSend(batch);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingBatch.length = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async enqueue(payload: unknown): Promise<SendResult> {
    this.pendingBatch.push(payload);

    if (this.pendingBatch.length >= this.config.batchSize) {
      const batch = this.pendingBatch.splice(0, this.config.batchSize);
      return this.doSend(batch);
    }

    // Start batch interval timer if not already running
    if (!this.batchTimer && this.config.batchIntervalMs > 0) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        if (this.pendingBatch.length > 0) {
          const batch = this.pendingBatch.splice(0);
          this.doSend(batch).catch(() => {});
        }
      }, this.config.batchIntervalMs);
    }

    return { success: true };
  }

  private async doSend(payload: unknown): Promise<SendResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
    if (this.config.authHeader) {
      headers['Authorization'] = this.config.authHeader;
    }

    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: this.config.method,
          headers,
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return { success: true, statusCode: response.status };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < this.config.retries) {
        // Exponential backoff
        const delay = this.config.retryDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return { success: false, error: lastError };
  }

  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('WebhookExecutor has been destroyed');
    }
  }
}

export function createWebhookExecutor(config: WebhookConfig): WebhookExecutor {
  return new WebhookExecutor(config);
}

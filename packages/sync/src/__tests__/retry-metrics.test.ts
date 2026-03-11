import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSyncRetryMonitor,
  type RetryEvent,
  type SyncRetryMonitor,
} from '../retry-metrics.js';

describe('SyncRetryMonitor', () => {
  let monitor: SyncRetryMonitor;

  beforeEach(() => {
    monitor = createSyncRetryMonitor({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      successThreshold: 2,
    });
  });

  describe('circuit breaker', () => {
    it('should start with closed circuit', () => {
      expect(monitor.getCircuitState()).toBe('closed');
      expect(monitor.canAttempt()).toBe(true);
    });

    it('should open circuit after failure threshold reached', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      expect(monitor.getCircuitState()).toBe('open');
      expect(monitor.canAttempt()).toBe(false);
    });

    it('should transition to half-open after reset timeout', async () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      await new Promise((r) => setTimeout(r, 120));
      expect(monitor.getCircuitState()).toBe('half-open');
      expect(monitor.canAttempt()).toBe(true);
    });

    it('should close after enough successes in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      await new Promise((r) => setTimeout(r, 120));

      // Trigger transition to half-open
      expect(monitor.canAttempt()).toBe(true);
      expect(monitor.getCircuitState()).toBe('half-open');

      monitor.recordSuccess('push');
      monitor.recordSuccess('push');
      expect(monitor.getCircuitState()).toBe('closed');
    });
  });

  describe('metrics', () => {
    it('should track total retries', () => {
      monitor.recordFailure('push', 'err', 1, 5, 1000);
      monitor.recordFailure('push', 'err', 2, 5, 2000);
      const metrics = monitor.getMetrics();
      expect(metrics.totalRetries).toBe(2);
    });

    it('should track successful retries', () => {
      monitor.recordSuccess('pull');
      monitor.recordSuccess('pull');
      expect(monitor.getMetrics().successfulRetries).toBe(2);
    });

    it('should track exhausted retries', () => {
      monitor.recordFailure('push', 'err', 5, 5);
      expect(monitor.getMetrics().exhaustedRetries).toBe(1);
    });

    it('should compute average delay', () => {
      monitor.recordFailure('push', 'err', 1, 5, 1000);
      monitor.recordFailure('push', 'err', 2, 5, 3000);
      expect(monitor.getMetrics().avgRetryDelayMs).toBe(2000);
    });

    it('should track top failing operations', () => {
      for (let i = 0; i < 5; i++) monitor.recordFailure('push', 'err');
      for (let i = 0; i < 3; i++) monitor.recordFailure('pull', 'err');
      const top = monitor.getMetrics().topFailingOperations;
      expect(top[0]!.operation).toBe('push');
      expect(top[0]!.count).toBe(5);
      expect(top[1]!.operation).toBe('pull');
    });

    it('should report circuitBreakerOpen in metrics', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      expect(monitor.getMetrics().circuitBreakerOpen).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit retry-attempt events', () => {
      const events: RetryEvent[] = [];
      monitor.events$.subscribe((e) => events.push(e));
      monitor.recordFailure('push', 'err', 1, 5, 1000, 'todos');
      expect(events.some((e) => e.type === 'retry-attempt')).toBe(true);
      expect(events[0]!.collection).toBe('todos');
    });

    it('should emit retry-exhausted when max attempts reached', () => {
      const events: RetryEvent[] = [];
      monitor.events$.subscribe((e) => events.push(e));
      monitor.recordFailure('push', 'err', 5, 5);
      expect(events.some((e) => e.type === 'retry-exhausted')).toBe(true);
    });

    it('should emit circuit-open event', () => {
      const events: RetryEvent[] = [];
      monitor.events$.subscribe((e) => events.push(e));
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      expect(events.some((e) => e.type === 'circuit-open')).toBe(true);
    });

    it('should emit circuit-close event on recovery', async () => {
      const events: RetryEvent[] = [];
      monitor.events$.subscribe((e) => events.push(e));
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      await new Promise((r) => setTimeout(r, 120));

      // Trigger transition to half-open
      monitor.canAttempt();

      monitor.recordSuccess('push');
      monitor.recordSuccess('push');
      expect(events.some((e) => e.type === 'circuit-close')).toBe(true);
    });

    it('should emit retry-success events', () => {
      const events: RetryEvent[] = [];
      monitor.events$.subscribe((e) => events.push(e));
      monitor.recordSuccess('pull');
      expect(events.some((e) => e.type === 'retry-success')).toBe(true);
    });
  });

  describe('metrics observable', () => {
    it('should emit updated metrics on changes', () => {
      const snapshots: number[] = [];
      monitor.retryMetrics$.subscribe((m) => snapshots.push(m.totalRetries));
      monitor.recordFailure('push', 'err');
      monitor.recordFailure('push', 'err');
      expect(snapshots[snapshots.length - 1]).toBe(2);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      monitor.recordFailure('push', 'err');
      monitor.recordFailure('push', 'err');
      monitor.recordFailure('push', 'err');
      monitor.reset();
      expect(monitor.getCircuitState()).toBe('closed');
      expect(monitor.getMetrics().totalRetries).toBe(0);
      expect(monitor.canAttempt()).toBe(true);
    });
  });

  describe('recordFailure return value', () => {
    it('should return true when more retries are allowed', () => {
      const result = monitor.recordFailure('push', 'err', 1, 5);
      expect(result).toBe(true);
    });

    it('should return false when max attempts reached', () => {
      const result = monitor.recordFailure('push', 'err', 5, 5);
      expect(result).toBe(false);
    });

    it('should return false when circuit is open', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('push', 'error');
      }
      const result = monitor.recordFailure('push', 'err', 1, 5);
      expect(result).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should complete observables', () => {
      let completed = false;
      monitor.events$.subscribe({ complete: () => (completed = true) });
      monitor.destroy();
      expect(completed).toBe(true);
    });
  });
});

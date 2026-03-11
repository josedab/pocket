import { beforeEach, describe, expect, it } from 'vitest';
import {
  CircuitOpenError,
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerEvent,
} from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = createCircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      name: 'test-breaker',
    });
  });

  describe('closed state (normal operation)', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should execute function successfully', async () => {
      const result = await breaker.execute(async () => 42);
      expect(result).toBe(42);
    });

    it('should remain closed after fewer failures than threshold', async () => {
      for (let i = 0; i < 2; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('opening the circuit', () => {
    it('should open after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('open');
    });

    it('should throw CircuitOpenError when open', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
    });

    it('should include circuit name and retry info in CircuitOpenError', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      try {
        await breaker.execute(async () => 'ok');
      } catch (e) {
        expect(e).toBeInstanceOf(CircuitOpenError);
        const err = e as CircuitOpenError;
        expect(err.circuitName).toBe('test-breaker');
        expect(err.retryAfterMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('half-open state (recovery)', () => {
    it('should transition to half-open after reset timeout', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('open');

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 120));
      expect(breaker.getState()).toBe('half-open');
    });

    it('should close on successful trial call in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 120));

      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe('closed');
    });

    it('should re-open on failed trial call in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 120));

      await breaker
        .execute(async () => {
          throw new Error('still failing');
        })
        .catch(() => {});
      expect(breaker.getState()).toBe('open');
    });
  });

  describe('manual reset', () => {
    it('should reset circuit to closed state', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('open');

      breaker.reset();
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow calls after manual reset', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      breaker.reset();
      const result = await breaker.execute(async () => 'ok');
      expect(result).toBe('ok');
    });
  });

  describe('success resets failure count', () => {
    it('should reset failure count on success', async () => {
      // 2 failures, then success, then 2 more failures — should NOT open
      await breaker
        .execute(async () => {
          throw new Error('f1');
        })
        .catch(() => {});
      await breaker
        .execute(async () => {
          throw new Error('f2');
        })
        .catch(() => {});
      await breaker.execute(async () => 'ok');
      await breaker
        .execute(async () => {
          throw new Error('f3');
        })
        .catch(() => {});
      await breaker
        .execute(async () => {
          throw new Error('f4');
        })
        .catch(() => {});
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('events', () => {
    it('should emit state-change events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.events.subscribe((e) => events.push(e));

      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }

      const stateChanges = events.filter((e) => e.type === 'state-change');
      expect(stateChanges.length).toBeGreaterThanOrEqual(1);
      expect(stateChanges.some((e) => e.state === 'open')).toBe(true);
    });

    it('should emit failure events with error message', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.events.subscribe((e) => events.push(e));

      await breaker
        .execute(async () => {
          throw new Error('specific error');
        })
        .catch(() => {});

      const failures = events.filter((e) => e.type === 'failure');
      expect(failures).toHaveLength(1);
      expect(failures[0]!.error).toBe('specific error');
    });

    it('should emit rejected events when circuit is open', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.events.subscribe((e) => events.push(e));

      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(async () => {
            throw new Error('fail');
          })
          .catch(() => {});
      }
      await breaker.execute(async () => 'ok').catch(() => {});

      const rejected = events.filter((e) => e.type === 'rejected');
      expect(rejected).toHaveLength(1);
    });

    it('should emit success events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.events.subscribe((e) => events.push(e));

      await breaker.execute(async () => 'ok');

      const successes = events.filter((e) => e.type === 'success');
      expect(successes).toHaveLength(1);
    });
  });

  describe('factory', () => {
    it('should create with default config', () => {
      const b = createCircuitBreaker();
      expect(b.getState()).toBe('closed');
      b.destroy();
    });
  });

  describe('destroy', () => {
    it('should complete events observable', () => {
      let completed = false;
      breaker.events.subscribe({ complete: () => (completed = true) });
      breaker.destroy();
      expect(completed).toBe(true);
    });
  });
});

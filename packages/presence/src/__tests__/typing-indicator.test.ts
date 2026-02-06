import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TypingIndicator, createTypingIndicator, type TypingUser } from '../typing-indicator.js';

describe('TypingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('setTyping / getTypingUsers', () => {
    it('should track a user as typing', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');

      const users = indicator.getTypingUsers('messages', 'body');
      expect(users).toHaveLength(1);
      expect(users[0].userId).toBe('user-1');
      expect(users[0].collection).toBe('messages');
      expect(users[0].field).toBe('body');

      indicator.destroy();
    });

    it('should track multiple users typing simultaneously', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'messages', 'body');
      indicator.setTyping('user-3', 'messages', 'body');

      const users = indicator.getTypingUsers('messages', 'body');
      expect(users).toHaveLength(3);

      const userIds = users.map((u) => u.userId).sort();
      expect(userIds).toEqual(['user-1', 'user-2', 'user-3']);

      indicator.destroy();
    });

    it('should track users across different collections', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'todos', 'title');

      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);
      expect(indicator.getTypingUsers('todos', 'title')).toHaveLength(1);
      expect(indicator.getTypingUsers('messages')).toHaveLength(1);
      expect(indicator.getTypingUsers('todos')).toHaveLength(1);

      indicator.destroy();
    });

    it('should track users across different fields in same collection', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'todos', 'title');
      indicator.setTyping('user-2', 'todos', 'description');

      expect(indicator.getTypingUsers('todos', 'title')).toHaveLength(1);
      expect(indicator.getTypingUsers('todos', 'description')).toHaveLength(1);
      // Without field filter, returns all in collection
      expect(indicator.getTypingUsers('todos')).toHaveLength(2);

      indicator.destroy();
    });

    it('should return empty array for unknown collection', () => {
      const indicator = createTypingIndicator();

      expect(indicator.getTypingUsers('unknown')).toEqual([]);

      indicator.destroy();
    });

    it('should reset timer on repeated setTyping for same user/collection/field', () => {
      const indicator = createTypingIndicator({ timeoutMs: 3000 });

      indicator.setTyping('user-1', 'messages', 'body');

      // Advance 2s
      vi.advanceTimersByTime(2000);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      // Reset by calling setTyping again
      indicator.setTyping('user-1', 'messages', 'body');

      // Advance another 2s (total 4s from first, but only 2s from reset)
      vi.advanceTimersByTime(2000);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      // Advance past the timeout from the reset
      vi.advanceTimersByTime(1500);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });

    it('should preserve startedAt when resetting timer', () => {
      const indicator = createTypingIndicator({ timeoutMs: 3000 });
      const now = Date.now();

      indicator.setTyping('user-1', 'messages', 'body');
      const startedAt = indicator.getTypingUsers('messages', 'body')[0].startedAt;

      vi.advanceTimersByTime(1000);

      indicator.setTyping('user-1', 'messages', 'body');
      const afterReset = indicator.getTypingUsers('messages', 'body')[0].startedAt;

      expect(afterReset).toBe(startedAt);

      indicator.destroy();
    });
  });

  describe('clearTyping', () => {
    it('should clear typing for specific user/collection/field', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'messages', 'body');

      indicator.clearTyping('user-1', 'messages', 'body');

      const users = indicator.getTypingUsers('messages', 'body');
      expect(users).toHaveLength(1);
      expect(users[0].userId).toBe('user-2');

      indicator.destroy();
    });

    it('should clear all typing for user in a collection', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'todos', 'title');
      indicator.setTyping('user-1', 'todos', 'description');
      indicator.setTyping('user-1', 'messages', 'body');

      indicator.clearTyping('user-1', 'todos');

      expect(indicator.getTypingUsers('todos')).toHaveLength(0);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      indicator.destroy();
    });

    it('should clear all typing for user across all collections', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'todos', 'title');
      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'messages', 'body');

      indicator.clearTyping('user-1');

      expect(indicator.getTypingUsers('todos')).toHaveLength(0);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);
      expect(indicator.getTypingUsers('messages', 'body')[0].userId).toBe('user-2');

      indicator.destroy();
    });

    it('should be a no-op when clearing non-existent typing', () => {
      const indicator = createTypingIndicator();

      // Should not throw
      indicator.clearTyping('user-1', 'messages', 'body');
      indicator.clearTyping('user-1');

      expect(indicator.getTypingUsers('messages')).toEqual([]);

      indicator.destroy();
    });
  });

  describe('auto-expiry', () => {
    it('should auto-expire typing after default timeout (3s)', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      vi.advanceTimersByTime(3000);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });

    it('should auto-expire typing after custom timeout', () => {
      const indicator = createTypingIndicator({ timeoutMs: 5000 });

      indicator.setTyping('user-1', 'messages', 'body');

      vi.advanceTimersByTime(3000);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      vi.advanceTimersByTime(2000);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });

    it('should expire users independently', () => {
      const indicator = createTypingIndicator({ timeoutMs: 3000 });

      indicator.setTyping('user-1', 'messages', 'body');

      vi.advanceTimersByTime(1500);
      indicator.setTyping('user-2', 'messages', 'body');

      // At 3000ms: user-1 expires, user-2 still active
      vi.advanceTimersByTime(1500);
      const users = indicator.getTypingUsers('messages', 'body');
      expect(users).toHaveLength(1);
      expect(users[0].userId).toBe('user-2');

      // At 4500ms: user-2 also expires
      vi.advanceTimersByTime(1500);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });
  });

  describe('typing$ observable', () => {
    it('should emit initial empty state', () => {
      const indicator = createTypingIndicator();
      const emissions: TypingUser[][] = [];

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      // BehaviorSubject emits current value on subscribe
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toEqual([]);

      indicator.destroy();
    });

    it('should emit when user starts typing', () => {
      const indicator = createTypingIndicator();
      const emissions: TypingUser[][] = [];

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      indicator.setTyping('user-1', 'messages', 'body');

      // Initial emission + setTyping emission
      expect(emissions).toHaveLength(2);
      expect(emissions[1]).toHaveLength(1);
      expect(emissions[1][0].userId).toBe('user-1');

      indicator.destroy();
    });

    it('should emit when typing is cleared', () => {
      const indicator = createTypingIndicator();
      const emissions: TypingUser[][] = [];

      indicator.setTyping('user-1', 'messages', 'body');

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      indicator.clearTyping('user-1', 'messages', 'body');

      // Subscribe emission (1 user) + clear emission (0 users)
      expect(emissions).toHaveLength(2);
      expect(emissions[1]).toHaveLength(0);

      indicator.destroy();
    });

    it('should emit when typing auto-expires', () => {
      const indicator = createTypingIndicator({ timeoutMs: 3000 });
      const emissions: TypingUser[][] = [];

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      indicator.setTyping('user-1', 'messages', 'body');
      const countAfterSet = emissions.length;

      vi.advanceTimersByTime(3000);

      expect(emissions.length).toBeGreaterThan(countAfterSet);
      expect(emissions[emissions.length - 1]).toHaveLength(0);

      indicator.destroy();
    });

    it('should emit for multiple user changes', () => {
      const indicator = createTypingIndicator();
      const emissions: TypingUser[][] = [];

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'messages', 'body');

      // Initial + user-1 + user-2
      expect(emissions).toHaveLength(3);
      expect(emissions[1]).toHaveLength(1);
      expect(emissions[2]).toHaveLength(2);

      indicator.destroy();
    });
  });

  describe('destroy', () => {
    it('should clear all entries on destroy', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');
      indicator.setTyping('user-2', 'todos', 'title');

      indicator.destroy();

      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);
      expect(indicator.getTypingUsers('todos', 'title')).toHaveLength(0);
    });

    it('should complete the observable on destroy', () => {
      const indicator = createTypingIndicator();
      let completed = false;

      indicator.typing$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      indicator.destroy();

      expect(completed).toBe(true);
    });

    it('should prevent setTyping after destroy', () => {
      const indicator = createTypingIndicator();

      indicator.destroy();
      indicator.setTyping('user-1', 'messages', 'body');

      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);
    });

    it('should prevent clearTyping side effects after destroy', () => {
      const indicator = createTypingIndicator();

      indicator.destroy();

      // Should not throw
      indicator.clearTyping('user-1', 'messages', 'body');
    });

    it('should clear timers on destroy to prevent auto-expiry callbacks', () => {
      const indicator = createTypingIndicator({ timeoutMs: 3000 });
      const emissions: TypingUser[][] = [];

      indicator.setTyping('user-1', 'messages', 'body');

      indicator.typing$.subscribe((users) => {
        emissions.push(users);
      });

      indicator.destroy();
      const countAfterDestroy = emissions.length;

      // Advance past timeout - no new emissions should occur
      vi.advanceTimersByTime(5000);
      expect(emissions.length).toBe(countAfterDestroy);
    });
  });

  describe('createTypingIndicator factory', () => {
    it('should create instance with default config', () => {
      const indicator = createTypingIndicator();

      indicator.setTyping('user-1', 'messages', 'body');

      vi.advanceTimersByTime(2999);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });

    it('should create instance with custom config', () => {
      const indicator = createTypingIndicator({ timeoutMs: 1000 });

      indicator.setTyping('user-1', 'messages', 'body');

      vi.advanceTimersByTime(999);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(indicator.getTypingUsers('messages', 'body')).toHaveLength(0);

      indicator.destroy();
    });
  });
});

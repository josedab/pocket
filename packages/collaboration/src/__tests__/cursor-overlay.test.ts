import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom, take } from 'rxjs';
import {
  createCursorOverlay,
  CursorOverlay,
  type CursorEvent,
} from '../cursor-overlay.js';

describe('CursorOverlay', () => {
  let overlay: CursorOverlay;

  beforeEach(() => {
    vi.useFakeTimers();
    overlay = createCursorOverlay({
      localUserId: 'local-user',
      throttleMs: 0,
      smoothingEnabled: false,
      staleTimeoutMs: 30_000,
    });
  });

  afterEach(() => {
    overlay.destroy();
    vi.useRealTimers();
  });

  describe('createCursorOverlay', () => {
    it('should return a CursorOverlay instance', () => {
      expect(overlay).toBeInstanceOf(CursorOverlay);
    });
  });

  describe('updateRemoteCursor', () => {
    it('should add a new remote cursor', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 5 },
      });

      vi.advanceTimersByTime(10);

      const cursors = overlay.getCursors();
      expect(cursors).toHaveLength(1);
      expect(cursors[0]!.userId).toBe('user-2');
      expect(cursors[0]!.name).toBe('Alice');
      expect(cursors[0]!.position).toEqual({ line: 10, column: 5 });
    });

    it('should update an existing cursor position', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 5 },
      });
      vi.advanceTimersByTime(10);

      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 20, column: 15 },
      });
      vi.advanceTimersByTime(10);

      const cursor = overlay.getCursor('user-2');
      expect(cursor!.position).toEqual({ line: 20, column: 15 });
    });
  });

  describe('updateRemoteSelection', () => {
    it('should add a selection range to an existing cursor', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 5 },
      });
      vi.advanceTimersByTime(10);

      overlay.updateRemoteSelection('user-2', {
        start: { line: 10, column: 5 },
        end: { line: 10, column: 20 },
      });

      const cursor = overlay.getCursor('user-2');
      expect(cursor!.selection).toEqual({
        start: { line: 10, column: 5 },
        end: { line: 10, column: 20 },
      });
    });

    it('should be a no-op if cursor does not exist', () => {
      overlay.updateRemoteSelection('non-existent', {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 10 },
      });

      expect(overlay.getCursors()).toHaveLength(0);
    });
  });

  describe('removeCursor', () => {
    it('should remove a cursor', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 5 },
      });
      vi.advanceTimersByTime(10);

      overlay.removeCursor('user-2');

      expect(overlay.getCursors()).toHaveLength(0);
    });

    it('should be a no-op for non-existent cursor', () => {
      expect(() => overlay.removeCursor('non-existent')).not.toThrow();
    });
  });

  describe('getCursors', () => {
    it('should return all remote cursors', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      overlay.updateRemoteCursor({
        userId: 'user-3',
        name: 'Bob',
        position: { line: 5, column: 3 },
      });
      vi.advanceTimersByTime(10);

      expect(overlay.getCursors()).toHaveLength(2);
    });
  });

  describe('getCursor', () => {
    it('should return a specific cursor', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 5 },
      });
      vi.advanceTimersByTime(10);

      const cursor = overlay.getCursor('user-2');
      expect(cursor).toBeDefined();
      expect(cursor!.name).toBe('Alice');
    });

    it('should return undefined for non-existent cursor', () => {
      expect(overlay.getCursor('non-existent')).toBeUndefined();
    });
  });

  describe('getColorForUser', () => {
    it('should return a deterministic color', () => {
      const color = overlay.getColorForUser('user-2');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should return the same color for the same user', () => {
      const color1 = overlay.getColorForUser('user-2');
      const color2 = overlay.getColorForUser('user-2');
      expect(color1).toBe(color2);
    });

    it('should potentially return different colors for different users', () => {
      const color1 = overlay.getColorForUser('user-a');
      const color2 = overlay.getColorForUser('user-z');
      // Colors are deterministic based on hash, different inputs may produce different colors
      expect(typeof color1).toBe('string');
      expect(typeof color2).toBe('string');
    });
  });

  describe('cursors$', () => {
    it('should emit cursor updates', async () => {
      const cursorsPromise = firstValueFrom(overlay.cursors$.pipe(take(1)));
      const cursors = await cursorsPromise;
      expect(cursors).toEqual([]);
    });

    it('should emit after adding a cursor', async () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      const cursors = await firstValueFrom(overlay.cursors$.pipe(take(1)));
      expect(cursors).toHaveLength(1);
    });
  });

  describe('events$', () => {
    it('should emit cursor-updated events', async () => {
      const eventPromise = firstValueFrom(overlay.events$.pipe(take(1)));

      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      const event = await eventPromise;
      expect(event.type).toBe('cursor-updated');
      expect(event.userId).toBe('user-2');
    });

    it('should emit cursor-removed events', async () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      const eventPromise = firstValueFrom(overlay.events$.pipe(take(1)));
      overlay.removeCursor('user-2');

      const event = await eventPromise;
      expect(event.type).toBe('cursor-removed');
    });

    it('should emit selection-updated events', async () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      const eventPromise = firstValueFrom(overlay.events$.pipe(take(1)));
      overlay.updateRemoteSelection('user-2', {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 10 },
      });

      const event = await eventPromise;
      expect(event.type).toBe('selection-updated');
    });
  });

  describe('cursor smoothing', () => {
    it('should interpolate position when smoothing is enabled', () => {
      overlay.destroy();
      overlay = createCursorOverlay({
        localUserId: 'local-user',
        throttleMs: 0,
        smoothingEnabled: true,
        smoothingFactor: 0.5,
        staleTimeoutMs: 30_000,
      });

      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 0, column: 0 },
      });
      vi.advanceTimersByTime(10);

      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 10, column: 20 },
      });
      vi.advanceTimersByTime(10);

      const cursor = overlay.getCursor('user-2');
      // With smoothing factor 0.5 from (0,0) to (10,20): (5, 10)
      expect(cursor!.position.line).toBe(5);
      expect(cursor!.position.column).toBe(10);
    });
  });

  describe('stale cursor detection', () => {
    it('should remove stale cursors after timeout', () => {
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      expect(overlay.getCursors()).toHaveLength(1);

      // Advance past stale timeout (30s) plus a full check interval (15s) to
      // ensure the periodic check fires after the cursor is truly stale.
      vi.advanceTimersByTime(50_000);

      expect(overlay.getCursors()).toHaveLength(0);
    });
  });

  describe('local user cursor exclusion', () => {
    it('should ignore cursors from the local user', () => {
      overlay.updateRemoteCursor({
        userId: 'local-user',
        name: 'Local',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      expect(overlay.getCursors()).toHaveLength(0);
    });

    it('should ignore selections from the local user', () => {
      overlay.updateRemoteSelection('local-user', {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 10 },
      });

      expect(overlay.getCursors()).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      overlay.destroy();

      // After destroy, operations should be no-ops
      overlay.updateRemoteCursor({
        userId: 'user-2',
        name: 'Alice',
        position: { line: 1, column: 1 },
      });
      vi.advanceTimersByTime(10);

      // getCursors still works but no new cursors were added
      expect(overlay.getCursors()).toHaveLength(0);
    });

    it('should be idempotent', () => {
      overlay.destroy();
      expect(() => overlay.destroy()).not.toThrow();
    });
  });
});

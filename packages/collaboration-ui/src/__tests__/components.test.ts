import { describe, expect, it } from 'vitest';
import {
  assignColor,
  createCollaborationPresence,
  cursorStyles,
  formatTypingMessage,
  hasContrast,
  selectionStyles,
} from '../index.js';

describe('assignColor', () => {
  it('should return a hex color', () => {
    expect(assignColor('user-1')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('should be deterministic for same user', () => {
    expect(assignColor('alice')).toBe(assignColor('alice'));
  });

  it('should vary across users', () => {
    const colors = new Set(['alice', 'bob', 'carol', 'dave', 'eve'].map(assignColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('hasContrast', () => {
  it('should detect good contrast (black on white)', () => {
    expect(hasContrast('#000000', '#FFFFFF')).toBe(true);
  });

  it('should detect poor contrast (white on white)', () => {
    expect(hasContrast('#FFFFFF', '#FEFEFE')).toBe(false);
  });
});

describe('formatTypingMessage', () => {
  it('should return empty for no typists', () => {
    expect(formatTypingMessage([])).toBe('');
  });

  it('should format single typist', () => {
    expect(
      formatTypingMessage([
        { userId: 'u1', displayName: 'Alice', isTyping: true, lastTyped: Date.now() },
      ])
    ).toBe('Alice is typing...');
  });

  it('should format two typists', () => {
    expect(
      formatTypingMessage([
        { userId: 'u1', displayName: 'Alice', isTyping: true, lastTyped: Date.now() },
        { userId: 'u2', displayName: 'Bob', isTyping: true, lastTyped: Date.now() },
      ])
    ).toBe('Alice and Bob are typing...');
  });

  it('should format many typists', () => {
    expect(
      formatTypingMessage([
        { userId: 'u1', displayName: 'Alice', isTyping: true, lastTyped: Date.now() },
        { userId: 'u2', displayName: 'Bob', isTyping: true, lastTyped: Date.now() },
        { userId: 'u3', displayName: 'Carol', isTyping: true, lastTyped: Date.now() },
      ])
    ).toBe('Alice and 2 others are typing...');
  });

  it('should ignore non-typing users', () => {
    expect(
      formatTypingMessage([
        { userId: 'u1', displayName: 'Alice', isTyping: false, lastTyped: Date.now() },
      ])
    ).toBe('');
  });
});

describe('cursorStyles', () => {
  it('should generate absolute positioning styles', () => {
    const styles = cursorStyles({
      userId: 'u1',
      displayName: 'Alice',
      position: { x: 100, y: 200 },
      color: '#E06C75',
      lastUpdated: Date.now(),
      isActive: true,
    });
    expect(styles.position).toBe('absolute');
    expect(styles.left).toBe('100px');
    expect(styles.top).toBe('200px');
    expect(styles.pointerEvents).toBe('none');
  });

  it('should fade stale cursors', () => {
    const styles = cursorStyles(
      {
        userId: 'u1',
        displayName: 'Alice',
        position: { x: 0, y: 0 },
        color: '#E06C75',
        lastUpdated: Date.now() - 60000,
        isActive: true,
      },
      { fadeTimeoutMs: 30000 }
    );
    expect(styles.opacity).toBe('0');
  });
});

describe('selectionStyles', () => {
  it('should return semi-transparent background', () => {
    const styles = selectionStyles({
      userId: 'u1',
      displayName: 'Alice',
      start: 0,
      end: 10,
      color: '#61AFEF',
      lastUpdated: Date.now(),
    });
    expect(styles.opacity).toBe('0.25');
    expect(styles.backgroundColor).toBe('#61AFEF');
  });
});

describe('CollaborationPresence', () => {
  it('should track cursor updates', () => {
    const p = createCollaborationPresence();
    p.updateCursor('u1', 'Alice', 50, 100);
    const cursors = p.getCursors();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]!.position).toEqual({ x: 50, y: 100 });
    p.destroy();
  });

  it('should track selections', () => {
    const p = createCollaborationPresence();
    p.updateSelection('u1', 'Alice', 5, 15);
    expect(p.getSelections()).toHaveLength(1);
    p.destroy();
  });

  it('should track typing', () => {
    const p = createCollaborationPresence();
    p.setTyping('u1', 'Alice', true);
    expect(p.getTypingMessage()).toBe('Alice is typing...');
    p.destroy();
  });

  it('should remove users', () => {
    const p = createCollaborationPresence();
    p.updateCursor('u1', 'Alice', 0, 0);
    p.removeUser('u1');
    expect(p.getCursors()).toHaveLength(0);
    p.destroy();
  });

  it('should emit changes', () => {
    const p = createCollaborationPresence();
    const changes: string[] = [];
    const sub = p.changes.subscribe((c) => changes.push(c.type));
    p.updateCursor('u1', 'Alice', 0, 0);
    p.setTyping('u1', 'Alice', true);
    sub.unsubscribe();
    expect(changes).toEqual(['cursor', 'typing']);
    p.destroy();
  });

  it('should generate cursor CSS styles', () => {
    const p = createCollaborationPresence();
    p.updateCursor('u1', 'Alice', 25, 75);
    const styles = p.getCursorStyles('u1');
    expect(styles).not.toBeNull();
    expect(styles!.left).toBe('25px');
    p.destroy();
  });
});

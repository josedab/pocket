import { describe, it, expect } from 'vitest';
import {
  buildCursorDescriptors,
  buildPresenceDescriptors,
  buildStatusDescriptor,
  COLLAB_CSS_VARS,
  type CollabCursorsProps,
  type PresenceBarProps,
} from '../react-components.js';
import type { CollabCursor, CollabUser } from '../types.js';

describe('Collaboration React Components', () => {
  describe('buildCursorDescriptors', () => {
    it('should build descriptors from cursors', () => {
      const users = new Map<string, CollabUser>([
        ['u1', { id: 'u1', name: 'Alice', color: '#FF0000' }],
      ]);
      const cursors: CollabCursor[] = [
        { userId: 'u1', documentId: 'd1', offset: 10, timestamp: Date.now() },
      ];
      const result = buildCursorDescriptors({ cursors, users });
      expect(result).toHaveLength(1);
      expect(result[0]!.userName).toBe('Alice');
      expect(result[0]!.color).toBe('#FF0000');
    });

    it('should filter out stale cursors', () => {
      const users = new Map<string, CollabUser>();
      const cursors: CollabCursor[] = [
        { userId: 'u1', documentId: 'd1', offset: 0, timestamp: Date.now() - 100_000 },
      ];
      const result = buildCursorDescriptors({ cursors, users, fadeTimeoutMs: 5000 });
      expect(result).toHaveLength(0);
    });

    it('should keep all cursors when fadeTimeout is 0', () => {
      const users = new Map<string, CollabUser>();
      const cursors: CollabCursor[] = [
        { userId: 'u1', documentId: 'd1', offset: 0, timestamp: 1 },
      ];
      const result = buildCursorDescriptors({ cursors, users, fadeTimeoutMs: 0 });
      expect(result).toHaveLength(1);
    });

    it('should assign color for unknown users', () => {
      const result = buildCursorDescriptors({
        cursors: [{ userId: 'u1', documentId: 'd1', offset: 0, timestamp: Date.now() }],
        users: new Map(),
      });
      expect(result[0]!.color).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  describe('buildPresenceDescriptors', () => {
    it('should build avatar descriptors', () => {
      const users: CollabUser[] = [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob Smith' },
      ];
      const result = buildPresenceDescriptors({ users });
      expect(result.visible).toHaveLength(2);
      expect(result.visible[0]!.initials).toBe('A');
      expect(result.visible[1]!.initials).toBe('BS');
      expect(result.overflowCount).toBe(0);
    });

    it('should respect maxVisible', () => {
      const users: CollabUser[] = Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        name: `User ${i}`,
      }));
      const result = buildPresenceDescriptors({ users, maxVisible: 3 });
      expect(result.visible).toHaveLength(3);
      expect(result.overflowCount).toBe(7);
    });

    it('should exclude current user', () => {
      const users: CollabUser[] = [
        { id: 'me', name: 'Me' },
        { id: 'other', name: 'Other' },
      ];
      const result = buildPresenceDescriptors({ users, currentUserId: 'me' });
      expect(result.visible).toHaveLength(1);
      expect(result.visible[0]!.userId).toBe('other');
    });
  });

  describe('buildStatusDescriptor', () => {
    it('should return connected status as green', () => {
      const result = buildStatusDescriptor({ status: 'connected' });
      expect(result.isConnected).toBe(true);
      expect(result.color).toBe('#27AE60');
      expect(result.label).toBe('Connected');
    });

    it('should return disconnected status as red', () => {
      const result = buildStatusDescriptor({ status: 'disconnected' });
      expect(result.isConnected).toBe(false);
      expect(result.color).toBe('#E74C3C');
    });

    it('should hide text when showText is false', () => {
      const result = buildStatusDescriptor({ status: 'connected', showText: false });
      expect(result.label).toBe('');
    });

    it('should handle all status values', () => {
      const statuses = ['idle', 'connecting', 'connected', 'reconnecting', 'disconnected'] as const;
      for (const status of statuses) {
        const result = buildStatusDescriptor({ status });
        expect(result.status).toBe(status);
        expect(result.color).toBeTruthy();
      }
    });
  });

  describe('COLLAB_CSS_VARS', () => {
    it('should define all expected CSS variables', () => {
      expect(COLLAB_CSS_VARS['--collab-cursor-width']).toBe('2px');
      expect(COLLAB_CSS_VARS['--collab-avatar-size']).toBe('32px');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take } from 'rxjs';
import {
  createPermissionsManager,
  PermissionsManager,
  type PermissionChangeEvent,
} from '../permissions.js';

describe('PermissionsManager', () => {
  let perms: PermissionsManager;

  const ROOM = 'room-1';
  const COL = 'col-1';
  const DOC = 'doc-1';
  const USER = 'user-1';

  beforeEach(() => {
    perms = createPermissionsManager({ defaultRole: 'viewer' });
  });

  afterEach(() => {
    perms.destroy();
  });

  describe('createPermissionsManager', () => {
    it('should return a PermissionsManager instance', () => {
      expect(perms).toBeInstanceOf(PermissionsManager);
    });

    it('should use viewer as default role when not specified', () => {
      const mgr = createPermissionsManager();
      const role = mgr.getEffectiveRole(ROOM, COL, DOC, USER);
      expect(role).toBe('viewer');
      mgr.destroy();
    });
  });

  describe('setRoomRole', () => {
    it('should assign a role at room level', () => {
      perms.setRoomRole(ROOM, USER, 'admin');

      const role = perms.getEffectiveRole(ROOM, COL, DOC, USER);
      expect(role).toBe('admin');
    });
  });

  describe('setCollectionRole', () => {
    it('should assign a role at collection level', () => {
      perms.setCollectionRole(ROOM, COL, USER, 'editor');

      const role = perms.getEffectiveRole(ROOM, COL, DOC, USER);
      expect(role).toBe('editor');
    });
  });

  describe('setDocumentRole', () => {
    it('should assign a role at document level', () => {
      perms.setDocumentRole(ROOM, COL, DOC, USER, 'commenter');

      const role = perms.getEffectiveRole(ROOM, COL, DOC, USER);
      expect(role).toBe('commenter');
    });
  });

  describe('getEffectiveRole', () => {
    it('should inherit room-level role down', () => {
      perms.setRoomRole(ROOM, USER, 'editor');

      expect(perms.getEffectiveRole(ROOM, COL, DOC, USER)).toBe('editor');
      expect(perms.getEffectiveRole(ROOM, 'other-col', 'other-doc', USER)).toBe(
        'editor',
      );
    });

    it('should override with collection-level role', () => {
      perms.setRoomRole(ROOM, USER, 'viewer');
      perms.setCollectionRole(ROOM, COL, USER, 'editor');

      expect(perms.getEffectiveRole(ROOM, COL, DOC, USER)).toBe('editor');
    });

    it('should override with document-level role', () => {
      perms.setRoomRole(ROOM, USER, 'viewer');
      perms.setCollectionRole(ROOM, COL, USER, 'editor');
      perms.setDocumentRole(ROOM, COL, DOC, USER, 'admin');

      expect(perms.getEffectiveRole(ROOM, COL, DOC, USER)).toBe('admin');
    });

    it('should return default role when none is set', () => {
      const role = perms.getEffectiveRole(ROOM, COL, DOC, 'unknown-user');
      expect(role).toBe('viewer');
    });
  });

  describe('canRead', () => {
    it('should return true for viewer', () => {
      perms.setRoomRole(ROOM, USER, 'viewer');
      expect(perms.canRead(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return true for higher roles', () => {
      perms.setRoomRole(ROOM, USER, 'editor');
      expect(perms.canRead(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return true for default viewer role', () => {
      expect(perms.canRead(ROOM, COL, DOC, 'no-role-user')).toBe(true);
    });
  });

  describe('canWrite', () => {
    it('should return true for editor', () => {
      perms.setRoomRole(ROOM, USER, 'editor');
      expect(perms.canWrite(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return false for viewer', () => {
      perms.setRoomRole(ROOM, USER, 'viewer');
      expect(perms.canWrite(ROOM, COL, DOC, USER)).toBe(false);
    });

    it('should return false for commenter', () => {
      perms.setRoomRole(ROOM, USER, 'commenter');
      expect(perms.canWrite(ROOM, COL, DOC, USER)).toBe(false);
    });
  });

  describe('canDelete', () => {
    it('should return true for admin', () => {
      perms.setRoomRole(ROOM, USER, 'admin');
      expect(perms.canDelete(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return false for editor', () => {
      perms.setRoomRole(ROOM, USER, 'editor');
      expect(perms.canDelete(ROOM, COL, DOC, USER)).toBe(false);
    });
  });

  describe('canComment', () => {
    it('should return true for commenter', () => {
      perms.setRoomRole(ROOM, USER, 'commenter');
      expect(perms.canComment(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return false for viewer', () => {
      perms.setRoomRole(ROOM, USER, 'viewer');
      expect(perms.canComment(ROOM, COL, DOC, USER)).toBe(false);
    });

    it('should return true for editor (higher than commenter)', () => {
      perms.setRoomRole(ROOM, USER, 'editor');
      expect(perms.canComment(ROOM, COL, DOC, USER)).toBe(true);
    });
  });

  describe('canAdmin', () => {
    it('should return true for admin', () => {
      perms.setRoomRole(ROOM, USER, 'admin');
      expect(perms.canAdmin(ROOM, COL, DOC, USER)).toBe(true);
    });

    it('should return false for editor', () => {
      perms.setRoomRole(ROOM, USER, 'editor');
      expect(perms.canAdmin(ROOM, COL, DOC, USER)).toBe(false);
    });
  });

  describe('owner role', () => {
    it('should have all permissions', () => {
      perms.setRoomRole(ROOM, USER, 'owner');

      expect(perms.canRead(ROOM, COL, DOC, USER)).toBe(true);
      expect(perms.canWrite(ROOM, COL, DOC, USER)).toBe(true);
      expect(perms.canDelete(ROOM, COL, DOC, USER)).toBe(true);
      expect(perms.canComment(ROOM, COL, DOC, USER)).toBe(true);
      expect(perms.canAdmin(ROOM, COL, DOC, USER)).toBe(true);
    });
  });

  describe('getEntriesForUser', () => {
    it('should return all entries for a user', () => {
      perms.setRoomRole(ROOM, USER, 'admin');
      perms.setCollectionRole(ROOM, COL, USER, 'editor');
      perms.setDocumentRole(ROOM, COL, DOC, USER, 'viewer');

      const entries = perms.getEntriesForUser(USER);
      expect(entries).toHaveLength(3);
      entries.forEach((e) => expect(e.userId).toBe(USER));
    });

    it('should return empty array for unknown user', () => {
      expect(perms.getEntriesForUser('unknown')).toHaveLength(0);
    });
  });

  describe('changes$', () => {
    it('should emit on role changes', async () => {
      const eventPromise = firstValueFrom(perms.changes$.pipe(take(1)));

      perms.setRoomRole(ROOM, USER, 'admin');

      const event = await eventPromise;
      expect(event.type).toBe('role-granted');
      expect(event.entry.userId).toBe(USER);
      expect(event.entry.role).toBe('admin');
      expect(event.entry.scope).toBe('room');
    });

    it('should emit role-revoked on removal', async () => {
      perms.setRoomRole(ROOM, USER, 'admin');

      const eventPromise = firstValueFrom(perms.changes$.pipe(take(1)));
      perms.removeRoomRole(ROOM, USER);

      const event = await eventPromise;
      expect(event.type).toBe('role-revoked');
    });
  });

  describe('default role', () => {
    it('should use custom default role', () => {
      const mgr = createPermissionsManager({ defaultRole: 'commenter' });

      const role = mgr.getEffectiveRole(ROOM, COL, DOC, USER);
      expect(role).toBe('commenter');
      mgr.destroy();
    });
  });

  describe('destroy', () => {
    it('should throw on operations after destroy', () => {
      perms.destroy();

      expect(() => perms.setRoomRole(ROOM, USER, 'admin')).toThrow(
        'PermissionsManager has been destroyed',
      );
    });

    it('should be idempotent', () => {
      perms.destroy();
      expect(() => perms.destroy()).not.toThrow();
    });
  });
});

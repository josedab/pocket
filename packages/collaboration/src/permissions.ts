/**
 * Role-based permissions manager for collaborative documents and collections.
 *
 * Supports per-room, per-collection, and per-document permissions with
 * inheritance and real-time change notifications via RxJS.
 *
 * @example
 * ```typescript
 * import { createPermissionsManager } from '@pocket/collaboration';
 *
 * const perms = createPermissionsManager({ defaultRole: 'viewer' });
 *
 * perms.setRoomRole('room-1', 'user-1', 'admin');
 * perms.setDocumentRole('room-1', 'col-1', 'doc-1', 'user-2', 'editor');
 *
 * perms.canWrite('room-1', 'col-1', 'doc-1', 'user-1');  // true (admin)
 * perms.canWrite('room-1', 'col-1', 'doc-1', 'user-2');  // true (editor)
 * perms.canDelete('room-1', 'col-1', 'doc-1', 'user-2'); // false
 *
 * perms.changes$.subscribe(event => console.log(event));
 * ```
 *
 * @module @pocket/collaboration/permissions
 */

import { Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export type PermissionRole = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer';

export type PermissionScope = 'room' | 'collection' | 'document';

export interface PermissionEntry {
  userId: string;
  role: PermissionRole;
  scope: PermissionScope;
  roomId: string;
  collectionId?: string;
  documentId?: string;
  grantedAt: number;
}

export interface PermissionChangeEvent {
  type: 'role-granted' | 'role-revoked';
  entry: PermissionEntry;
  changedBy?: string;
  timestamp: number;
}

export interface PermissionsConfig {
  /** Default role for users without an explicit assignment (default: 'viewer'). */
  defaultRole?: PermissionRole;
}

// ── Role hierarchy ─────────────────────────────────────────

const ROLE_LEVELS: Record<PermissionRole, number> = {
  owner: 50,
  admin: 40,
  editor: 30,
  commenter: 20,
  viewer: 10,
};

function roleAtLeast(role: PermissionRole, minimum: PermissionRole): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS[minimum];
}

// ── Key helpers ────────────────────────────────────────────

function roomKey(roomId: string, userId: string): string {
  return `room:${roomId}:${userId}`;
}

function collectionKey(roomId: string, collectionId: string, userId: string): string {
  return `col:${roomId}:${collectionId}:${userId}`;
}

function documentKey(roomId: string, collectionId: string, documentId: string, userId: string): string {
  return `doc:${roomId}:${collectionId}:${documentId}:${userId}`;
}

// ── PermissionsManager ─────────────────────────────────────

/**
 * PermissionsManager — role-based access control with permission inheritance.
 *
 * Permissions are resolved from the most specific scope first (document →
 * collection → room). If no explicit assignment exists at any level the
 * configured `defaultRole` is returned.
 */
export class PermissionsManager {
  private readonly defaultRole: PermissionRole;
  private readonly entries: Map<string, PermissionEntry>;
  private readonly changesSubject: Subject<PermissionChangeEvent>;
  private destroyed = false;

  constructor(config: PermissionsConfig = {}) {
    this.defaultRole = config.defaultRole ?? 'viewer';
    this.entries = new Map();
    this.changesSubject = new Subject<PermissionChangeEvent>();
  }

  // ── Observables ────────────────────────────────────────

  /** Reactive stream of permission change events. */
  get changes$(): Observable<PermissionChangeEvent> {
    return this.changesSubject.asObservable();
  }

  // ── Role setters ───────────────────────────────────────

  /** Assign a role at the room level. */
  setRoomRole(roomId: string, userId: string, role: PermissionRole): void {
    this.assertNotDestroyed();

    const entry: PermissionEntry = {
      userId,
      role,
      scope: 'room',
      roomId,
      grantedAt: Date.now(),
    };

    this.entries.set(roomKey(roomId, userId), entry);
    this.emitChange('role-granted', entry);
  }

  /** Assign a role at the collection level. */
  setCollectionRole(roomId: string, collectionId: string, userId: string, role: PermissionRole): void {
    this.assertNotDestroyed();

    const entry: PermissionEntry = {
      userId,
      role,
      scope: 'collection',
      roomId,
      collectionId,
      grantedAt: Date.now(),
    };

    this.entries.set(collectionKey(roomId, collectionId, userId), entry);
    this.emitChange('role-granted', entry);
  }

  /** Assign a role at the document level. */
  setDocumentRole(
    roomId: string,
    collectionId: string,
    documentId: string,
    userId: string,
    role: PermissionRole,
  ): void {
    this.assertNotDestroyed();

    const entry: PermissionEntry = {
      userId,
      role,
      scope: 'document',
      roomId,
      collectionId,
      documentId,
      grantedAt: Date.now(),
    };

    this.entries.set(documentKey(roomId, collectionId, documentId, userId), entry);
    this.emitChange('role-granted', entry);
  }

  // ── Role removal ───────────────────────────────────────

  /** Remove a room-level role assignment. */
  removeRoomRole(roomId: string, userId: string): void {
    this.removeEntry(roomKey(roomId, userId));
  }

  /** Remove a collection-level role assignment. */
  removeCollectionRole(roomId: string, collectionId: string, userId: string): void {
    this.removeEntry(collectionKey(roomId, collectionId, userId));
  }

  /** Remove a document-level role assignment. */
  removeDocumentRole(roomId: string, collectionId: string, documentId: string, userId: string): void {
    this.removeEntry(documentKey(roomId, collectionId, documentId, userId));
  }

  // ── Role resolution ────────────────────────────────────

  /**
   * Resolve the effective role for a user on a document.
   *
   * Checks document → collection → room (most specific wins).
   * Falls back to `defaultRole` when no assignment is found.
   */
  getEffectiveRole(roomId: string, collectionId: string, documentId: string, userId: string): PermissionRole {
    const docEntry = this.entries.get(documentKey(roomId, collectionId, documentId, userId));
    if (docEntry) return docEntry.role;

    const colEntry = this.entries.get(collectionKey(roomId, collectionId, userId));
    if (colEntry) return colEntry.role;

    const rmEntry = this.entries.get(roomKey(roomId, userId));
    if (rmEntry) return rmEntry.role;

    return this.defaultRole;
  }

  // ── Permission checks ──────────────────────────────────

  /** Check if the user can read (viewer+). */
  canRead(roomId: string, collectionId: string, documentId: string, userId: string): boolean {
    return roleAtLeast(this.getEffectiveRole(roomId, collectionId, documentId, userId), 'viewer');
  }

  /** Check if the user can write (editor+). */
  canWrite(roomId: string, collectionId: string, documentId: string, userId: string): boolean {
    return roleAtLeast(this.getEffectiveRole(roomId, collectionId, documentId, userId), 'editor');
  }

  /** Check if the user can delete (admin+). */
  canDelete(roomId: string, collectionId: string, documentId: string, userId: string): boolean {
    return roleAtLeast(this.getEffectiveRole(roomId, collectionId, documentId, userId), 'admin');
  }

  /** Check if the user can comment (commenter+). */
  canComment(roomId: string, collectionId: string, documentId: string, userId: string): boolean {
    return roleAtLeast(this.getEffectiveRole(roomId, collectionId, documentId, userId), 'commenter');
  }

  /** Check if the user can administer (admin+). */
  canAdmin(roomId: string, collectionId: string, documentId: string, userId: string): boolean {
    return roleAtLeast(this.getEffectiveRole(roomId, collectionId, documentId, userId), 'admin');
  }

  // ── Queries ────────────────────────────────────────────

  /** List all permission entries for a specific user. */
  getEntriesForUser(userId: string): PermissionEntry[] {
    const result: PermissionEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.userId === userId) {
        result.push(entry);
      }
    }
    return result;
  }

  /** List all permission entries for a specific room. */
  getEntriesForRoom(roomId: string): PermissionEntry[] {
    const result: PermissionEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.roomId === roomId) {
        result.push(entry);
      }
    }
    return result;
  }

  // ── Lifecycle ──────────────────────────────────────────

  /** Tear down streams and release resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.changesSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private removeEntry(key: string): void {
    this.assertNotDestroyed();

    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.emitChange('role-revoked', entry);
    }
  }

  private emitChange(type: PermissionChangeEvent['type'], entry: PermissionEntry): void {
    this.changesSubject.next({
      type,
      entry,
      timestamp: Date.now(),
    });
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('PermissionsManager has been destroyed');
    }
  }
}

/**
 * Create a new PermissionsManager instance.
 */
export function createPermissionsManager(config: PermissionsConfig = {}): PermissionsManager {
  return new PermissionsManager(config);
}

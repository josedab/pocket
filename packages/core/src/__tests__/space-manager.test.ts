import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  SpaceManager,
  createSpaceManager,
  type Space,
} from '../spaces/space-manager.js';

describe('SpaceManager', () => {
  let manager: SpaceManager;

  beforeEach(() => {
    manager = createSpaceManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // ── Create and list spaces ───────────────────────────────────

  it('should create and list spaces', () => {
    const space = manager.createSpace('Workspace A', 'user-1');
    expect(space.name).toBe('Workspace A');
    expect(space.id).toBeDefined();
    expect(space.collections).toEqual([]);
    expect(space.memberCount).toBe(1);

    const spaces = manager.listSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].id).toBe(space.id);
  });

  // ── Delete space ─────────────────────────────────────────────

  it('should delete a space', () => {
    const space = manager.createSpace('To Delete', 'user-1');
    expect(manager.deleteSpace(space.id)).toBe(true);
    expect(manager.getSpace(space.id)).toBeUndefined();
    expect(manager.listSpaces()).toHaveLength(0);
  });

  it('should return false when deleting non-existent space', () => {
    expect(manager.deleteSpace('no-such-id')).toBe(false);
  });

  // ── Rename space ─────────────────────────────────────────────

  it('should rename a space', () => {
    const space = manager.createSpace('Old Name', 'user-1');
    manager.renameSpace(space.id, 'New Name');
    expect(manager.getSpace(space.id)!.name).toBe('New Name');
  });

  it('should throw when renaming non-existent space', () => {
    expect(() => manager.renameSpace('bad-id', 'x')).toThrow('not found');
  });

  // ── Add / remove members ─────────────────────────────────────

  it('should add and remove members', () => {
    const space = manager.createSpace('Team', 'owner-1');
    const member = manager.addMember(space.id, 'user-2', 'admin');
    expect(member.role).toBe('admin');
    expect(manager.getMembers(space.id)).toHaveLength(2);

    expect(manager.removeMember(space.id, 'user-2')).toBe(true);
    expect(manager.getMembers(space.id)).toHaveLength(1);
  });

  it('should return false when removing non-existent member', () => {
    const space = manager.createSpace('S', 'owner-1');
    expect(manager.removeMember(space.id, 'ghost')).toBe(false);
  });

  // ── Member roles ─────────────────────────────────────────────

  it('should return member roles', () => {
    const space = manager.createSpace('Roles', 'owner-1');
    manager.addMember(space.id, 'viewer-1', 'viewer');

    expect(manager.getMemberRole(space.id, 'owner-1')).toBe('owner');
    expect(manager.getMemberRole(space.id, 'viewer-1')).toBe('viewer');
    expect(manager.getMemberRole(space.id, 'unknown')).toBeNull();
  });

  it('should return null for role in non-existent space', () => {
    expect(manager.getMemberRole('nope', 'user')).toBeNull();
  });

  // ── Register collections ─────────────────────────────────────

  it('should register collections to a space', () => {
    const space = manager.createSpace('Data', 'user-1');
    manager.registerCollection(space.id, 'todos');
    manager.registerCollection(space.id, 'notes');
    // Duplicate registration should be idempotent
    manager.registerCollection(space.id, 'todos');

    expect(manager.getSpaceCollections(space.id)).toEqual(['todos', 'notes']);
  });

  it('should throw when registering to non-existent space', () => {
    expect(() => manager.registerCollection('bad', 'col')).toThrow('not found');
  });

  // ── Resolve namespaced collection names ──────────────────────

  it('should resolve namespaced collection names', () => {
    const resolved = manager.resolveCollectionName('abc-123', 'todos');
    expect(resolved).toBe('space__abc-123__todos');
  });

  // ── Stats tracking ───────────────────────────────────────────

  it('should track stats', () => {
    const s1 = manager.createSpace('S1', 'u1');
    const s2 = manager.createSpace('S2', 'u2');
    manager.addMember(s1.id, 'u3');
    manager.registerCollection(s1.id, 'col-a');
    manager.registerCollection(s2.id, 'col-b');
    manager.registerCollection(s2.id, 'col-c');

    const stats = manager.getStats();
    expect(stats.totalSpaces).toBe(2);
    expect(stats.totalMembers).toBe(3); // u1, u3 in s1 + u2 in s2
    expect(stats.collectionsPerSpace.get(s1.id)).toBe(1);
    expect(stats.collectionsPerSpace.get(s2.id)).toBe(2);
  });

  // ── Max spaces limit ─────────────────────────────────────────

  it('should enforce max spaces limit', () => {
    const limited = createSpaceManager({ maxSpaces: 2 });
    limited.createSpace('A', 'u1');
    limited.createSpace('B', 'u2');
    expect(() => limited.createSpace('C', 'u3')).toThrow('Maximum number of spaces');
    limited.dispose();
  });

  // ── Observable emissions ─────────────────────────────────────

  it('should emit space list via observable', async () => {
    const emissions: Space[][] = [];
    const sub = manager.spaces$.subscribe((v) => emissions.push(v));

    manager.createSpace('O1', 'u1');
    manager.createSpace('O2', 'u2');

    // Initial [] + 2 creates = 3 emissions
    expect(emissions).toHaveLength(3);
    expect(emissions[0]).toHaveLength(0);
    expect(emissions[1]).toHaveLength(1);
    expect(emissions[2]).toHaveLength(2);

    sub.unsubscribe();
  });

  // ── Cannot add duplicate member ──────────────────────────────

  it('should throw when adding a duplicate member', () => {
    const space = manager.createSpace('Dup', 'owner-1');
    manager.addMember(space.id, 'user-x', 'member');
    expect(() => manager.addMember(space.id, 'user-x', 'admin')).toThrow(
      'already a member',
    );
  });

  it('should throw when adding member to owner userId (already present)', () => {
    const space = manager.createSpace('Dup2', 'owner-1');
    expect(() => manager.addMember(space.id, 'owner-1', 'admin')).toThrow(
      'already a member',
    );
  });
});

import type { Document } from '@pocket/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictAnalyzer, createConflictAnalyzer } from '../conflict-analyzer.js';
import type { Conflict } from '../types.js';

interface TestDoc extends Document {
  _id: string;
  name?: string;
  email?: string;
  age?: number;
  role?: string;
  status?: string;
  _updatedAt?: number;
  _version?: number;
}

function makeConflict(overrides: Partial<Conflict<TestDoc>> = {}): Conflict<TestDoc> {
  return {
    id: 'conflict-1',
    type: 'update_update',
    collection: 'users',
    documentId: 'doc-1',
    local: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
    remote: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
    base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
    detectedAt: Date.now(),
    ...overrides,
  };
}

describe('ConflictAnalyzer', () => {
  let analyzer: ConflictAnalyzer;

  beforeEach(() => {
    analyzer = createConflictAnalyzer();
  });

  describe('createConflictAnalyzer()', () => {
    it('should return a ConflictAnalyzer instance', () => {
      expect(analyzer).toBeInstanceOf(ConflictAnalyzer);
    });
  });

  describe('analyze()', () => {
    it('should detect local-only changes', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.localOnlyChanges).toContain('name');
      expect(result.remoteOnlyChanges).not.toContain('name');
      expect(result.conflictingFields).not.toContain('name');
    });

    it('should detect remote-only changes', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.remoteOnlyChanges).toContain('email');
      expect(result.localOnlyChanges).not.toContain('email');
      expect(result.conflictingFields).not.toContain('email');
    });

    it('should detect conflicting fields when both sides changed same field differently', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.conflictingFields).toContain('name');
    });

    it('should report canAutoMerge=true when no conflicting fields in update_update', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.canAutoMerge).toBe(true);
      expect(result.conflictingFields).toHaveLength(0);
    });

    it('should report canAutoMerge=false when fields conflict', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.canAutoMerge).toBe(false);
    });

    it('should report canAutoMerge=false for non update_update even with no conflicting fields', () => {
      const conflict = makeConflict({
        type: 'update_delete',
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: null,
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.canAutoMerge).toBe(false);
    });

    it('should suggest merge strategy for auto-mergeable update_update', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedStrategy).toBe('merge');
    });

    it('should suggest manual for delete conflicts', () => {
      const conflict = makeConflict({
        type: 'update_delete',
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: null,
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedStrategy).toBe('manual');
    });

    it('should suggest manual for delete_update conflicts', () => {
      const conflict = makeConflict({
        type: 'delete_update',
        local: null,
        remote: { _id: 'doc-1', name: 'Charlie', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedStrategy).toBe('manual');
    });

    it('should suggest manual for create_create conflicts', () => {
      const conflict = makeConflict({
        type: 'create_create',
        local: { _id: 'doc-1', name: 'Alice' },
        remote: { _id: 'doc-1', name: 'Bob' },
        base: null,
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedStrategy).toBe('manual');
    });

    it('should provide suggestedMerge when canAutoMerge is true', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedMerge).toBeDefined();
      expect(result.suggestedMerge?.name).toBe('Bob');
      expect(result.suggestedMerge?.email).toBe('bob@example.com');
    });

    it('should not provide suggestedMerge when canAutoMerge is false', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedMerge).toBeUndefined();
    });

    it('should skip internal _-prefixed fields when computing field changes', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', _updatedAt: 200, name: 'Alice', age: 30 },
        remote: { _id: 'doc-1', _updatedAt: 100, name: 'Alice', age: 30 },
        base: { _id: 'doc-1', _updatedAt: 50, name: 'Alice', age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.conflictingFields.some((f) => f.startsWith('_'))).toBe(false);
    });

    it('should suggest timestamp strategy when both sides have _updatedAt and conflict', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _updatedAt: 200, age: 30 },
        remote: { _id: 'doc-1', name: 'Charlie', _updatedAt: 100, age: 30 },
        base: { _id: 'doc-1', name: 'Alice', _updatedAt: 50, age: 30 },
      });

      const result = analyzer.analyze(conflict);

      expect(result.suggestedStrategy).toBe('timestamp');
    });
  });

  describe('threeWayMerge()', () => {
    it('should succeed when changes do not overlap', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(true);
      expect(result.merged?.name).toBe('Bob');
      expect(result.merged?.email).toBe('bob@example.com');
      expect(result.merged?.age).toBe(30);
    });

    it('should fail when fields truly conflict', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(false);
      expect(result.unresolvedConflicts).toContain('name');
      expect(result.error).toBeDefined();
    });

    it('should keep base value when neither side changed a field', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(true);
      expect(result.merged?.name).toBe('Alice');
      expect(result.merged?.email).toBe('alice@example.com');
    });

    it('should apply local change when only local changed', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(true);
      expect(result.merged?.name).toBe('Bob');
    });

    it('should apply remote change when only remote changed', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Alice', email: 'bob@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(true);
      expect(result.merged?.email).toBe('bob@example.com');
    });

    it('should fail when local is null (deleted)', () => {
      const conflict = makeConflict({
        local: null,
        remote: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(false);
      expect(result.error).toContain('deleted');
    });

    it('should fail when remote is null (deleted)', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
        remote: null,
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(false);
      expect(result.error).toContain('deleted');
    });

    it('should handle both sides changing same field to same value (no conflict)', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.threeWayMerge(conflict);

      expect(result.success).toBe(true);
      expect(result.merged?.name).toBe('Bob');
    });

    it('should use local as foundation when base is null', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        remote: { _id: 'doc-1', name: 'Bob', email: 'alice@example.com', age: 30 },
        base: null,
      });

      const result = analyzer.threeWayMerge(conflict);

      // When base is null, all fields are "changed" from base
      // Both sides have same values so no conflict
      expect(result.success).toBe(true);
    });
  });

  describe('mergeByTimestamp()', () => {
    it('should pick the newer document based on _updatedAt', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _updatedAt: 100 },
        remote: { _id: 'doc-1', name: 'Charlie', _updatedAt: 200 },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should pick local when timestamps are equal', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _updatedAt: 100 },
        remote: { _id: 'doc-1', name: 'Charlie', _updatedAt: 100 },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should default to local when no timestamps are present', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob' },
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should return remote when only remote has timestamp', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob' },
        remote: { _id: 'doc-1', name: 'Charlie', _updatedAt: 100 },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should return local when only local has timestamp', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _updatedAt: 100 },
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should return remote when local is null', () => {
      const conflict = makeConflict({
        local: null,
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should return local when remote is null', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob' },
        remote: null,
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should return null when both sides are null', () => {
      const conflict = makeConflict({
        local: null,
        remote: null,
      });

      const result = analyzer.mergeByTimestamp(conflict);

      expect(result).toBeNull();
    });
  });

  describe('mergeByVersion()', () => {
    it('should pick the higher version document', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _version: 2 },
        remote: { _id: 'doc-1', name: 'Charlie', _version: 5 },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should pick local when versions are equal', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _version: 3 },
        remote: { _id: 'doc-1', name: 'Charlie', _version: 3 },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should default to local when no versions are present', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob' },
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should return remote when only remote has version', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob' },
        remote: { _id: 'doc-1', name: 'Charlie', _version: 2 },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should return local when only local has version', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', _version: 2 },
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Bob');
    });

    it('should return remote when local is null', () => {
      const conflict = makeConflict({
        local: null,
        remote: { _id: 'doc-1', name: 'Charlie' },
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result?.name).toBe('Charlie');
    });

    it('should return null when both sides are null', () => {
      const conflict = makeConflict({
        local: null,
        remote: null,
      });

      const result = analyzer.mergeByVersion(conflict);

      expect(result).toBeNull();
    });
  });

  describe('customMerge()', () => {
    it('should select fields from specified sources', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'bob@example.com', age: 25 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'charlie@example.com', age: 35 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      const result = analyzer.customMerge(conflict, {
        name: 'local',
        email: 'remote',
        age: 'base',
      });

      expect(result?.name).toBe('Bob');
      expect(result?.email).toBe('charlie@example.com');
      expect(result?.age).toBe(30);
    });

    it('should use base as starting point', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'bob@example.com', age: 25 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'charlie@example.com', age: 35 },
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      // Only override name; other fields should keep base values
      const result = analyzer.customMerge(conflict, { name: 'remote' });

      expect(result?.name).toBe('Charlie');
      expect(result?.email).toBe('alice@example.com');
      expect(result?.age).toBe(30);
    });

    it('should return null when both local and remote are null', () => {
      const conflict = makeConflict({
        local: null,
        remote: null,
        base: null,
      });

      const result = analyzer.customMerge(conflict, { name: 'local' });

      expect(result).toBeNull();
    });

    it('should handle selecting from a null side gracefully', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'bob@example.com', age: 25 },
        remote: null,
        base: { _id: 'doc-1', name: 'Alice', email: 'alice@example.com', age: 30 },
      });

      // Selecting 'remote' for name should not override since remote is null
      const result = analyzer.customMerge(conflict, { name: 'remote', email: 'local' });

      expect(result).toBeDefined();
      expect(result?.email).toBe('bob@example.com');
    });

    it('should fall back to local/remote when base is null', () => {
      const conflict = makeConflict({
        local: { _id: 'doc-1', name: 'Bob', email: 'bob@example.com', age: 25 },
        remote: { _id: 'doc-1', name: 'Charlie', email: 'charlie@example.com', age: 35 },
        base: null,
      });

      const result = analyzer.customMerge(conflict, { name: 'remote' });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Charlie');
    });
  });
});

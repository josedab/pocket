import { describe, it, expect } from 'vitest';
import {
  ConflictResolver,
  detectConflict,
} from '../conflict.js';
import type { Document } from '@pocket/core';

interface TestDoc extends Document {
  _id: string;
  title: string;
  body: string;
  _rev?: string;
  _updatedAt?: number;
}

describe('Sync Edge Cases', () => {
  describe('conflict detection', () => {
    it('should not detect conflict when same revision', () => {
      const local: TestDoc = { _id: '1', title: 'same', body: 'a', _rev: 'r1' };
      const remote: TestDoc = { _id: '1', title: 'same', body: 'a', _rev: 'r1' };
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should not detect conflict when neither has rev', () => {
      const local: TestDoc = { _id: '1', title: 'a', body: 'a' };
      const remote: TestDoc = { _id: '1', title: 'b', body: 'b' };
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should detect conflict when one has rev and other does not', () => {
      const local: TestDoc = { _id: '1', title: 'a', body: 'a', _rev: 'r1' };
      const remote: TestDoc = { _id: '1', title: 'b', body: 'b' };
      expect(detectConflict(local, remote)).toBe(true);
    });
  });

  describe('conflict resolution strategies', () => {
    const makeConflict = (local: TestDoc, remote: TestDoc) => ({
      documentId: local._id,
      localDocument: local,
      remoteDocument: remote,
      timestamp: Date.now(),
    });

    const local: TestDoc = { _id: '1', title: 'local title', body: 'local body', _rev: 'r2', _updatedAt: 200 };
    const remote: TestDoc = { _id: '1', title: 'remote title', body: 'remote body', _rev: 'r3', _updatedAt: 300 };

    it('server-wins should return remote document', () => {
      const resolver = new ConflictResolver<TestDoc>('server-wins');
      const result = resolver.resolve(makeConflict(local, remote));
      expect(result.winner).toBe('remote');
      expect(result.document.title).toBe('remote title');
    });

    it('client-wins should return local document', () => {
      const resolver = new ConflictResolver<TestDoc>('client-wins');
      const result = resolver.resolve(makeConflict(local, remote));
      expect(result.winner).toBe('local');
      expect(result.document.title).toBe('local title');
    });

    it('last-write-wins should return newer document', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const result = resolver.resolve(makeConflict(local, remote));
      expect(result.winner).toBe('remote');
    });

    it('merge should produce a merged result', () => {
      const resolver = new ConflictResolver<TestDoc>('merge');
      const result = resolver.resolve(makeConflict(local, remote));
      expect(result.winner).toBe('merged');
    });
  });

  describe('edge case conflict scenarios', () => {
    it('should handle identical documents as no-conflict', () => {
      const doc: TestDoc = { _id: '1', title: 'same', body: 'same', _rev: 'r1' };
      expect(detectConflict(doc, { ...doc })).toBe(false);
    });

    it('should resolve empty string fields', () => {
      const resolver = new ConflictResolver<TestDoc>('server-wins');
      const result = resolver.resolve({
        documentId: '1',
        localDocument: { _id: '1', title: '', body: '', _rev: 'r1' },
        remoteDocument: { _id: '1', title: '', body: '', _rev: 'r2' },
        timestamp: Date.now(),
      });
      expect(result.document._id).toBe('1');
      expect(result.needsManualResolution).toBe(false);
    });
  });
});

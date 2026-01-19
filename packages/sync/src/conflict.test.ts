import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document, DocumentConflict } from '../../core/src/types/document.js';
import { ConflictResolver, detectConflict, type MergeFunction } from './conflict.js';

interface TestDoc extends Document {
  _id: string;
  _rev?: string;
  _updatedAt?: number;
  _vclock?: Record<string, number>;
  title: string;
  content: string;
  count: number;
}

function createDoc(
  id: string,
  title: string,
  content: string,
  count: number,
  opts: { rev?: string; updatedAt?: number; vclock?: Record<string, number> } = {}
): TestDoc {
  return {
    _id: id,
    _rev: opts.rev,
    _updatedAt: opts.updatedAt,
    _vclock: opts.vclock,
    title,
    content,
    count,
  };
}

describe('ConflictResolver', () => {
  describe('server-wins strategy', () => {
    it('should always return remote document', () => {
      const resolver = new ConflictResolver<TestDoc>('server-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local content', 10),
        remoteDocument: createDoc('1', 'Remote', 'remote content', 20),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('remote');
      expect(result.document.title).toBe('Remote');
      expect(result.needsManualResolution).toBe(false);
    });
  });

  describe('client-wins strategy', () => {
    it('should always return local document', () => {
      const resolver = new ConflictResolver<TestDoc>('client-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local content', 10),
        remoteDocument: createDoc('1', 'Remote', 'remote content', 20),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('local');
      expect(result.document.title).toBe('Local');
      expect(result.needsManualResolution).toBe(false);
    });
  });

  describe('last-write-wins strategy', () => {
    it('should return document with higher updatedAt', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10, { updatedAt: 1000 }),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20, { updatedAt: 2000 }),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('remote');
      expect(result.document.title).toBe('Remote');
    });

    it('should return local when it has higher updatedAt', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10, { updatedAt: 2000 }),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20, { updatedAt: 1000 }),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('local');
      expect(result.document.title).toBe('Local');
    });

    it('should use vector clock when timestamps are equal', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10, {
          updatedAt: 1000,
          vclock: { nodeA: 2, nodeB: 1 },
        }),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20, {
          updatedAt: 1000,
          vclock: { nodeA: 1, nodeB: 1 },
        }),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('local');
    });

    it('should fall back to server-wins when no vector clock', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10, { updatedAt: 1000 }),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20, { updatedAt: 1000 }),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('remote');
    });
  });

  describe('merge strategy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should use custom merge function when provided', () => {
      const customMerge: MergeFunction<TestDoc> = (local, remote) => ({
        ...remote,
        title: `${local.title} + ${remote.title}`,
      });
      const resolver = new ConflictResolver<TestDoc>('merge', customMerge);
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('merged');
      expect(result.document.title).toBe('Local + Remote');
      expect(result.needsManualResolution).toBe(false);
    });

    it('should use default merge when no custom function', () => {
      const resolver = new ConflictResolver<TestDoc>('merge');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local content', 10, { updatedAt: 2000 }),
        remoteDocument: createDoc('1', 'Remote', 'remote content', 20, { updatedAt: 1000 }),
      };

      const result = resolver.resolve(conflict);

      expect(result.winner).toBe('merged');
      // Local has higher timestamp, so its fields should win
      expect(result.document.title).toBe('Local');
      expect(result.document.content).toBe('local content');
    });

    it('should merge based on which fields changed from base', () => {
      const resolver = new ConflictResolver<TestDoc>('merge');
      const baseDoc = createDoc('1', 'Original', 'original content', 5);
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Updated Title', 'original content', 5, { updatedAt: 1000 }),
        remoteDocument: createDoc('1', 'Original', 'updated content', 5, { updatedAt: 1000 }),
        baseDocument: baseDoc,
      };

      const result = resolver.resolve(conflict);

      // Local changed title, remote changed content
      expect(result.document.title).toBe('Updated Title');
      expect(result.document.content).toBe('updated content');
    });

    it('should merge vector clocks', () => {
      const resolver = new ConflictResolver<TestDoc>('merge');
      const conflict: DocumentConflict<TestDoc> = {
        documentId: '1',
        localDocument: createDoc('1', 'Local', 'local', 10, {
          updatedAt: 1000,
          vclock: { nodeA: 3, nodeB: 1 },
        }),
        remoteDocument: createDoc('1', 'Remote', 'remote', 20, {
          updatedAt: 2000,
          vclock: { nodeA: 1, nodeB: 3 },
        }),
      };

      const result = resolver.resolve(conflict);

      expect(result.document._vclock).toEqual({ nodeA: 3, nodeB: 3 });
    });
  });
});

describe('detectConflict', () => {
  it('should return false when revisions are the same', () => {
    const local = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });
    const remote = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });

    expect(detectConflict(local, remote)).toBe(false);
  });

  it('should detect conflict with concurrent vector clocks', () => {
    const local = createDoc('1', 'Doc', 'content', 1, {
      rev: '1-abc',
      vclock: { nodeA: 2, nodeB: 1 },
    });
    const remote = createDoc('1', 'Doc', 'content', 1, {
      rev: '1-def',
      vclock: { nodeA: 1, nodeB: 2 },
    });

    expect(detectConflict(local, remote)).toBe(true);
  });

  it('should not detect conflict when local happened before remote', () => {
    const local = createDoc('1', 'Doc', 'content', 1, {
      rev: '1-abc',
      vclock: { nodeA: 1 },
    });
    const remote = createDoc('1', 'Doc', 'content', 1, {
      rev: '2-def',
      vclock: { nodeA: 2 },
    });

    expect(detectConflict(local, remote)).toBe(false);
  });

  it('should detect conflict with same revision sequence but different hashes', () => {
    const local = createDoc('1', 'Doc', 'content', 1, { rev: '2-abc' });
    const remote = createDoc('1', 'Doc', 'content', 1, { rev: '2-def' });

    expect(detectConflict(local, remote)).toBe(true);
  });

  it('should not detect conflict with different revision sequences', () => {
    const local = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });
    const remote = createDoc('1', 'Doc', 'content', 1, { rev: '2-def' });

    expect(detectConflict(local, remote)).toBe(false);
  });

  it('should handle missing revisions', () => {
    const local = createDoc('1', 'Doc', 'content', 1);
    const remote = createDoc('1', 'Doc', 'content', 1);

    // Same undefined revisions
    expect(detectConflict(local, remote)).toBe(false);
  });

  it('should detect conflict when one has revision and other does not', () => {
    const local = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });
    const remote = createDoc('1', 'Doc', 'content', 1);

    // Both will parse to sequence 1, but different rev strings
    expect(detectConflict(local, remote)).toBe(true);
  });

  describe('revision parsing validation', () => {
    it('should handle invalid revision formats gracefully', () => {
      const local = createDoc('1', 'Doc', 'content', 1, { rev: 'invalid-format' });
      const remote = createDoc('1', 'Doc', 'content', 1, { rev: 'also-invalid' });

      // Invalid formats should not cause crash, returns false (no conflict detected)
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should handle malformed revision with no hash', () => {
      const local = createDoc('1', 'Doc', 'content', 1, { rev: '1-' });
      const remote = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });

      // Local has invalid format, should not crash
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should handle revision with non-numeric sequence', () => {
      const local = createDoc('1', 'Doc', 'content', 1, { rev: 'abc-def' });
      const remote = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });

      // Local has non-numeric sequence, should not crash
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should handle extremely large sequence numbers', () => {
      const local = createDoc('1', 'Doc', 'content', 1, { rev: `${Number.MAX_SAFE_INTEGER + 1}-abc` });
      const remote = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });

      // Should not crash with huge numbers
      expect(detectConflict(local, remote)).toBe(false);
    });

    it('should handle negative sequence numbers', () => {
      const local = createDoc('1', 'Doc', 'content', 1, { rev: '-1-abc' });
      const remote = createDoc('1', 'Doc', 'content', 1, { rev: '1-abc' });

      // Negative numbers are invalid format
      expect(detectConflict(local, remote)).toBe(false);
    });
  });
});

describe('ConflictResolver edge cases', () => {
  it('should handle unknown strategy by defaulting to server-wins', () => {
    const resolver = new ConflictResolver<TestDoc>('unknown' as any);
    const conflict: DocumentConflict<TestDoc> = {
      documentId: '1',
      localDocument: createDoc('1', 'Local', 'local', 10),
      remoteDocument: createDoc('1', 'Remote', 'remote', 20),
    };

    const result = resolver.resolve(conflict);

    expect(result.winner).toBe('remote');
  });

  it('should handle missing updatedAt in last-write-wins', () => {
    const resolver = new ConflictResolver<TestDoc>('last-write-wins');
    const conflict: DocumentConflict<TestDoc> = {
      documentId: '1',
      localDocument: createDoc('1', 'Local', 'local', 10),
      remoteDocument: createDoc('1', 'Remote', 'remote', 20, { updatedAt: 1000 }),
    };

    const result = resolver.resolve(conflict);

    // Remote has updatedAt, local doesn't (0), so remote wins
    expect(result.winner).toBe('remote');
  });

  it('should preserve internal fields except _vclock and _updatedAt in merge', () => {
    const resolver = new ConflictResolver<TestDoc>('merge');
    const conflict: DocumentConflict<TestDoc> = {
      documentId: '1',
      localDocument: { ...createDoc('1', 'Local', 'local', 10), _rev: 'local-rev' },
      remoteDocument: { ...createDoc('1', 'Remote', 'remote', 20), _rev: 'remote-rev' },
    };

    const result = resolver.resolve(conflict);

    // _rev should come from remote (base)
    expect(result.document._id).toBe('1');
  });
});

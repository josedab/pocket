import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryChangeLog, createMemoryChangeLog } from './change-log.js';
import type { ChangeEvent, Document } from '@pocket/core';

interface TestDoc extends Document {
  _id: string;
  _rev: string;
  name: string;
}

describe('MemoryChangeLog', () => {
  let changeLog: MemoryChangeLog;

  beforeEach(() => {
    changeLog = createMemoryChangeLog();
  });

  describe('append', () => {
    it('should append a change entry', async () => {
      const change: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test' },
        timestamp: Date.now(),
        collection: 'users',
      };

      const entry = await changeLog.append({
        collection: 'users',
        change,
        clientId: 'client1',
      });

      expect(entry.id).toBe('users_1');
      expect(entry.sequence).toBe(1);
      expect(entry.collection).toBe('users');
      expect(entry.change).toEqual(change);
      expect(entry.clientId).toBe('client1');
      expect(entry.serverTimestamp).toBeDefined();
    });

    it('should increment sequence for each append', async () => {
      const change: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test' },
        timestamp: Date.now(),
        collection: 'users',
      };

      const entry1 = await changeLog.append({
        collection: 'users',
        change,
        clientId: 'client1',
      });

      const entry2 = await changeLog.append({
        collection: 'users',
        change: { ...change, documentId: 'doc2' },
        clientId: 'client1',
      });

      expect(entry1.sequence).toBe(1);
      expect(entry2.sequence).toBe(2);
    });
  });

  describe('getSince', () => {
    it('should get entries since a sequence', async () => {
      const change1: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test1' },
        timestamp: Date.now(),
        collection: 'users',
      };

      const change2: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc2',
        document: { _id: 'doc2', _rev: '1-def', name: 'Test2' },
        timestamp: Date.now(),
        collection: 'users',
      };

      await changeLog.append({ collection: 'users', change: change1, clientId: 'c1' });
      await changeLog.append({ collection: 'users', change: change2, clientId: 'c1' });

      const entries = await changeLog.getSince(1);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.sequence).toBe(2);
    });

    it('should filter by collection', async () => {
      const usersChange: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test1' },
        timestamp: Date.now(),
        collection: 'users',
      };

      const postsChange: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc2',
        document: { _id: 'doc2', _rev: '1-def', name: 'Test2' },
        timestamp: Date.now(),
        collection: 'posts',
      };

      await changeLog.append({ collection: 'users', change: usersChange, clientId: 'c1' });
      await changeLog.append({ collection: 'posts', change: postsChange, clientId: 'c1' });

      const usersEntries = await changeLog.getSince(0, 'users');

      expect(usersEntries).toHaveLength(1);
      expect(usersEntries[0]?.collection).toBe('users');
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        const change: ChangeEvent<TestDoc> = {
          type: 'change',
          operation: 'insert',
          documentId: `doc${i}`,
          document: { _id: `doc${i}`, _rev: '1-abc', name: `Test${i}` },
          timestamp: Date.now(),
          collection: 'users',
        };
        await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      }

      const entries = await changeLog.getSince(0, undefined, 5);

      expect(entries).toHaveLength(5);
    });
  });

  describe('getForCollection', () => {
    it('should get entries for a specific collection', async () => {
      const usersChange: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test1' },
        timestamp: Date.now(),
        collection: 'users',
      };

      const postsChange: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc2',
        document: { _id: 'doc2', _rev: '1-def', name: 'Test2' },
        timestamp: Date.now(),
        collection: 'posts',
      };

      await changeLog.append({ collection: 'users', change: usersChange, clientId: 'c1' });
      await changeLog.append({ collection: 'posts', change: postsChange, clientId: 'c1' });

      const postsEntries = await changeLog.getForCollection('posts');

      expect(postsEntries).toHaveLength(1);
      expect(postsEntries[0]?.collection).toBe('posts');
    });

    it('should filter by since sequence', async () => {
      for (let i = 0; i < 5; i++) {
        const change: ChangeEvent<TestDoc> = {
          type: 'change',
          operation: 'insert',
          documentId: `doc${i}`,
          document: { _id: `doc${i}`, _rev: '1-abc', name: `Test${i}` },
          timestamp: Date.now(),
          collection: 'users',
        };
        await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      }

      const entries = await changeLog.getForCollection('users', 3);

      expect(entries).toHaveLength(2);
      expect(entries[0]?.sequence).toBe(4);
      expect(entries[1]?.sequence).toBe(5);
    });
  });

  describe('get', () => {
    it('should get a specific entry by id', async () => {
      const change: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test' },
        timestamp: Date.now(),
        collection: 'users',
      };

      await changeLog.append({ collection: 'users', change, clientId: 'c1' });

      const entry = await changeLog.get('users_1');

      expect(entry).not.toBeNull();
      expect(entry?.id).toBe('users_1');
    });

    it('should return null for non-existent entry', async () => {
      const entry = await changeLog.get('non_existent');

      expect(entry).toBeNull();
    });
  });

  describe('getCurrentSequence', () => {
    it('should return 0 for empty log', async () => {
      const seq = await changeLog.getCurrentSequence();

      expect(seq).toBe(0);
    });

    it('should return current sequence after appends', async () => {
      const change: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test' },
        timestamp: Date.now(),
        collection: 'users',
      };

      await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      await changeLog.append({ collection: 'users', change, clientId: 'c1' });

      const seq = await changeLog.getCurrentSequence();

      expect(seq).toBe(3);
    });
  });

  describe('compact', () => {
    it('should remove entries before specified sequence', async () => {
      for (let i = 0; i < 10; i++) {
        const change: ChangeEvent<TestDoc> = {
          type: 'change',
          operation: 'insert',
          documentId: `doc${i}`,
          document: { _id: `doc${i}`, _rev: '1-abc', name: `Test${i}` },
          timestamp: Date.now(),
          collection: 'users',
        };
        await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      }

      const removed = await changeLog.compact(6);

      expect(removed).toBe(5);

      const entries = await changeLog.getSince(0);
      expect(entries).toHaveLength(5);
      expect(entries[0]?.sequence).toBe(6);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      const change: ChangeEvent<TestDoc> = {
        type: 'change',
        operation: 'insert',
        documentId: 'doc1',
        document: { _id: 'doc1', _rev: '1-abc', name: 'Test' },
        timestamp: Date.now(),
        collection: 'users',
      };

      await changeLog.append({ collection: 'users', change, clientId: 'c1' });
      await changeLog.append({ collection: 'users', change, clientId: 'c1' });

      await changeLog.clear();

      const entries = await changeLog.getSince(0);
      const seq = await changeLog.getCurrentSequence();

      expect(entries).toHaveLength(0);
      expect(seq).toBe(0);
    });
  });
});

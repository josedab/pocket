import type { Document } from '@pocket/core';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StudioSDK, createStudioSDK } from '../studio-sdk.js';

interface UserDoc extends Document {
  name: string;
  age?: number;
}

describe('StudioSDK', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-studio-sdk',
      storage: createMemoryStorage(),
      collections: [{ name: 'users' }, { name: 'posts' }],
    });

    const users = db.collection<UserDoc>('users');
    await users.insert({ name: 'Alice', age: 30 });
    await users.insert({ name: 'Bob', age: 25 });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('creation', () => {
    it('should create an SDK with defaults via factory', () => {
      const sdk = createStudioSDK({ database: db });
      expect(sdk).toBeInstanceOf(StudioSDK);
      expect(sdk.getStatus()).toBe('stopped');
    });

    it('should create an SDK with custom config', () => {
      const sdk = createStudioSDK({
        database: db,
        collections: ['users'],
        enableQueryPlayground: false,
        enableDocEditor: false,
        enableProfiler: true,
      });
      expect(sdk).toBeInstanceOf(StudioSDK);
    });
  });

  describe('start / stop lifecycle', () => {
    it('should transition to running on start', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();
      expect(sdk.getStatus()).toBe('running');
      await sdk.stop();
    });

    it('should transition to stopped on stop', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();
      await sdk.stop();
      expect(sdk.getStatus()).toBe('stopped');
    });

    it('should be idempotent for repeated start calls', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();
      await sdk.start();
      expect(sdk.getStatus()).toBe('running');
      await sdk.stop();
    });

    it('should be idempotent for repeated stop calls', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();
      await sdk.stop();
      await sdk.stop();
      expect(sdk.getStatus()).toBe('stopped');
    });
  });

  describe('status tracking', () => {
    it('should emit status changes via observable', async () => {
      const sdk = createStudioSDK({ database: db });
      const statuses: string[] = [];
      const sub = sdk.status.subscribe((s) => statuses.push(s));

      await sdk.start();
      await sdk.stop();

      sub.unsubscribe();
      expect(statuses).toEqual(['stopped', 'running', 'stopped']);
    });

    it('should throw when calling methods before start', async () => {
      const sdk = createStudioSDK({ database: db });
      await expect(sdk.inspectCollection('users')).rejects.toThrow(
        'StudioSDK is not running'
      );
    });
  });

  describe('inspectCollection', () => {
    it('should return inspection result for a collection', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();

      const result = await sdk.inspectCollection('users');
      expect(result.collection.name).toBe('users');
      expect(result.collection.documentCount).toBe(2);
      expect(result.filtered).toBe(false);

      await sdk.stop();
    });

    it('should mark filtered when collection not in allow-list', async () => {
      const sdk = createStudioSDK({
        database: db,
        collections: ['posts'],
      });
      await sdk.start();

      const result = await sdk.inspectCollection('users');
      expect(result.filtered).toBe(true);

      await sdk.stop();
    });
  });

  describe('executeQuery', () => {
    it('should execute a query and return results', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();

      const result = await sdk.executeQuery('users', { name: 'Alice' });
      expect(result.count).toBe(1);
      expect(result.documents).toHaveLength(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      await sdk.stop();
    });

    it('should throw when playground is disabled', async () => {
      const sdk = createStudioSDK({
        database: db,
        enableQueryPlayground: false,
      });
      await sdk.start();

      await expect(sdk.executeQuery('users', {})).rejects.toThrow(
        'QueryPlayground is not enabled'
      );

      await sdk.stop();
    });
  });

  describe('getDocument', () => {
    it('should retrieve a document by ID', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();

      const collections = await sdk.inspectCollection('users');
      const sample = collections.collection.sampleDocument as
        | Document
        | undefined;
      expect(sample).toBeDefined();

      const doc = await sdk.getDocument('users', sample!._id);
      expect(doc).toBeDefined();
      expect((doc as UserDoc).name).toBeDefined();

      await sdk.stop();
    });

    it('should return undefined for non-existent document', async () => {
      const sdk = createStudioSDK({ database: db });
      await sdk.start();

      const doc = await sdk.getDocument('users', 'non-existent-id');
      expect(doc).toBeNull();

      await sdk.stop();
    });
  });
});

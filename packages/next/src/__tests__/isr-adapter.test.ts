import { describe, expect, it } from 'vitest';
import {
  createPocketDynamicLoader,
  createPocketLoader,
  createWebhookHandler,
  generateWebhookSignature,
} from '../isr-adapter.js';

describe('ISR Adapter', () => {
  const mockDataSource = {
    query: async <T extends Record<string, unknown>>(
      collection: string,
      filter?: Record<string, unknown>
    ) => {
      const data = [
        { _id: '1', title: 'Post A', published: true },
        { _id: '2', title: 'Post B', published: false },
      ] as T[];
      if (filter?.published !== undefined)
        return data.filter(
          (d) => (d as Record<string, unknown>).published === filter.published
        ) as T[];
      if (filter?._id)
        return data.filter((d) => (d as Record<string, unknown>)._id === filter._id) as T[];
      return data;
    },
  };

  describe('createPocketLoader', () => {
    it('should create a static props loader', async () => {
      const loader = createPocketLoader(
        { collection: 'posts', filter: { published: true }, revalidate: 30 },
        mockDataSource
      );

      const result = await loader();
      expect(result.props.data).toHaveLength(1);
      expect(result.props._meta.collection).toBe('posts');
      expect(result.revalidate).toBe(30);
    });

    it('should use default revalidate of 60', async () => {
      const loader = createPocketLoader({ collection: 'posts' }, mockDataSource);
      const result = await loader();
      expect(result.revalidate).toBe(60);
    });
  });

  describe('createPocketDynamicLoader', () => {
    it('should generate static paths', async () => {
      const { getStaticPaths } = createPocketDynamicLoader({ collection: 'posts' }, mockDataSource);

      const result = await getStaticPaths();
      expect(result.paths).toHaveLength(2);
      expect(result.paths[0]!.params.id).toBe('1');
      expect(result.fallback).toBe('blocking');
    });

    it('should load static props for a specific document', async () => {
      const { getStaticProps } = createPocketDynamicLoader({ collection: 'posts' }, mockDataSource);

      const result = await getStaticProps({ params: { id: '1' } });
      expect(result.props.data).toHaveLength(1);
    });
  });

  describe('webhook handler', () => {
    it('should verify valid webhook signatures', () => {
      const handler = createWebhookHandler({ secret: 'my-secret' });
      const ts = Date.now();
      const sig = generateWebhookSignature('my-secret', 'posts', ts);

      const payload = {
        collection: 'posts',
        operation: 'update' as const,
        documentId: 'p1',
        timestamp: ts,
        signature: sig,
      };
      expect(handler.verify(payload)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const handler = createWebhookHandler({ secret: 'my-secret' });
      const payload = {
        collection: 'posts',
        operation: 'update' as const,
        documentId: 'p1',
        timestamp: Date.now(),
        signature: 'invalid',
      };
      expect(handler.verify(payload)).toBe(false);
    });

    it('should determine paths to revalidate', () => {
      const handler = createWebhookHandler({
        secret: 'test',
        revalidatePaths: { posts: ['/blog', '/blog/[slug]'] },
      });

      const paths = handler.getPathsToRevalidate({
        collection: 'posts',
        operation: 'update',
        documentId: 'p1',
        timestamp: Date.now(),
        signature: '',
      });
      expect(paths).toEqual(['/blog', '/blog/[slug]']);
    });

    it('should process webhook and return revalidation result', () => {
      const handler = createWebhookHandler({ secret: 'test' });
      const result = handler.process({
        collection: 'posts',
        operation: 'insert',
        documentId: 'p1',
        timestamp: Date.now(),
        signature: '',
      });
      expect(result.revalidated.length).toBeGreaterThan(0);
    });

    it('should skip collections not in whitelist', () => {
      const handler = createWebhookHandler({ secret: 'test', collections: ['posts'] });
      const paths = handler.getPathsToRevalidate({
        collection: 'users',
        operation: 'update',
        documentId: 'u1',
        timestamp: Date.now(),
        signature: '',
      });
      expect(paths).toHaveLength(0);
    });
  });
});

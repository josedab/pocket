import { describe, expect, it } from 'vitest';
import { collectionCacheTag, createISRMiddleware, documentCacheTag } from '../isr-middleware.js';

describe('Cache Tags', () => {
  it('should generate collection cache tags', () => {
    expect(collectionCacheTag('todos')).toBe('pocket:todos');
  });

  it('should generate document cache tags', () => {
    expect(documentCacheTag('todos', 'doc-1')).toBe('pocket:todos:doc-1');
  });
});

describe('ISRMiddleware', () => {
  const config = {
    collections: ['todos', 'users'],
    pathDependencies: {
      '/dashboard': ['todos', 'users'],
      '/todos': ['todos'],
      '/profile/:id': ['users'],
    },
    defaultRevalidate: 60,
  };

  it('should process sync events and identify affected paths', () => {
    const mw = createISRMiddleware(config);
    const result = mw.processSyncEvent({
      collection: 'todos',
      operation: 'insert',
      timestamp: Date.now(),
    });

    expect(result.action).toBe('revalidate');
    expect(result.revalidatedPaths).toContain('/dashboard');
    expect(result.revalidatedPaths).toContain('/todos');
    expect(result.revalidatedPaths).not.toContain('/profile/:id');
  });

  it('should include cache tags in sync event result', () => {
    const mw = createISRMiddleware(config);
    const result = mw.processSyncEvent({
      collection: 'todos',
      documentId: 'doc-1',
      operation: 'update',
      timestamp: Date.now(),
    });

    expect(result.cacheTags).toContain('pocket:todos');
    expect(result.cacheTags).toContain('pocket:todos:doc-1');
  });

  it('should pass through unrelated collections', () => {
    const mw = createISRMiddleware(config);
    const result = mw.processSyncEvent({
      collection: 'comments',
      operation: 'insert',
      timestamp: Date.now(),
    });

    expect(result.action).toBe('pass');
    expect(result.revalidatedPaths).toHaveLength(0);
  });

  it('should track pending revalidations', () => {
    const mw = createISRMiddleware(config);

    mw.processSyncEvent({ collection: 'todos', operation: 'update', timestamp: Date.now() });
    expect(mw.getPendingRevalidations()).toContain('/todos');
    expect(mw.getPendingRevalidations()).toContain('/dashboard');
  });

  it('should consume revalidation on request processing', () => {
    const mw = createISRMiddleware(config);

    mw.processSyncEvent({ collection: 'todos', operation: 'insert', timestamp: Date.now() });

    const result = mw.processRequest('/todos');
    expect(result.action).toBe('revalidate');

    // Second request should be a cache hit
    const result2 = mw.processRequest('/todos');
    expect(result2.action).toBe('cache-hit');
  });

  it('should return pass for unknown paths', () => {
    const mw = createISRMiddleware(config);
    const result = mw.processRequest('/unknown');
    expect(result.action).toBe('pass');
  });

  it('should set cache-control headers', () => {
    const mw = createISRMiddleware(config);
    const headers = mw.getResponseHeaders('/todos');
    expect(headers['cache-control']).toContain('s-maxage=60');
    expect(headers['cache-control']).toContain('stale-while-revalidate');
  });

  it('should include cache tags in headers', () => {
    const mw = createISRMiddleware(config);
    const result = mw.processRequest('/dashboard');
    expect(result.cacheTags).toContain('pocket:todos');
    expect(result.cacheTags).toContain('pocket:users');
  });

  it('should maintain revalidation log', () => {
    const mw = createISRMiddleware(config);
    mw.processSyncEvent({ collection: 'todos', operation: 'update', timestamp: 1000 });

    const log = mw.getRevalidationLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]!.collection).toBe('todos');
  });

  it('should reset state', () => {
    const mw = createISRMiddleware(config);
    mw.processSyncEvent({ collection: 'todos', operation: 'insert', timestamp: Date.now() });
    mw.reset();
    expect(mw.getPendingRevalidations()).toHaveLength(0);
    expect(mw.getRevalidationLog()).toHaveLength(0);
  });

  it('should generate matcher config', () => {
    const mw = createISRMiddleware(config);
    const matcher = mw.getMatcherConfig();
    expect(matcher.matcher).toContain('/dashboard');
    expect(matcher.matcher).toContain('/todos');
  });
});

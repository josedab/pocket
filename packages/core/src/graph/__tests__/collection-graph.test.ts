import { describe, expect, it } from 'vitest';
import { createCollectionGraph } from '../collection-graph.js';
import { createGraphEngine } from '../graph-engine.js';

describe('CollectionGraph', () => {
  it('should create links to other collections', () => {
    const graph = createCollectionGraph('users');
    const edge = graph.linkTo('posts', 'u1', 'p1', 'authored');
    expect(edge.label).toBe('authored');
    expect(edge.sourceCollection).toBe('users');
    expect(edge.targetCollection).toBe('posts');
  });

  it('should create links within same collection', () => {
    const graph = createCollectionGraph('users');
    const edge = graph.link('u1', 'u2', 'follows');
    expect(edge.sourceCollection).toBe('users');
    expect(edge.targetCollection).toBe('users');
  });

  it('should remove links', () => {
    const graph = createCollectionGraph('users');
    const edge = graph.link('u1', 'u2', 'follows');
    expect(graph.unlink(edge.id)).toBe(true);
    expect(graph.edgeCount).toBe(0);
  });

  it('should find directly linked documents', () => {
    const graph = createCollectionGraph('users');
    graph.linkTo('posts', 'u1', 'p1', 'authored');
    graph.linkTo('posts', 'u1', 'p2', 'authored');
    graph.link('u1', 'u2', 'follows');

    const posts = graph.findLinked('u1', 'authored');
    expect(posts).toHaveLength(2);
    expect(posts.every((n) => n.collection === 'posts')).toBe(true);
  });

  describe('fluent traversal', () => {
    it('should traverse outgoing edges', () => {
      const graph = createCollectionGraph('users');
      graph.linkTo('posts', 'u1', 'p1', 'authored');
      graph.linkTo('posts', 'u1', 'p2', 'authored');

      const result = graph.from('u1').outgoing('authored').results();
      expect(result.nodes).toHaveLength(2);
    });

    it('should chain fluent methods', () => {
      const graph = createCollectionGraph('users');
      graph.linkTo('posts', 'u1', 'p1', 'authored');

      const ids = graph.from('u1').outgoing('authored').depth(1).limit(10).nodeIds();
      expect(ids).toContain('p1');
    });

    it('should return edges from traversal', () => {
      const graph = createCollectionGraph('users');
      graph.link('u1', 'u2', 'follows');
      const edges = graph.from('u1').outgoing('follows').edges();
      expect(edges).toHaveLength(1);
      expect(edges[0]!.label).toBe('follows');
    });

    it('should traverse incoming edges', () => {
      const engine = createGraphEngine();
      const graph = createCollectionGraph('posts', engine);
      engine.addEdge('users', 'u1', 'posts', 'p1', 'authored');
      engine.addEdge('users', 'u2', 'posts', 'p1', 'liked');

      const result = graph.from('p1').incoming().results();
      expect(result.nodes).toHaveLength(2);
    });

    it('should traverse both directions', () => {
      const graph = createCollectionGraph('users');
      graph.link('u1', 'u2', 'follows');
      graph.link('u3', 'u1', 'follows');

      const result = graph.from('u1').both('follows').results();
      expect(result.nodes).toHaveLength(2);
    });
  });

  it('should find shortest path', () => {
    const graph = createCollectionGraph('users');
    graph.link('u1', 'u2', 'knows');
    graph.link('u2', 'u3', 'knows');

    const path = graph.pathTo('u1', 'users', 'u3');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // u1 → u2 → u3
  });

  it('should match patterns', () => {
    const graph = createCollectionGraph('users');
    graph.linkTo('posts', 'u1', 'p1', 'authored');
    graph.linkTo('posts', 'u2', 'p2', 'authored');

    const matches = graph.matchPattern('authored', 'posts');
    expect(matches).toHaveLength(2);
  });

  it('should share engine across collections', () => {
    const engine = createGraphEngine();
    const users = createCollectionGraph('users', engine);
    const posts = createCollectionGraph('posts', engine);

    users.linkTo('posts', 'u1', 'p1', 'authored');
    const incoming = posts.from('p1').incoming('authored').results();
    expect(incoming.nodes).toHaveLength(1);
    expect(incoming.nodes[0]!.collection).toBe('users');
  });
});

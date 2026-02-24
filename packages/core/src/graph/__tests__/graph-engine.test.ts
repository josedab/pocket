import { describe, expect, it } from 'vitest';
import { createGraphEngine } from '../graph-engine.js';

describe('GraphEngine', () => {
  it('should add and retrieve edges', () => {
    const g = createGraphEngine();
    const edge = g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    expect(edge.label).toBe('authored');
    expect(g.edgeCount).toBe(1);
    expect(g.getEdges('users', 'u1', { direction: 'outgoing' })).toHaveLength(1);
  });

  it('should remove edges', () => {
    const g = createGraphEngine();
    const edge = g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    expect(g.removeEdge(edge.id)).toBe(true);
    expect(g.edgeCount).toBe(0);
  });

  it('should filter edges by label', () => {
    const g = createGraphEngine();
    g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    g.addEdge('users', 'u1', 'users', 'u2', 'follows');
    expect(g.getEdges('users', 'u1', { label: 'follows' })).toHaveLength(1);
  });

  it('should traverse outgoing edges', () => {
    const g = createGraphEngine();
    g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    g.addEdge('users', 'u1', 'posts', 'p2', 'authored');
    g.addEdge('posts', 'p1', 'comments', 'c1', 'has');

    const result = g.traverse('users', 'u1', { maxDepth: 2, direction: 'outgoing' });
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.depth).toBeGreaterThanOrEqual(1);
  });

  it('should respect maxDepth', () => {
    const g = createGraphEngine();
    g.addEdge('a', '1', 'b', '1', 'link');
    g.addEdge('b', '1', 'c', '1', 'link');
    g.addEdge('c', '1', 'd', '1', 'link');

    const result = g.traverse('a', '1', { maxDepth: 1, direction: 'outgoing' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.collection).toBe('b');
  });

  it('should match patterns', () => {
    const g = createGraphEngine();
    g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    g.addEdge('users', 'u2', 'posts', 'p2', 'authored');
    g.addEdge('users', 'u1', 'users', 'u2', 'follows');

    const result = g.match({ edgeLabel: 'authored', sourceLabel: 'users' });
    expect(result.count).toBe(2);
  });

  it('should find shortest path', () => {
    const g = createGraphEngine();
    g.addEdge('users', 'u1', 'users', 'u2', 'follows');
    g.addEdge('users', 'u2', 'users', 'u3', 'follows');
    g.addEdge('users', 'u1', 'users', 'u3', 'follows');

    const path = g.shortestPath('users', 'u1', 'users', 'u3');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2); // direct u1→u3
  });

  it('should return null for unreachable nodes', () => {
    const g = createGraphEngine();
    g.addEdge('a', '1', 'b', '1', 'link');
    expect(g.shortestPath('a', '1', 'c', '1')).toBeNull();
  });

  it('should handle cycles in traversal', () => {
    const g = createGraphEngine();
    g.addEdge('a', '1', 'b', '1', 'link');
    g.addEdge('b', '1', 'a', '1', 'link');
    const result = g.traverse('a', '1', { maxDepth: 5, direction: 'outgoing' });
    expect(result.nodes).toHaveLength(1); // only b, a already visited
  });

  it('should support incoming traversal', () => {
    const g = createGraphEngine();
    g.addEdge('users', 'u1', 'posts', 'p1', 'authored');
    g.addEdge('users', 'u2', 'posts', 'p1', 'liked');
    const edges = g.getEdges('posts', 'p1', { direction: 'incoming' });
    expect(edges).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { DependencyGraphBuilder } from '../dependency-graph.js';

describe('DependencyGraphBuilder', () => {
  function buildTestGraph() {
    const builder = new DependencyGraphBuilder();
    builder.addPackage({
      name: '@pocket/core',
      version: '0.1.0',
      dependencies: {},
      path: 'packages/core',
    });
    builder.addPackage({
      name: '@pocket/react',
      version: '0.1.0',
      dependencies: { '@pocket/core': '*' },
      path: 'packages/react',
    });
    builder.addPackage({
      name: '@pocket/sync',
      version: '0.1.0',
      dependencies: { '@pocket/core': '*' },
      path: 'packages/sync',
    });
    builder.addPackage({
      name: '@pocket/server',
      version: '0.1.0',
      dependencies: { '@pocket/sync': '*', '@pocket/core': '*' },
      path: 'packages/server',
    });
    builder.addPackage({
      name: '@pocket/ai',
      version: '0.1.0',
      dependencies: { '@pocket/core': '*' },
      path: 'packages/ai',
    });
    return builder;
  }

  it('should build graph with nodes and edges', () => {
    const graph = buildTestGraph().build();
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('should detect leaf nodes', () => {
    const graph = buildTestGraph().build();
    expect(graph.leafNodes).toContain('@pocket/core');
  });

  it('should detect root nodes', () => {
    const graph = buildTestGraph().build();
    // Nodes that nobody depends on
    expect(graph.rootNodes).toContain('@pocket/server');
    expect(graph.rootNodes).toContain('@pocket/ai');
  });

  it('should find critical path', () => {
    const graph = buildTestGraph().build();
    expect(graph.criticalPath.length).toBeGreaterThan(1);
  });

  it('should detect circular dependencies', () => {
    const builder = new DependencyGraphBuilder();
    builder.addPackage({ name: 'a', dependencies: { b: '*' } });
    builder.addPackage({ name: 'b', dependencies: { c: '*' } });
    builder.addPackage({ name: 'c', dependencies: { a: '*' } });

    const graph = builder.build();
    expect(graph.circularDependencies.length).toBeGreaterThan(0);
  });

  it('should analyze graph metrics', () => {
    const analysis = buildTestGraph().analyze();
    expect(analysis.totalPackages).toBe(5);
    expect(analysis.totalEdges).toBeGreaterThan(0);
    expect(analysis.avgDependencies).toBeGreaterThan(0);
    expect(analysis.mostDependedOn!.name).toBe('@pocket/core');
    expect(analysis.categories).toBeDefined();
  });

  it('should export to DOT format', () => {
    const dot = buildTestGraph().toDot();
    expect(dot).toContain('digraph PocketDeps');
    expect(dot).toContain('@pocket/core');
    expect(dot).toContain('->');
  });

  it('should export to ASCII art', () => {
    const ascii = buildTestGraph().toAscii();
    expect(ascii).toContain('Pocket Dependency Graph');
    expect(ascii).toContain('@pocket/');
  });

  it('should categorize packages', () => {
    const analysis = buildTestGraph().analyze();
    expect(analysis.categories.core).toBeGreaterThan(0);
    expect(analysis.categories.framework).toBeGreaterThan(0);
  });
});

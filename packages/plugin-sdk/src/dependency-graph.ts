/**
 * DependencyGraphBuilder — Analyzes package.json files and builds a directed dependency graph.
 *
 * Detects circular dependencies, critical paths, and generates
 * visual representations (ASCII, JSON, DOT format).
 */

// ── Types ──────────────────────────────────────────────────

export interface PackageNode {
  name: string;
  version: string;
  dependencies: string[];
  devDependencies: string[];
  peerDependencies: string[];
  category: 'core' | 'framework' | 'storage' | 'extension' | 'tooling' | 'other';
  path: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'dependency' | 'devDependency' | 'peerDependency';
}

export interface DependencyGraph {
  nodes: PackageNode[];
  edges: DependencyEdge[];
  circularDependencies: string[][];
  criticalPath: string[];
  leafNodes: string[];
  rootNodes: string[];
}

export interface GraphAnalysis {
  totalPackages: number;
  totalEdges: number;
  avgDependencies: number;
  maxDepth: number;
  circularCount: number;
  categories: Record<string, number>;
  mostDependent: { name: string; count: number } | null;
  mostDependedOn: { name: string; count: number } | null;
}

// ── Implementation ────────────────────────────────────────

export class DependencyGraphBuilder {
  private readonly nodes = new Map<string, PackageNode>();
  private readonly edges: DependencyEdge[] = [];

  /**
   * Add a package to the graph.
   */
  addPackage(pkg: {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    path?: string;
  }): void {
    const node: PackageNode = {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      dependencies: Object.keys(pkg.dependencies ?? {}),
      devDependencies: Object.keys(pkg.devDependencies ?? {}),
      peerDependencies: Object.keys(pkg.peerDependencies ?? {}),
      category: this.categorize(pkg.name),
      path: pkg.path ?? '',
    };

    this.nodes.set(pkg.name, node);

    for (const dep of node.dependencies) {
      this.edges.push({ from: pkg.name, to: dep, type: 'dependency' });
    }
    for (const dep of node.devDependencies) {
      this.edges.push({ from: pkg.name, to: dep, type: 'devDependency' });
    }
    for (const dep of node.peerDependencies) {
      this.edges.push({ from: pkg.name, to: dep, type: 'peerDependency' });
    }
  }

  /**
   * Build the complete dependency graph.
   */
  build(): DependencyGraph {
    // Filter edges to only internal packages
    const internalNames = new Set(this.nodes.keys());
    const internalEdges = this.edges.filter(
      (e) => internalNames.has(e.from) && internalNames.has(e.to)
    );

    const circular = this.detectCircular(internalEdges);
    const leafNodes = this.findLeafNodes(internalEdges);
    const rootNodes = this.findRootNodes(internalEdges);
    const criticalPath = this.findCriticalPath(internalEdges);

    return {
      nodes: [...this.nodes.values()],
      edges: internalEdges,
      circularDependencies: circular,
      criticalPath,
      leafNodes,
      rootNodes,
    };
  }

  /**
   * Analyze the graph and return metrics.
   */
  analyze(): GraphAnalysis {
    const graph = this.build();
    const categories: Record<string, number> = {};

    for (const node of graph.nodes) {
      categories[node.category] = (categories[node.category] ?? 0) + 1;
    }

    // Most dependent (has most dependencies)
    const depCounts = graph.nodes.map((n) => ({
      name: n.name,
      count: graph.edges.filter((e) => e.from === n.name).length,
    }));
    depCounts.sort((a, b) => b.count - a.count);

    // Most depended on (most packages depend on it)
    const reverseCounts = graph.nodes.map((n) => ({
      name: n.name,
      count: graph.edges.filter((e) => e.to === n.name).length,
    }));
    reverseCounts.sort((a, b) => b.count - a.count);

    const totalEdges = graph.edges.length;
    const totalPkgs = graph.nodes.length;

    return {
      totalPackages: totalPkgs,
      totalEdges,
      avgDependencies: totalPkgs > 0 ? totalEdges / totalPkgs : 0,
      maxDepth: this.calculateMaxDepth(graph),
      circularCount: graph.circularDependencies.length,
      categories,
      mostDependent: depCounts[0] ?? null,
      mostDependedOn: reverseCounts[0] ?? null,
    };
  }

  /**
   * Export graph in DOT format (for Graphviz).
   */
  toDot(): string {
    const graph = this.build();
    const lines: string[] = [
      'digraph PocketDeps {',
      '  rankdir=LR;',
      '  node [shape=box, style=rounded];',
    ];

    for (const node of graph.nodes) {
      const color = this.categoryColor(node.category);
      lines.push(`  "${node.name}" [color="${color}", label="${node.name}\\n${node.version}"];`);
    }

    for (const edge of graph.edges) {
      const style = edge.type === 'devDependency' ? 'dashed' : 'solid';
      lines.push(`  "${edge.from}" -> "${edge.to}" [style=${style}];`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Export graph as ASCII art.
   */
  toAscii(): string {
    const graph = this.build();
    const lines: string[] = ['Pocket Dependency Graph', '═'.repeat(40)];

    for (const root of graph.rootNodes) {
      this.printTree(root, graph, lines, '', true, new Set());
    }

    if (graph.circularDependencies.length > 0) {
      lines.push('', 'Circular Dependencies:', '─'.repeat(30));
      for (const cycle of graph.circularDependencies) {
        lines.push(`  ⚠ ${cycle.join(' → ')} → ${cycle[0]}`);
      }
    }

    return lines.join('\n');
  }

  // ── Private ────────────────────────────────────────────

  private detectCircular(edges: DependencyEdge[]): string[][] {
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      const list = adj.get(edge.from) ?? [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);

      for (const neighbor of adj.get(node) ?? []) {
        dfs(neighbor, [...path, node]);
      }

      inStack.delete(node);
    };

    for (const node of adj.keys()) {
      dfs(node, []);
    }

    return cycles;
  }

  private findLeafNodes(edges: DependencyEdge[]): string[] {
    const hasDeps = new Set(edges.map((e) => e.from));
    return [...this.nodes.keys()].filter((n) => !hasDeps.has(n));
  }

  private findRootNodes(edges: DependencyEdge[]): string[] {
    const isDependency = new Set(edges.map((e) => e.to));
    return [...this.nodes.keys()].filter((n) => !isDependency.has(n));
  }

  private findCriticalPath(edges: DependencyEdge[]): string[] {
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      const list = adj.get(edge.from) ?? [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }

    let longest: string[] = [];
    const dfs = (node: string, path: string[], visited: Set<string>): void => {
      if (visited.has(node)) return;
      visited.add(node);
      const current = [...path, node];
      if (current.length > longest.length) longest = current;
      for (const n of adj.get(node) ?? []) {
        dfs(n, current, visited);
      }
      visited.delete(node);
    };

    for (const node of this.nodes.keys()) {
      dfs(node, [], new Set());
    }

    return longest;
  }

  private calculateMaxDepth(graph: DependencyGraph): number {
    return graph.criticalPath.length;
  }

  private categorize(name: string): PackageNode['category'] {
    if (
      name.includes('react') ||
      name.includes('vue') ||
      name.includes('angular') ||
      name.includes('svelte')
    )
      return 'framework';
    if (name.includes('core') || name.includes('sync')) return 'core';
    if (name.includes('storage')) return 'storage';
    if (
      name.includes('cli') ||
      name.includes('codegen') ||
      name.includes('studio') ||
      name.includes('devtools')
    )
      return 'tooling';
    return 'extension';
  }

  private categoryColor(cat: string): string {
    switch (cat) {
      case 'core':
        return '#e74c3c';
      case 'framework':
        return '#3498db';
      case 'storage':
        return '#2ecc71';
      case 'tooling':
        return '#f39c12';
      default:
        return '#95a5a6';
    }
  }

  private printTree(
    node: string,
    graph: DependencyGraph,
    lines: string[],
    prefix: string,
    isLast: boolean,
    visited: Set<string>
  ): void {
    const connector = isLast ? '└── ' : '├── ';
    const pkg = this.nodes.get(node);
    const label = pkg ? `${node} (${pkg.version})` : node;
    lines.push(`${prefix}${connector}${label}`);

    if (visited.has(node)) return;
    visited.add(node);

    const children = graph.edges
      .filter((e) => e.from === node && e.type === 'dependency')
      .map((e) => e.to);

    for (let i = 0; i < children.length; i++) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      this.printTree(children[i]!, graph, lines, childPrefix, i === children.length - 1, visited);
    }
  }
}

export function createDependencyGraphBuilder(): DependencyGraphBuilder {
  return new DependencyGraphBuilder();
}

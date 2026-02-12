/** Creates a dependency graph for tracking view dependencies on source collections */
export function createDependencyGraph() {
  const nodes = new Map<string, string[]>();

  function addNode(viewName: string): void {
    if (!nodes.has(viewName)) {
      nodes.set(viewName, []);
    }
  }

  function addEdge(from: string, to: string): void {
    addNode(from);
    addNode(to);
    const edges = nodes.get(from)!;
    if (!edges.includes(to)) {
      edges.push(to);
    }
  }

  function removeNode(name: string): void {
    nodes.delete(name);
    for (const [, edges] of nodes) {
      const idx = edges.indexOf(name);
      if (idx !== -1) {
        edges.splice(idx, 1);
      }
    }
  }

  function getAffected(changedSource: string): string[] {
    const affected: string[] = [];
    const visited = new Set<string>();

    function visit(node: string): void {
      if (visited.has(node)) return;
      visited.add(node);
      const edges = nodes.get(node);
      if (edges) {
        for (const dep of edges) {
          affected.push(dep);
          visit(dep);
        }
      }
    }

    visit(changedSource);
    return affected;
  }

  function hasCycle(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();

    for (const key of nodes.keys()) {
      color.set(key, WHITE);
    }

    function dfs(node: string): boolean {
      color.set(node, GRAY);
      const edges = nodes.get(node) ?? [];
      for (const neighbor of edges) {
        const c = color.get(neighbor) ?? WHITE;
        if (c === GRAY) return true;
        if (c === WHITE && dfs(neighbor)) return true;
      }
      color.set(node, BLACK);
      return false;
    }

    for (const key of nodes.keys()) {
      if (color.get(key) === WHITE) {
        if (dfs(key)) return true;
      }
    }
    return false;
  }

  function topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const key of nodes.keys()) {
      if (!inDegree.has(key)) inDegree.set(key, 0);
      const edges = nodes.get(key)!;
      for (const dep of edges) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [key, degree] of inDegree) {
      if (degree === 0) queue.push(key);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      const edges = nodes.get(node) ?? [];
      for (const dep of edges) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) queue.push(dep);
      }
    }

    return result;
  }

  return {
    nodes,
    addNode,
    addEdge,
    removeNode,
    getAffected,
    hasCycle,
    topologicalSort,
  };
}

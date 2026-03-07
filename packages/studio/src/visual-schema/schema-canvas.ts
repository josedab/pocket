/**
 * Visual Schema Canvas — canvas-based schema designer with layout algorithms,
 * import/export, undo/redo, and reactive state.
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

import type {
  CanvasEvent,
  VisualCanvasField,
  VisualCanvasIndex,
  VisualFieldType,
  LayoutAlgorithm,
  RelationType,
  SchemaCanvasEdge,
  SchemaCanvasNode,
  SchemaCanvasState,
  SchemaExportFormat,
  SchemaImportOptions,
} from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

let nextId = 1;
function genId(): string {
  return `vsc_${nextId++}`;
}

function mapFieldType(t: VisualFieldType): string {
  const map: Record<VisualFieldType, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'Date',
    object: 'Record<string, unknown>',
    array: 'unknown[]',
    reference: 'string',
  };
  return map[t] ?? 'unknown';
}

function mapFieldTypeToSQL(t: VisualFieldType): string {
  const map: Record<VisualFieldType, string> = {
    string: 'TEXT',
    number: 'NUMERIC',
    boolean: 'BOOLEAN',
    date: 'TIMESTAMP',
    object: 'JSONB',
    array: 'JSONB',
    reference: 'TEXT',
  };
  return map[t] ?? 'TEXT';
}

function mapFieldTypeToGraphQL(t: VisualFieldType): string {
  const map: Record<VisualFieldType, string> = {
    string: 'String',
    number: 'Float',
    boolean: 'Boolean',
    date: 'DateTime',
    object: 'JSON',
    array: '[JSON]',
    reference: 'ID',
  };
  return map[t] ?? 'String';
}

// ─── SchemaCanvas ────────────────────────────────────────────────────────────

export class SchemaCanvas {
  private _state: SchemaCanvasState;
  private readonly _state$: BehaviorSubject<SchemaCanvasState>;
  private readonly _events$: Subject<CanvasEvent>;
  private undoStack: SchemaCanvasState[] = [];
  private redoStack: SchemaCanvasState[] = [];

  constructor(initialState?: Partial<SchemaCanvasState>) {
    this._state = {
      nodes: initialState?.nodes ? clone(initialState.nodes) : [],
      edges: initialState?.edges ? clone(initialState.edges) : [],
      viewport: initialState?.viewport
        ? { ...initialState.viewport }
        : { x: 0, y: 0, zoom: 1 },
      selectedNodeId: initialState?.selectedNodeId,
      selectedEdgeId: initialState?.selectedEdgeId,
    };
    this._state$ = new BehaviorSubject<SchemaCanvasState>(clone(this._state));
    this._events$ = new Subject<CanvasEvent>();
  }

  // ─── Collection (Node) Operations ───────────────────────────────────

  addCollection(
    name: string,
    fields?: VisualCanvasField[],
    position?: { x: number; y: number },
  ): SchemaCanvasNode {
    this.pushUndo();
    const node: SchemaCanvasNode = {
      id: genId(),
      type: 'collection',
      position: position ? { ...position } : { x: 0, y: 0 },
      data: {
        name,
        fields: fields ? clone(fields) : [],
        indexes: [],
      },
    };
    this._state.nodes.push(node);
    this.emit('node_added', { nodeId: node.id, name });
    return clone(node);
  }

  removeCollection(id: string): void {
    this.pushUndo();
    const idx = this._state.nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    this._state.nodes.splice(idx, 1);
    // Remove related edges
    this._state.edges = this._state.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );
    this.emit('node_removed', { nodeId: id });
  }

  updateCollection(id: string, updates: Partial<SchemaCanvasNode['data']>): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === id);
    if (!node) return;
    Object.assign(node.data, clone(updates));
    this.emit('node_updated', { nodeId: id });
  }

  // ─── Field Operations ──────────────────────────────────────────────

  addField(collectionId: string, field: VisualCanvasField): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === collectionId);
    if (!node) return;
    node.data.fields.push(clone(field));
    this.emit('field_added', { collectionId, fieldName: field.name });
  }

  removeField(collectionId: string, fieldName: string): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === collectionId);
    if (!node) return;
    const idx = node.data.fields.findIndex((f) => f.name === fieldName);
    if (idx === -1) return;
    node.data.fields.splice(idx, 1);
    this.emit('field_removed', { collectionId, fieldName });
  }

  updateField(
    collectionId: string,
    fieldName: string,
    updates: Partial<VisualCanvasField>,
  ): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === collectionId);
    if (!node) return;
    const field = node.data.fields.find((f) => f.name === fieldName);
    if (!field) return;
    Object.assign(field, updates);
    this.emit('field_updated', { collectionId, fieldName });
  }

  // ─── Relation (Edge) Operations ─────────────────────────────────────

  addRelation(
    source: string,
    target: string,
    sourceField: string,
    targetField: string,
    type: RelationType,
  ): SchemaCanvasEdge {
    this.pushUndo();
    const edge: SchemaCanvasEdge = {
      id: genId(),
      source,
      target,
      sourceField,
      targetField,
      relationType: type,
    };
    this._state.edges.push(edge);
    this.emit('edge_added', { edgeId: edge.id });
    return clone(edge);
  }

  removeRelation(edgeId: string): void {
    this.pushUndo();
    const idx = this._state.edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) return;
    this._state.edges.splice(idx, 1);
    this.emit('edge_removed', { edgeId });
  }

  // ─── Index Operations ───────────────────────────────────────────────

  addIndex(collectionId: string, index: VisualCanvasIndex): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === collectionId);
    if (!node) return;
    node.data.indexes.push(clone(index));
    this.emit('index_added', { collectionId, indexName: index.name });
  }

  removeIndex(collectionId: string, indexName: string): void {
    this.pushUndo();
    const node = this._state.nodes.find((n) => n.id === collectionId);
    if (!node) return;
    const idx = node.data.indexes.findIndex((i) => i.name === indexName);
    if (idx === -1) return;
    node.data.indexes.splice(idx, 1);
    this.emit('index_removed', { collectionId, indexName });
  }

  // ─── State ──────────────────────────────────────────────────────────

  getState(): SchemaCanvasState {
    return clone(this._state);
  }

  // ─── Layout ─────────────────────────────────────────────────────────

  applyLayout(algorithm: LayoutAlgorithm): void {
    this.pushUndo();
    const nodes = this._state.nodes;
    switch (algorithm) {
      case 'grid':
        this.layoutGrid(nodes);
        break;
      case 'circular':
        this.layoutCircular(nodes);
        break;
      case 'hierarchical':
        this.layoutHierarchical(nodes);
        break;
      case 'force-directed':
      default:
        this.layoutForceDirected(nodes);
        break;
    }
    this.emit('layout_applied', { algorithm });
  }

  private layoutGrid(nodes: SchemaCanvasNode[]): void {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const spacing = 300;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i]!.position = {
        x: (i % cols) * spacing,
        y: Math.floor(i / cols) * spacing,
      };
    }
  }

  private layoutCircular(nodes: SchemaCanvasNode[]): void {
    if (nodes.length === 0) return;
    const radius = Math.max(200, nodes.length * 60);
    const step = (2 * Math.PI) / nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i]!.position = {
        x: Math.round(radius * Math.cos(i * step)),
        y: Math.round(radius * Math.sin(i * step)),
      };
    }
  }

  private layoutHierarchical(nodes: SchemaCanvasNode[]): void {
    // Build adjacency from edges: sources are parents
    const childSet = new Set(this._state.edges.map((e) => e.target));
    const roots = nodes.filter((n) => !childSet.has(n.id));
    const visited = new Set<string>();
    let col = 0;

    const place = (node: SchemaCanvasNode, depth: number): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      node.position = { x: col * 300, y: depth * 250 };
      const children = this._state.edges
        .filter((e) => e.source === node.id)
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter(Boolean) as SchemaCanvasNode[];
      for (const child of children) {
        place(child, depth + 1);
      }
      col++;
    };

    for (const root of roots.length > 0 ? roots : nodes) {
      place(root, 0);
    }
    // Place any unvisited nodes
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        place(node, 0);
      }
    }
  }

  private layoutForceDirected(nodes: SchemaCanvasNode[]): void {
    if (nodes.length === 0) return;
    // Initialize positions in a grid to avoid overlaps
    this.layoutGrid(nodes);

    const iterations = 50;
    const repulsion = 50000;
    const attraction = 0.01;
    const damping = 0.9;

    const velocities = new Map<string, { vx: number; vy: number }>();
    for (const n of nodes) {
      velocities.set(n.id, { vx: 0, vy: 0 });
    }

    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = a.position.x - b.position.x;
          const dy = a.position.y - b.position.y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = repulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          velocities.get(a.id)!.vx += fx;
          velocities.get(a.id)!.vy += fy;
          velocities.get(b.id)!.vx -= fx;
          velocities.get(b.id)!.vy -= fy;
        }
      }

      // Attraction along edges
      for (const edge of this._state.edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const fx = dx * attraction;
        const fy = dy * attraction;
        velocities.get(a.id)!.vx += fx;
        velocities.get(a.id)!.vy += fy;
        velocities.get(b.id)!.vx -= fx;
        velocities.get(b.id)!.vy -= fy;
      }

      // Apply velocities
      for (const n of nodes) {
        const v = velocities.get(n.id)!;
        n.position.x += Math.round(v.vx);
        n.position.y += Math.round(v.vy);
        v.vx *= damping;
        v.vy *= damping;
      }
    }
  }

  // ─── Import / Export ────────────────────────────────────────────────

  importSchema(options: SchemaImportOptions): void {
    this.pushUndo();

    if (options.source === 'json') {
      const data = options.data as Record<string, unknown>;
      const collections = (data.collections ?? data.nodes ?? []) as Array<Record<string, unknown>>;
      for (const coll of collections) {
        const fields = ((coll.fields ?? []) as Array<Record<string, unknown>>).map(
          (f) => ({
            name: (f.name as string) ?? '',
            type: (f.type as VisualFieldType) ?? 'string',
            required: (f.required as boolean) ?? false,
            unique: f.unique as boolean | undefined,
            default: f.default,
            description: f.description as string | undefined,
          }),
        );
        this.addCollection(
          (coll.name as string) ?? 'Untitled',
          fields,
          coll.position as { x: number; y: number } | undefined,
        );
      }
      // Pop the undo entries from addCollection since we already pushed one
    } else if (options.source === 'typescript') {
      // Parse simple interface-like strings
      const src = options.data as string;
      const interfaceRegex = /interface\s+(\w+)\s*\{([^}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = interfaceRegex.exec(src)) !== null) {
        const name = match[1]!;
        const body = match[2]!;
        const fields: VisualCanvasField[] = [];
        const fieldRegex = /(\w+)(\?)?\s*:\s*(\w+)/g;
        let fm: RegExpExecArray | null;
        while ((fm = fieldRegex.exec(body)) !== null) {
          fields.push({
            name: fm[1]!,
            type: this.tsTypeToFieldType(fm[3]!),
            required: fm[2] !== '?',
          });
        }
        this.addCollection(name, fields);
      }
    }
    // 'database' source is a no-op placeholder for runtime introspection
    this.emitState();
  }

  private tsTypeToFieldType(ts: string): VisualFieldType {
    const map: Record<string, VisualFieldType> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      Date: 'date',
      object: 'object',
      Array: 'array',
    };
    return map[ts] ?? 'string';
  }

  exportSchema(format: SchemaExportFormat): string {
    switch (format) {
      case 'json':
        return JSON.stringify(this._state, null, 2);
      case 'typescript':
        return this.exportTypeScript();
      case 'zod':
        return this.exportZod();
      case 'pocketql':
        return this.exportPocketQL();
      case 'sql-ddl':
        return this.exportSQLDDL();
      case 'graphql':
        return this.exportGraphQL();
      default:
        return JSON.stringify(this._state, null, 2);
    }
  }

  private exportTypeScript(): string {
    const lines: string[] = [];
    for (const node of this._state.nodes) {
      lines.push(`export interface ${node.data.name} {`);
      for (const f of node.data.fields) {
        const opt = f.required ? '' : '?';
        lines.push(`  ${f.name}${opt}: ${mapFieldType(f.type)};`);
      }
      lines.push('}');
      lines.push('');
    }
    return lines.join('\n');
  }

  private exportZod(): string {
    const lines: string[] = ["import { z } from 'zod';", ''];
    for (const node of this._state.nodes) {
      lines.push(`export const ${node.data.name}Schema = z.object({`);
      for (const f of node.data.fields) {
        let zodType = this.fieldTypeToZod(f.type);
        if (!f.required) zodType += '.optional()';
        lines.push(`  ${f.name}: ${zodType},`);
      }
      lines.push('});');
      lines.push('');
    }
    return lines.join('\n');
  }

  private fieldTypeToZod(t: VisualFieldType): string {
    const map: Record<VisualFieldType, string> = {
      string: 'z.string()',
      number: 'z.number()',
      boolean: 'z.boolean()',
      date: 'z.date()',
      object: 'z.record(z.unknown())',
      array: 'z.array(z.unknown())',
      reference: 'z.string()',
    };
    return map[t] ?? 'z.unknown()';
  }

  private exportPocketQL(): string {
    const lines: string[] = [];
    for (let i = 0; i < this._state.nodes.length; i++) {
      const node = this._state.nodes[i]!;
      if (i > 0) lines.push('');
      lines.push(`collection ${node.data.name} {`);
      for (const f of node.data.fields) {
        const req = f.required ? '' : '?';
        lines.push(`  ${f.name}${req}: ${f.type}`);
      }
      for (const idx of node.data.indexes) {
        const directive = idx.unique ? '@unique' : '@index';
        lines.push(`  ${directive}(${idx.fields.join(', ')})`);
      }
      lines.push('}');
    }
    return lines.join('\n') + '\n';
  }

  private exportSQLDDL(): string {
    const lines: string[] = [];
    for (let i = 0; i < this._state.nodes.length; i++) {
      const node = this._state.nodes[i]!;
      if (i > 0) lines.push('');
      lines.push(`CREATE TABLE ${node.data.name} (`);
      const colDefs: string[] = [];
      for (const f of node.data.fields) {
        let col = `  ${f.name} ${mapFieldTypeToSQL(f.type)}`;
        if (f.required) col += ' NOT NULL';
        if (f.unique) col += ' UNIQUE';
        colDefs.push(col);
      }
      lines.push(colDefs.join(',\n'));
      lines.push(');');
    }
    return lines.join('\n') + '\n';
  }

  private exportGraphQL(): string {
    const lines: string[] = [];
    for (let i = 0; i < this._state.nodes.length; i++) {
      const node = this._state.nodes[i]!;
      if (i > 0) lines.push('');
      lines.push(`type ${node.data.name} {`);
      for (const f of node.data.fields) {
        const gqlType = mapFieldTypeToGraphQL(f.type);
        const req = f.required ? '!' : '';
        lines.push(`  ${f.name}: ${gqlType}${req}`);
      }
      lines.push('}');
    }
    return lines.join('\n') + '\n';
  }

  // ─── Selection & Viewport ──────────────────────────────────────────

  select(id: string | null): void {
    const isNode = id ? this._state.nodes.some((n) => n.id === id) : false;
    const isEdge = id ? this._state.edges.some((e) => e.id === id) : false;
    this._state.selectedNodeId = isNode ? id! : undefined;
    this._state.selectedEdgeId = isEdge ? id! : undefined;
    this.emit('selection_changed', { selectedId: id });
  }

  setViewport(viewport: { x: number; y: number; zoom: number }): void {
    this._state.viewport = { ...viewport };
    this.emit('viewport_changed', { viewport });
  }

  // ─── Observables ───────────────────────────────────────────────────

  get events(): Observable<CanvasEvent> {
    return this._events$.asObservable();
  }

  get state$(): Observable<SchemaCanvasState> {
    return this._state$.asObservable();
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this._state));
    this._state = prev;
    this.emitState();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this._state));
    this._state = next;
    this.emitState();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  destroy(): void {
    this._events$.complete();
    this._state$.complete();
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private pushUndo(): void {
    this.undoStack.push(clone(this._state));
    this.redoStack = [];
  }

  private emit(type: CanvasEvent['type'], data: Record<string, unknown>): void {
    this._events$.next({ type, timestamp: Date.now(), data });
    this.emitState();
  }

  private emitState(): void {
    this._state$.next(clone(this._state));
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Create a SchemaCanvas instance. */
export function createSchemaCanvas(
  initialState?: Partial<SchemaCanvasState>,
): SchemaCanvas {
  return new SchemaCanvas(initialState);
}

/**
 * Visual Schema & Query Designer types for Pocket Studio.
 */

/** Visual canvas node representing a collection */
export interface SchemaCanvasNode {
  id: string;
  type: 'collection';
  position: { x: number; y: number };
  data: {
    name: string;
    fields: VisualCanvasField[];
    indexes: VisualCanvasIndex[];
    color?: string;
    collapsed?: boolean;
  };
}

export interface VisualCanvasField {
  name: string;
  type: VisualFieldType;
  required: boolean;
  unique?: boolean;
  default?: unknown;
  description?: string;
}

export type VisualFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'reference';

export interface VisualCanvasIndex {
  name: string;
  fields: string[];
  unique: boolean;
  sparse?: boolean;
}

/** Edge representing a relation between collections */
export interface SchemaCanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceField: string;
  targetField: string;
  relationType: RelationType;
  label?: string;
}

export type RelationType = '1:1' | '1:N' | 'N:M';

/** Canvas state */
export interface SchemaCanvasState {
  nodes: SchemaCanvasNode[];
  edges: SchemaCanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  selectedNodeId?: string;
  selectedEdgeId?: string;
}

/** Canvas event types */
export type CanvasEventType =
  | 'node_added' | 'node_removed' | 'node_moved' | 'node_updated'
  | 'edge_added' | 'edge_removed' | 'edge_updated'
  | 'field_added' | 'field_removed' | 'field_updated'
  | 'index_added' | 'index_removed'
  | 'viewport_changed' | 'selection_changed'
  | 'layout_applied';

export interface CanvasEvent {
  type: CanvasEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Auto-layout algorithm */
export type LayoutAlgorithm = 'force-directed' | 'hierarchical' | 'grid' | 'circular';

/** Schema import source */
export interface SchemaImportOptions {
  source: 'database' | 'json' | 'typescript';
  data: unknown;
}

/** Schema export format */
export type SchemaExportFormat = 'json' | 'typescript' | 'zod' | 'pocketql' | 'sql-ddl' | 'graphql';

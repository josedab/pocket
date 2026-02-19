/**
 * Schema Designer — visual schema designer data model and engine for Pocket Studio.
 *
 * Provides the state management layer for a canvas-based schema designer
 * with undo/redo support and bidirectional .pocket DSL generation.
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported field types matching the .pocket DSL */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]';

/** A field in a canvas collection */
export interface CanvasField {
  id: string;
  name: string;
  type: FieldType;
  optional: boolean;
  defaultValue?: unknown;
  description?: string;
}

/** An index on a canvas collection */
export interface CanvasIndex {
  id: string;
  fields: string[];
  unique: boolean;
}

/** A collection positioned on the designer canvas */
export interface CanvasCollection {
  id: string;
  name: string;
  position: { x: number; y: number };
  fields: CanvasField[];
  indexes: CanvasIndex[];
  /** Whether this collection has timestamp fields (createdAt/updatedAt) */
  timestamps?: boolean;
}

/** A relationship between two collections */
export interface CanvasRelationship {
  id: string;
  fromCollection: string;
  fromField: string;
  toCollection: string;
  toField: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/** The full canvas state */
export interface SchemaCanvas {
  collections: CanvasCollection[];
  relationships: CanvasRelationship[];
}

/** Configuration for the schema designer */
export interface SchemaDesignerConfig {
  maxCollections?: number;
  maxFieldsPerCollection?: number;
  /** Sample size for schema inference (legacy compat) */
  sampleSize?: number;
}

/** Discriminated union of designer actions for undo/redo */
export type DesignerAction =
  | { type: 'addCollection'; collection: CanvasCollection }
  | { type: 'removeCollection'; collection: CanvasCollection; relationships: CanvasRelationship[] }
  | { type: 'addField'; collectionId: string; field: CanvasField }
  | { type: 'removeField'; collectionId: string; field: CanvasField }
  | { type: 'addIndex'; collectionId: string; index: CanvasIndex }
  | { type: 'removeIndex'; collectionId: string; index: CanvasIndex }
  | { type: 'addRelationship'; relationship: CanvasRelationship }
  | { type: 'removeRelationship'; relationship: CanvasRelationship }
  | { type: 'moveCollection'; collectionId: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'renameCollection'; collectionId: string; from: string; to: string }
  | { type: 'renameField'; collectionId: string; fieldId: string; from: string; to: string };

// ─── Backward-compatible type aliases ────────────────────────────────────────

/** @deprecated Use CanvasField instead */
export interface SchemaFieldInfo {
  name: string;
  type: string;
  required: boolean;
  indexed: boolean;
  unique: boolean;
  description?: string;
  defaultValue?: unknown;
  validation?: { min?: number; max?: number; pattern?: string; enum?: unknown[] };
}

/** @deprecated Use CanvasRelationship instead */
export interface SchemaRelationship {
  name: string;
  fromCollection: string;
  fromField: string;
  toCollection: string;
  toField: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/** @deprecated Use SchemaCanvas instead */
export interface CollectionSchemaInfo {
  name: string;
  fields: SchemaFieldInfo[];
  relationships: SchemaRelationship[];
  documentCount: number;
  timestamps: boolean;
  softDelete: boolean;
}

/** @deprecated Use validate() return type instead */
export interface SchemaValidationIssue {
  collection: string;
  field?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// ─── Schema Designer ─────────────────────────────────────────────────────────

/**
 * Visual schema designer data model and engine.
 *
 * Manages a canvas of collections, fields, indexes, and relationships
 * with full undo/redo support and bidirectional DSL generation.
 */
export class SchemaDesigner {
  private _canvas: SchemaCanvas = { collections: [], relationships: [] };
  private undoStack: DesignerAction[] = [];
  private redoStack: DesignerAction[] = [];
  private _nextId = 1;
  private readonly _config: Required<SchemaDesignerConfig>;
  private readonly _subject: BehaviorSubject<SchemaCanvas>;

  constructor(config: SchemaDesignerConfig = {}) {
    this._config = {
      maxCollections: config.maxCollections ?? 50,
      maxFieldsPerCollection: config.maxFieldsPerCollection ?? 100,
      sampleSize: config.sampleSize ?? 100,
    };
    this._subject = new BehaviorSubject<SchemaCanvas>(this.cloneCanvas());
  }

  /** Observable of canvas state changes */
  get canvas$(): Observable<SchemaCanvas> {
    return this._subject.asObservable();
  }

  /** Get a deep clone of the current canvas state */
  getCanvas(): SchemaCanvas {
    return this.cloneCanvas();
  }

  // ─── Collection Operations ───────────────────────────────────────────

  addCollection(name: string, position?: { x: number; y: number }): CanvasCollection {
    if (this._canvas.collections.length >= this._config.maxCollections) {
      throw new Error(`Maximum collections (${this._config.maxCollections}) reached`);
    }
    const collection: CanvasCollection = {
      id: this.genId(),
      name,
      position: position ? { ...position } : { x: 0, y: 0 },
      fields: [],
      indexes: [],
    };
    this._canvas.collections.push(clone(collection));
    this.record({ type: 'addCollection', collection: clone(collection) });
    return clone(collection);
  }

  removeCollection(id: string): void {
    const idx = this._canvas.collections.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const collection = clone(this._canvas.collections[idx]!);
    const removedRels = this._canvas.relationships
      .filter((r) => r.fromCollection === id || r.toCollection === id)
      .map(clone);
    this._canvas.collections.splice(idx, 1);
    this._canvas.relationships = this._canvas.relationships.filter(
      (r) => r.fromCollection !== id && r.toCollection !== id,
    );
    this.record({ type: 'removeCollection', collection, relationships: removedRels });
  }

  renameCollection(id: string, newName: string): void {
    const coll = this.findCollection(id);
    if (!coll) return;
    const oldName = coll.name;
    coll.name = newName;
    this.record({ type: 'renameCollection', collectionId: id, from: oldName, to: newName });
  }

  moveCollection(id: string, position: { x: number; y: number }): void {
    const coll = this.findCollection(id);
    if (!coll) return;
    const from = { ...coll.position };
    coll.position = { ...position };
    this.record({ type: 'moveCollection', collectionId: id, from, to: { ...position } });
  }

  // ─── Field Operations ────────────────────────────────────────────────

  addField(collectionIdOrName: string, field: Omit<CanvasField, 'id'> | Record<string, unknown>): CanvasField | boolean {
    // Legacy compat: if arg is a collection name, resolve to id
    let coll = this.findCollection(collectionIdOrName);
    if (!coll) {
      coll = this.findCollectionByName(collectionIdOrName);
    }
    if (!coll) {
      // Legacy API returns false for not found
      if (this.findCollectionByName(collectionIdOrName) === undefined && !collectionIdOrName.startsWith('id_')) {
        return false;
      }
      throw new Error(`Collection ${collectionIdOrName} not found`);
    }

    // Legacy compat: check for duplicate field name
    const fieldName = (field as Record<string, unknown>).name as string;
    if (fieldName && coll.fields.some((f) => f.name === fieldName)) {
      return false;
    }

    if (coll.fields.length >= this._config.maxFieldsPerCollection) {
      throw new Error(`Maximum fields per collection (${this._config.maxFieldsPerCollection}) reached`);
    }

    // Normalize legacy field format to CanvasField format
    const normalized: Omit<CanvasField, 'id'> = {
      name: fieldName ?? '',
      type: ((field as Record<string, unknown>).type as CanvasField['type']) ?? 'string',
      optional: (field as Record<string, unknown>).required === false || (field as Record<string, unknown>).optional === true,
      description: (field as Record<string, unknown>).description as string | undefined,
      defaultValue: (field as Record<string, unknown>).defaultValue as unknown,
    };

    const canvasField: CanvasField = { ...normalized, id: this.genId() };
    coll.fields.push(clone(canvasField));
    this.record({ type: 'addField', collectionId: coll.id, field: clone(canvasField) });

    // If called from legacy API (collection name, not id), return boolean
    if (!collectionIdOrName.startsWith('id_')) {
      return true;
    }
    return clone(canvasField);
  }

  removeField(collectionIdOrName: string, fieldIdOrName: string): void | boolean {
    let coll = this.findCollection(collectionIdOrName);
    if (!coll) {
      coll = this.findCollectionByName(collectionIdOrName);
    }
    if (!coll) return false;

    // Try by id first, then by name
    let idx = coll.fields.findIndex((f) => f.id === fieldIdOrName);
    if (idx === -1) {
      idx = coll.fields.findIndex((f) => f.name === fieldIdOrName);
    }
    if (idx === -1) return false;
    const field = clone(coll.fields[idx]!);
    coll.fields.splice(idx, 1);
    this.record({ type: 'removeField', collectionId: coll.id, field });
    return true;
  }

  renameField(collectionId: string, fieldId: string, newName: string): void {
    const coll = this.findCollection(collectionId);
    if (!coll) return;
    const field = coll.fields.find((f) => f.id === fieldId);
    if (!field) return;
    const oldName = field.name;
    field.name = newName;
    this.record({ type: 'renameField', collectionId, fieldId, from: oldName, to: newName });
  }

  // ─── Index Operations ────────────────────────────────────────────────

  addIndex(collectionId: string, fieldNames: string[], unique?: boolean): CanvasIndex {
    const coll = this.findCollection(collectionId);
    if (!coll) throw new Error(`Collection ${collectionId} not found`);
    const index: CanvasIndex = {
      id: this.genId(),
      fields: [...fieldNames],
      unique: unique ?? false,
    };
    coll.indexes.push(clone(index));
    this.record({ type: 'addIndex', collectionId, index: clone(index) });
    return clone(index);
  }

  removeIndex(collectionId: string, indexId: string): void {
    const coll = this.findCollection(collectionId);
    if (!coll) return;
    const idx = coll.indexes.findIndex((i) => i.id === indexId);
    if (idx === -1) return;
    const index = clone(coll.indexes[idx]!);
    coll.indexes.splice(idx, 1);
    this.record({ type: 'removeIndex', collectionId, index });
  }

  // ─── Relationship Operations ─────────────────────────────────────────

  addRelationship(rel: Omit<CanvasRelationship, 'id'> | Record<string, unknown>): CanvasRelationship {
    // Legacy compat: resolve collection names to IDs
    const fromColl = this.findCollection(rel.fromCollection as string) ?? this.findCollectionByName(rel.fromCollection as string);
    const toColl = this.findCollection(rel.toCollection as string) ?? this.findCollectionByName(rel.toCollection as string);

    const normalized: Omit<CanvasRelationship, 'id'> = {
      fromCollection: fromColl?.id ?? (rel.fromCollection as string),
      fromField: (rel.fromField ?? (rel as Record<string, unknown>).fromField) as string,
      toCollection: toColl?.id ?? (rel.toCollection as string),
      toField: (rel.toField ?? (rel as Record<string, unknown>).toField) as string,
      type: (rel.type as CanvasRelationship['type']) ?? 'one-to-many',
    };

    const relationship: CanvasRelationship = { ...normalized, id: this.genId() };
    this._canvas.relationships.push(clone(relationship));
    this.record({ type: 'addRelationship', relationship: clone(relationship) });
    return clone(relationship);
  }

  removeRelationship(id: string): void {
    const idx = this._canvas.relationships.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const rel = clone(this._canvas.relationships[idx]!);
    this._canvas.relationships.splice(idx, 1);
    this.record({ type: 'removeRelationship', relationship: rel });
  }

  // ─── DSL Generation & Import ─────────────────────────────────────────

  /** Generate .pocket DSL text from the current canvas state */
  toDSL(): string {
    if (this._canvas.collections.length === 0) return '';

    const lines: string[] = [];
    for (let ci = 0; ci < this._canvas.collections.length; ci++) {
      const coll = this._canvas.collections[ci]!;
      if (ci > 0) lines.push('');
      lines.push(`collection ${coll.name} {`);
      for (const field of coll.fields) {
        let line = `  ${field.name}${field.optional ? '?' : ''}: ${field.type}`;
        if (field.defaultValue !== undefined) {
          line += ` = ${formatDefault(field.defaultValue, field.type)}`;
        }
        lines.push(line);
      }
      for (const idx of coll.indexes) {
        const directive = idx.unique ? '@unique' : '@index';
        lines.push(`  ${directive}(${idx.fields.join(', ')})`);
      }
      lines.push('}');
    }
    return lines.join('\n') + '\n';
  }

  /** Import .pocket DSL text into canvas state (replaces current state) */
  fromDSL(dsl: string): void {
    const canvas = parseDSLToCanvas(dsl);
    let nextId = this._nextId;
    for (const coll of canvas.collections) {
      coll.id = `id_${nextId++}`;
      for (const field of coll.fields) {
        field.id = `id_${nextId++}`;
      }
      for (const idx of coll.indexes) {
        idx.id = `id_${nextId++}`;
      }
    }
    this._nextId = nextId;
    this._canvas = canvas;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  // ─── Undo / Redo ─────────────────────────────────────────────────────

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;
    this.applyInverse(action);
    this.redoStack.push(action);
    this.emit();
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;
    this.applyForward(action);
    this.undoStack.push(action);
    this.emit();
  }

  // ─── Validation ──────────────────────────────────────────────────────

  validate(): SchemaValidationIssue[] & { valid: boolean; errors: string[] } {
    const issues: SchemaValidationIssue[] = [];
    const names = new Set<string>();

    for (const coll of this._canvas.collections) {
      if (names.has(coll.name)) {
        issues.push({ collection: coll.name, severity: 'error', message: `Duplicate collection name: "${coll.name}"` });
      }
      names.add(coll.name);

      if (coll.fields.length === 0) {
        issues.push({ collection: coll.name, severity: 'warning', message: `Collection "${coll.name}" has no fields` });
      }

      const fieldNames = new Set<string>();
      for (const field of coll.fields) {
        if (fieldNames.has(field.name)) {
          issues.push({ collection: coll.name, field: field.name, severity: 'error', message: `Duplicate field name "${field.name}" in collection "${coll.name}"` });
        }
        fieldNames.add(field.name);
      }
    }

    const collIds = new Set(this._canvas.collections.map((c) => c.id));
    const collNames = new Set(this._canvas.collections.map((c) => c.name));
    for (const rel of this._canvas.relationships) {
      if (!collIds.has(rel.fromCollection) && !collNames.has(rel.fromCollection)) {
        issues.push({ collection: rel.fromCollection, severity: 'error', message: `Relationship references unknown collection: ${rel.fromCollection}` });
      }
      if (!collIds.has(rel.toCollection) && !collNames.has(rel.toCollection)) {
        issues.push({ collection: rel.toCollection, severity: 'error', message: `Relationship references unknown collection: ${rel.toCollection}` });
      }
    }

    const errors = issues.map((i) => i.message);
    const result = issues as SchemaValidationIssue[] & { valid: boolean; errors: string[] };
    result.valid = issues.length === 0;
    result.errors = errors;
    return result;
  }

  // ─── Backward-compatible legacy API ──────────────────────────────────
  // These methods accept collection *names* instead of IDs, matching
  // the original SchemaDesigner API used by studio-v2 tests.

  private findCollectionByName(name: string): CanvasCollection | undefined {
    return this._canvas.collections.find((c) => c.name === name);
  }

  /** Infer a schema from sample documents (legacy compat) */
  async inferSchema(
    collectionName: string,
    docs: Record<string, unknown>[]
  ): Promise<CollectionSchemaInfo> {
    let coll = this.findCollectionByName(collectionName);
    if (coll) {
      coll.fields = [];
    } else {
      this.addCollection(collectionName);
      coll = this.findCollectionByName(collectionName)!;
    }

    if (docs.length === 0) {
      return this.toSchemaFieldInfo(coll);
    }

    const fieldStats = new Map<string, { type: string; count: number }>();
    let hasTimestamp = false;

    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (key === '_id' || key === '_rev' || key === '_updatedAt' || key === '_deleted') continue;
        if (key === 'createdAt' || key === 'updatedAt') {
          hasTimestamp = true;
          continue;
        }
        const t = value instanceof Date ? 'date' : typeof value === 'object' && Array.isArray(value) ? 'string[]' : typeof value as string;
        const existing = fieldStats.get(key);
        if (existing) {
          existing.count++;
        } else {
          fieldStats.set(key, { type: t === 'object' ? 'string' : t, count: 1 });
        }
      }
    }

    for (const [name, stat] of fieldStats) {
      const fieldType = (stat.type === 'string' || stat.type === 'number' || stat.type === 'boolean' || stat.type === 'date' || stat.type === 'string[]') ? stat.type : 'string';
      this.addField(coll.id, {
        name,
        type: fieldType as CanvasField['type'],
        optional: stat.count < docs.length,
        description: undefined,
        defaultValue: undefined,
      });
    }

    const resolvedColl = this.findCollection(coll.id) ?? coll;
    if (hasTimestamp) {
      resolvedColl.timestamps = true;
    }
    const info = this.toSchemaFieldInfo(resolvedColl);
    return info;
  }

  /** Get schema by collection name (legacy compat) */
  getSchema(name: string): CollectionSchemaInfo | undefined {
    const coll = this.findCollectionByName(name);
    return coll ? this.toSchemaFieldInfo(coll) : undefined;
  }

  /** Get all schemas (legacy compat) */
  getAllSchemas(): CollectionSchemaInfo[] {
    return this._canvas.collections.map((c) => this.toSchemaFieldInfo(c));
  }

  /** Export schema by collection name (legacy compat, alias for getSchema) */
  exportSchema(name: string): CollectionSchemaInfo | undefined {
    return this.getSchema(name);
  }

  private toSchemaFieldInfo(coll: CanvasCollection): CollectionSchemaInfo {
    const rels = this._canvas.relationships
      .filter((r) => r.fromCollection === coll.id || r.fromCollection === coll.name)
      .map((r) => {
        const toColl = this.findCollection(r.toCollection);
        return {
          name: '',
          fromCollection: coll.name,
          fromField: r.fromField,
          toCollection: toColl?.name ?? r.toCollection,
          toField: r.toField,
          type: r.type,
        };
      });

    return {
      name: coll.name,
      fields: coll.fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: !f.optional,
        indexed: false,
        unique: false,
      })),
      timestamps: coll.timestamps ?? false,
      softDelete: false,
      documentCount: 0,
      relationships: rels,
    };
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private genId(): string {
    return `id_${this._nextId++}`;
  }

  private findCollection(id: string): CanvasCollection | undefined {
    return this._canvas.collections.find((c) => c.id === id);
  }

  private cloneCanvas(): SchemaCanvas {
    return clone(this._canvas);
  }

  private emit(): void {
    this._subject.next(this.cloneCanvas());
  }

  private record(action: DesignerAction): void {
    this.undoStack.push(action);
    this.redoStack = [];
    this.emit();
  }

  private applyInverse(action: DesignerAction): void {
    switch (action.type) {
      case 'addCollection': {
        const idx = this._canvas.collections.findIndex((c) => c.id === action.collection.id);
        if (idx !== -1) this._canvas.collections.splice(idx, 1);
        this._canvas.relationships = this._canvas.relationships.filter(
          (r) => r.fromCollection !== action.collection.id && r.toCollection !== action.collection.id,
        );
        break;
      }
      case 'removeCollection':
        this._canvas.collections.push(clone(action.collection));
        for (const rel of action.relationships) {
          this._canvas.relationships.push(clone(rel));
        }
        break;
      case 'addField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const idx = coll.fields.findIndex((f) => f.id === action.field.id);
          if (idx !== -1) coll.fields.splice(idx, 1);
        }
        break;
      }
      case 'removeField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.fields.push(clone(action.field));
        break;
      }
      case 'addIndex': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const idx = coll.indexes.findIndex((i) => i.id === action.index.id);
          if (idx !== -1) coll.indexes.splice(idx, 1);
        }
        break;
      }
      case 'removeIndex': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.indexes.push(clone(action.index));
        break;
      }
      case 'addRelationship': {
        const idx = this._canvas.relationships.findIndex((r) => r.id === action.relationship.id);
        if (idx !== -1) this._canvas.relationships.splice(idx, 1);
        break;
      }
      case 'removeRelationship':
        this._canvas.relationships.push(clone(action.relationship));
        break;
      case 'moveCollection': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.position = { ...action.from };
        break;
      }
      case 'renameCollection': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.name = action.from;
        break;
      }
      case 'renameField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const field = coll.fields.find((f) => f.id === action.fieldId);
          if (field) field.name = action.from;
        }
        break;
      }
    }
  }

  private applyForward(action: DesignerAction): void {
    switch (action.type) {
      case 'addCollection':
        this._canvas.collections.push(clone(action.collection));
        break;
      case 'removeCollection': {
        const idx = this._canvas.collections.findIndex((c) => c.id === action.collection.id);
        if (idx !== -1) this._canvas.collections.splice(idx, 1);
        this._canvas.relationships = this._canvas.relationships.filter(
          (r) => r.fromCollection !== action.collection.id && r.toCollection !== action.collection.id,
        );
        break;
      }
      case 'addField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.fields.push(clone(action.field));
        break;
      }
      case 'removeField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const idx = coll.fields.findIndex((f) => f.id === action.field.id);
          if (idx !== -1) coll.fields.splice(idx, 1);
        }
        break;
      }
      case 'addIndex': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.indexes.push(clone(action.index));
        break;
      }
      case 'removeIndex': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const idx = coll.indexes.findIndex((i) => i.id === action.index.id);
          if (idx !== -1) coll.indexes.splice(idx, 1);
        }
        break;
      }
      case 'addRelationship':
        this._canvas.relationships.push(clone(action.relationship));
        break;
      case 'removeRelationship': {
        const idx = this._canvas.relationships.findIndex((r) => r.id === action.relationship.id);
        if (idx !== -1) this._canvas.relationships.splice(idx, 1);
        break;
      }
      case 'moveCollection': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.position = { ...action.to };
        break;
      }
      case 'renameCollection': {
        const coll = this.findCollection(action.collectionId);
        if (coll) coll.name = action.to;
        break;
      }
      case 'renameField': {
        const coll = this.findCollection(action.collectionId);
        if (coll) {
          const field = coll.fields.find((f) => f.id === action.fieldId);
          if (field) field.name = action.to;
        }
        break;
      }
    }
  }

  /** Release resources */
  destroy(): void {
    this._subject.complete();
  }
}

// ─── DSL Helpers ─────────────────────────────────────────────────────────────

function formatDefault(value: unknown, type: FieldType): string {
  if (type === 'string') return `"${value}"`;
  return String(value);
}

function parseDSLToCanvas(dsl: string): SchemaCanvas {
  const collections: CanvasCollection[] = [];
  const lines = dsl.split('\n');
  let i = 0;
  let colIdx = 0;

  while (i < lines.length) {
    const line = stripComments(lines[i]!).trim();
    if (!line) {
      i++;
      continue;
    }

    const collMatch = /^collection\s+(\w+)\s*\{$/.exec(line);
    if (!collMatch) {
      i++;
      continue;
    }

    const coll: CanvasCollection = {
      id: '',
      name: collMatch[1]!,
      position: { x: colIdx * 300, y: 0 },
      fields: [],
      indexes: [],
    };
    i++;
    colIdx++;

    while (i < lines.length) {
      const bodyLine = stripComments(lines[i]!).trim();
      if (!bodyLine) {
        i++;
        continue;
      }
      if (bodyLine === '}') {
        i++;
        break;
      }

      const dirMatch = /^@(index|unique)\(([^)]*)\)$/.exec(bodyLine);
      if (dirMatch) {
        const fields = dirMatch[2]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        coll.indexes.push({ id: '', fields, unique: dirMatch[1] === 'unique' });
        i++;
        continue;
      }

      const fieldMatch = /^(\w+)(\?)?\s*:\s*(\w+(?:\[\])?)\s*(?:=\s*(.+))?$/.exec(bodyLine);
      if (fieldMatch) {
        const optional = fieldMatch[2] === '?';
        const rawType = fieldMatch[3]!;
        const rawDefault = fieldMatch[4]?.trim();
        let defaultValue: unknown;
        if (rawDefault !== undefined) {
          defaultValue = parseDSLDefault(rawDefault, rawType as FieldType);
        }
        const f: CanvasField = {
          id: '',
          name: fieldMatch[1]!,
          type: rawType as FieldType,
          optional,
        };
        if (defaultValue !== undefined) f.defaultValue = defaultValue;
        coll.fields.push(f);
      }
      i++;
    }
    collections.push(coll);
  }

  return { collections, relationships: [] };
}

function stripComments(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

function parseDSLDefault(raw: string, type: FieldType): unknown {
  if (type === 'string') {
    const m = /^["'](.*)["']$/.exec(raw);
    return m ? m[1] : raw;
  }
  if (type === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  return undefined;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Create a SchemaDesigner instance. */
export function createSchemaDesigner(config?: SchemaDesignerConfig): SchemaDesigner {
  return new SchemaDesigner(config);
}

import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  SchemaDesigner,
  createSchemaDesigner,
  type CanvasCollection,
  type SchemaCanvas,
} from '../schema-designer.js';

describe('SchemaDesigner', () => {
  let designer: SchemaDesigner;

  beforeEach(() => {
    designer = createSchemaDesigner();
  });

  // ── Add / Remove Collection ────────────────────────────────────────

  it('should add a collection', () => {
    const coll = designer.addCollection('Users', { x: 100, y: 200 });
    expect(coll.name).toBe('Users');
    expect(coll.position).toEqual({ x: 100, y: 200 });
    expect(coll.fields).toEqual([]);
    expect(designer.getCanvas().collections).toHaveLength(1);
  });

  it('should add a collection with default position', () => {
    const coll = designer.addCollection('Users');
    expect(coll.position).toEqual({ x: 0, y: 0 });
  });

  it('should remove a collection', () => {
    const coll = designer.addCollection('Users');
    designer.removeCollection(coll.id);
    expect(designer.getCanvas().collections).toHaveLength(0);
  });

  it('should remove associated relationships when removing a collection', () => {
    const users = designer.addCollection('Users');
    const posts = designer.addCollection('Posts');
    designer.addRelationship({
      fromCollection: users.id,
      fromField: 'id',
      toCollection: posts.id,
      toField: 'authorId',
      type: 'one-to-many',
    });
    expect(designer.getCanvas().relationships).toHaveLength(1);
    designer.removeCollection(users.id);
    expect(designer.getCanvas().relationships).toHaveLength(0);
  });

  // ── Add / Remove Field ─────────────────────────────────────────────

  it('should add a field to a collection', () => {
    const coll = designer.addCollection('Users');
    const field = designer.addField(coll.id, {
      name: 'email',
      type: 'string',
      optional: false,
    });
    expect(field.name).toBe('email');
    expect(field.type).toBe('string');
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(1);
  });

  it('should remove a field from a collection', () => {
    const coll = designer.addCollection('Users');
    const field = designer.addField(coll.id, {
      name: 'email',
      type: 'string',
      optional: false,
    });
    designer.removeField(coll.id, field.id);
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(0);
  });

  it('should return false when adding field to unknown collection', () => {
    const result = designer.addField('nonexistent', { name: 'x', type: 'string', optional: false });
    expect(result).toBe(false);
  });

  // ── Add Index ──────────────────────────────────────────────────────

  it('should add an index to a collection', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'email', type: 'string', optional: false });
    const index = designer.addIndex(coll.id, ['email'], true);
    expect(index.fields).toEqual(['email']);
    expect(index.unique).toBe(true);
    expect(designer.getCanvas().collections[0]!.indexes).toHaveLength(1);
  });

  it('should add a compound non-unique index', () => {
    const coll = designer.addCollection('Users');
    const index = designer.addIndex(coll.id, ['name', 'age']);
    expect(index.unique).toBe(false);
    expect(index.fields).toEqual(['name', 'age']);
  });

  it('should remove an index', () => {
    const coll = designer.addCollection('Users');
    const index = designer.addIndex(coll.id, ['email'], true);
    designer.removeIndex(coll.id, index.id);
    expect(designer.getCanvas().collections[0]!.indexes).toHaveLength(0);
  });

  // ── Add Relationship ───────────────────────────────────────────────

  it('should add a relationship between collections', () => {
    const users = designer.addCollection('Users');
    const posts = designer.addCollection('Posts');
    const rel = designer.addRelationship({
      fromCollection: users.id,
      fromField: 'id',
      toCollection: posts.id,
      toField: 'authorId',
      type: 'one-to-many',
    });
    expect(rel.type).toBe('one-to-many');
    expect(designer.getCanvas().relationships).toHaveLength(1);
  });

  it('should remove a relationship', () => {
    const users = designer.addCollection('Users');
    const posts = designer.addCollection('Posts');
    const rel = designer.addRelationship({
      fromCollection: users.id,
      fromField: 'id',
      toCollection: posts.id,
      toField: 'authorId',
      type: 'one-to-many',
    });
    designer.removeRelationship(rel.id);
    expect(designer.getCanvas().relationships).toHaveLength(0);
  });

  // ── Generate DSL from Canvas ───────────────────────────────────────

  it('should generate DSL from canvas state', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'name', type: 'string', optional: false });
    designer.addField(coll.id, { name: 'email', type: 'string', optional: true });
    designer.addField(coll.id, { name: 'age', type: 'number', optional: false, defaultValue: 0 });
    designer.addIndex(coll.id, ['email'], true);
    designer.addIndex(coll.id, ['name', 'age']);

    const dsl = designer.toDSL();
    expect(dsl).toContain('collection Users {');
    expect(dsl).toContain('  name: string');
    expect(dsl).toContain('  email?: string');
    expect(dsl).toContain('  age: number = 0');
    expect(dsl).toContain('  @unique(email)');
    expect(dsl).toContain('  @index(name, age)');
    expect(dsl).toContain('}');
  });

  it('should return empty string for empty canvas', () => {
    expect(designer.toDSL()).toBe('');
  });

  it('should generate DSL with multiple collections', () => {
    const users = designer.addCollection('Users');
    designer.addField(users.id, { name: 'name', type: 'string', optional: false });
    const posts = designer.addCollection('Posts');
    designer.addField(posts.id, { name: 'title', type: 'string', optional: false });

    const dsl = designer.toDSL();
    expect(dsl).toContain('collection Users {');
    expect(dsl).toContain('collection Posts {');
  });

  // ── Import DSL into Canvas (round-trip) ────────────────────────────

  it('should import DSL into canvas state', () => {
    const dsl = `collection Users {
  name: string
  email?: string
  age: number = 25
  @unique(email)
  @index(name, age)
}
`;
    designer.fromDSL(dsl);
    const canvas = designer.getCanvas();
    expect(canvas.collections).toHaveLength(1);
    const coll = canvas.collections[0]!;
    expect(coll.name).toBe('Users');
    expect(coll.fields).toHaveLength(3);
    expect(coll.fields[0]!.name).toBe('name');
    expect(coll.fields[0]!.optional).toBe(false);
    expect(coll.fields[1]!.name).toBe('email');
    expect(coll.fields[1]!.optional).toBe(true);
    expect(coll.fields[2]!.name).toBe('age');
    expect(coll.fields[2]!.defaultValue).toBe(25);
    expect(coll.indexes).toHaveLength(2);
    expect(coll.indexes.find((i) => i.unique)?.fields).toEqual(['email']);
  });

  it('should round-trip DSL → canvas → DSL', () => {
    const original = [
      'collection Users {',
      '  name: string',
      '  email?: string',
      '  age: number = 25',
      '  @unique(email)',
      '}',
      '',
      'collection Posts {',
      '  title: string',
      '  draft: boolean = false',
      '}',
      '',
    ].join('\n');

    designer.fromDSL(original);
    const generated = designer.toDSL();

    // Re-import and verify structural equivalence
    const designer2 = createSchemaDesigner();
    designer2.fromDSL(generated);

    const c1 = designer.getCanvas();
    const c2 = designer2.getCanvas();
    expect(c1.collections.length).toBe(c2.collections.length);
    for (let i = 0; i < c1.collections.length; i++) {
      expect(c1.collections[i]!.name).toBe(c2.collections[i]!.name);
      expect(c1.collections[i]!.fields.length).toBe(c2.collections[i]!.fields.length);
      expect(c1.collections[i]!.indexes.length).toBe(c2.collections[i]!.indexes.length);
    }
  });

  // ── Undo / Redo ────────────────────────────────────────────────────

  it('should support undo of addCollection', () => {
    designer.addCollection('Users');
    expect(designer.getCanvas().collections).toHaveLength(1);
    expect(designer.canUndo()).toBe(true);

    designer.undo();
    expect(designer.getCanvas().collections).toHaveLength(0);
    expect(designer.canUndo()).toBe(false);
  });

  it('should support redo after undo', () => {
    designer.addCollection('Users');
    designer.undo();
    expect(designer.canRedo()).toBe(true);

    designer.redo();
    expect(designer.getCanvas().collections).toHaveLength(1);
    expect(designer.canRedo()).toBe(false);
  });

  it('should clear redo stack on new action', () => {
    designer.addCollection('Users');
    designer.undo();
    expect(designer.canRedo()).toBe(true);

    designer.addCollection('Posts');
    expect(designer.canRedo()).toBe(false);
  });

  it('should undo removeCollection and restore relationships', () => {
    const users = designer.addCollection('Users');
    const posts = designer.addCollection('Posts');
    designer.addRelationship({
      fromCollection: users.id,
      fromField: 'id',
      toCollection: posts.id,
      toField: 'authorId',
      type: 'one-to-many',
    });
    designer.removeCollection(users.id);
    expect(designer.getCanvas().collections).toHaveLength(1);
    expect(designer.getCanvas().relationships).toHaveLength(0);

    designer.undo();
    expect(designer.getCanvas().collections).toHaveLength(2);
    expect(designer.getCanvas().relationships).toHaveLength(1);
  });

  it('should undo addField', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'email', type: 'string', optional: false });
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(1);

    designer.undo();
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(0);
  });

  it('should undo removeField', () => {
    const coll = designer.addCollection('Users');
    const field = designer.addField(coll.id, { name: 'email', type: 'string', optional: false });
    designer.removeField(coll.id, field.id);
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(0);

    designer.undo();
    expect(designer.getCanvas().collections[0]!.fields).toHaveLength(1);
    expect(designer.getCanvas().collections[0]!.fields[0]!.name).toBe('email');
  });

  it('should undo moveCollection', () => {
    const coll = designer.addCollection('Users', { x: 10, y: 20 });
    designer.moveCollection(coll.id, { x: 100, y: 200 });
    expect(designer.getCanvas().collections[0]!.position).toEqual({ x: 100, y: 200 });

    designer.undo();
    expect(designer.getCanvas().collections[0]!.position).toEqual({ x: 10, y: 20 });
  });

  it('should undo renameCollection', () => {
    const coll = designer.addCollection('Users');
    designer.renameCollection(coll.id, 'People');
    expect(designer.getCanvas().collections[0]!.name).toBe('People');

    designer.undo();
    expect(designer.getCanvas().collections[0]!.name).toBe('Users');
  });

  it('should not fail when undo/redo on empty stacks', () => {
    expect(designer.canUndo()).toBe(false);
    expect(designer.canRedo()).toBe(false);
    designer.undo(); // should not throw
    designer.redo(); // should not throw
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('should detect duplicate collection names', () => {
    designer.addCollection('Users');
    designer.addCollection('Users');
    const result = designer.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate collection name'))).toBe(true);
  });

  it('should detect empty collections', () => {
    designer.addCollection('Users');
    const result = designer.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('no fields'))).toBe(true);
  });

  it('should detect duplicate field names', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'email', type: 'string', optional: false });
    // Force a duplicate by using the internal canvas directly via fromDSL
    const dsl = `collection Users {
  email: string
  email: number
}
`;
    designer.fromDSL(dsl);
    const result = designer.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate field name'))).toBe(true);
  });

  it('should report valid for a well-formed canvas', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'name', type: 'string', optional: false });
    const result = designer.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect relationships to unknown collections', () => {
    const coll = designer.addCollection('Users');
    designer.addField(coll.id, { name: 'name', type: 'string', optional: false });
    designer.addRelationship({
      fromCollection: coll.id,
      fromField: 'id',
      toCollection: 'nonexistent',
      toField: 'userId',
      type: 'one-to-many',
    });
    const result = designer.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown collection'))).toBe(true);
  });

  // ── Observable Emissions ───────────────────────────────────────────

  it('should emit initial state on subscribe', async () => {
    const state = await firstValueFrom(designer.canvas$);
    expect(state.collections).toEqual([]);
    expect(state.relationships).toEqual([]);
  });

  it('should emit on addCollection', async () => {
    const states: SchemaCanvas[] = [];
    const sub = designer.canvas$.pipe(take(3), toArray()).subscribe((s) => {
      states.push(...s);
    });

    designer.addCollection('Users');
    designer.addCollection('Posts');

    // Wait for sync emissions to be captured
    await new Promise((r) => setTimeout(r, 50));
    sub.unsubscribe();

    // BehaviorSubject emits: initial + after addCollection('Users') + after addCollection('Posts')
    expect(states).toHaveLength(3);
    expect(states[0]!.collections).toHaveLength(0);
    expect(states[1]!.collections).toHaveLength(1);
    expect(states[2]!.collections).toHaveLength(2);
  });

  it('should emit on undo', async () => {
    designer.addCollection('Users');

    const states: SchemaCanvas[] = [];
    const sub = designer.canvas$.pipe(take(2), toArray()).subscribe((s) => {
      states.push(...s);
    });

    designer.undo();

    await new Promise((r) => setTimeout(r, 50));
    sub.unsubscribe();

    expect(states).toHaveLength(2);
    expect(states[0]!.collections).toHaveLength(1); // current state
    expect(states[1]!.collections).toHaveLength(0); // after undo
  });

  // ── Move Collection Position ───────────────────────────────────────

  it('should move a collection to a new position', () => {
    const coll = designer.addCollection('Users', { x: 0, y: 0 });
    designer.moveCollection(coll.id, { x: 500, y: 300 });
    const canvas = designer.getCanvas();
    expect(canvas.collections[0]!.position).toEqual({ x: 500, y: 300 });
  });

  it('should not fail when moving nonexistent collection', () => {
    designer.moveCollection('nonexistent', { x: 10, y: 10 }); // no throw
    expect(designer.getCanvas().collections).toHaveLength(0);
  });

  // ── Rename ─────────────────────────────────────────────────────────

  it('should rename a collection', () => {
    const coll = designer.addCollection('Users');
    designer.renameCollection(coll.id, 'People');
    expect(designer.getCanvas().collections[0]!.name).toBe('People');
  });

  it('should rename a field', () => {
    const coll = designer.addCollection('Users');
    const field = designer.addField(coll.id, { name: 'email', type: 'string', optional: false });
    designer.renameField(coll.id, field.id, 'emailAddress');
    expect(designer.getCanvas().collections[0]!.fields[0]!.name).toBe('emailAddress');
  });

  // ── Factory ────────────────────────────────────────────────────────

  it('should create via factory', () => {
    const d = createSchemaDesigner({ maxCollections: 10 });
    expect(d).toBeInstanceOf(SchemaDesigner);
  });

  // ── getCanvas returns deep clone ───────────────────────────────────

  it('should return independent canvas snapshots', () => {
    const coll = designer.addCollection('Users');
    const snap1 = designer.getCanvas();
    designer.addField(coll.id, { name: 'name', type: 'string', optional: false });
    const snap2 = designer.getCanvas();
    expect(snap1.collections[0]!.fields).toHaveLength(0);
    expect(snap2.collections[0]!.fields).toHaveLength(1);
  });
});

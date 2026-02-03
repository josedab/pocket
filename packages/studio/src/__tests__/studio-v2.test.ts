import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaDesigner, createSchemaDesigner } from '../schema-designer.js';
import { DataExplorer, createDataExplorer } from '../data-explorer.js';

// ── SchemaDesigner ──────────────────────────────────────────────────

describe('SchemaDesigner', () => {
  let designer: SchemaDesigner;

  beforeEach(() => {
    designer = createSchemaDesigner({ sampleSize: 50 });
  });

  it('should infer schema from documents', async () => {
    const docs = [
      { _id: '1', name: 'Alice', age: 30, active: true },
      { _id: '2', name: 'Bob', age: 25, active: false },
    ];

    const schema = await designer.inferSchema('users', docs);
    expect(schema.name).toBe('users');
    expect(schema.fields.length).toBe(3); // name, age, active (_id excluded)
    expect(schema.fields.find((f) => f.name === 'name')?.type).toBe('string');
    expect(schema.fields.find((f) => f.name === 'age')?.type).toBe('number');
  });

  it('should detect required fields', async () => {
    const docs = [
      { _id: '1', name: 'Alice', email: 'alice@test.com' },
      { _id: '2', name: 'Bob' }, // no email
    ];

    const schema = await designer.inferSchema('users', docs);
    expect(schema.fields.find((f) => f.name === 'name')?.required).toBe(true);
    expect(schema.fields.find((f) => f.name === 'email')?.required).toBe(false);
  });

  it('should detect timestamps', async () => {
    const docs = [{ _id: '1', createdAt: new Date(), title: 'Test' }];
    const schema = await designer.inferSchema('todos', docs);
    expect(schema.timestamps).toBe(true);
  });

  it('should add and remove fields', async () => {
    await designer.inferSchema('users', [{ _id: '1', name: 'Alice' }]);

    const added = designer.addField('users', {
      name: 'role',
      type: 'string',
      required: false,
      indexed: false,
      unique: false,
    });
    expect(added).toBe(true);
    expect(designer.getSchema('users')?.fields.length).toBe(2);

    const removed = designer.removeField('users', 'role');
    expect(removed).toBe(true);
    expect(designer.getSchema('users')?.fields.length).toBe(1);
  });

  it('should prevent duplicate field names', async () => {
    await designer.inferSchema('users', [{ _id: '1', name: 'Alice' }]);
    const result = designer.addField('users', {
      name: 'name',
      type: 'string',
      required: false,
      indexed: false,
      unique: false,
    });
    expect(result).toBe(false);
  });

  it('should add relationships', async () => {
    await designer.inferSchema('users', [{ _id: '1', name: 'Alice' }]);
    await designer.inferSchema('posts', [{ _id: '1', authorId: '1', title: 'Hello' }]);

    designer.addRelationship({
      name: 'author',
      fromCollection: 'posts',
      fromField: 'authorId',
      toCollection: 'users',
      toField: '_id',
      type: 'many-to-many',
    });

    const schema = designer.getSchema('posts');
    expect(schema?.relationships.length).toBe(1);
  });

  it('should validate schemas', async () => {
    await designer.inferSchema('empty', []);
    const issues = designer.validate();
    expect(issues.some((i) => i.collection === 'empty' && i.severity === 'warning')).toBe(true);
  });

  it('should validate relationship targets', async () => {
    await designer.inferSchema('posts', [{ _id: '1', authorId: '1' }]);
    designer.addRelationship({
      name: 'author',
      fromCollection: 'posts',
      fromField: 'authorId',
      toCollection: 'nonexistent',
      toField: '_id',
      type: 'one-to-many',
    });

    const issues = designer.validate();
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('nonexistent'))).toBe(true);
  });

  it('should export schema definition', async () => {
    await designer.inferSchema('users', [
      { _id: '1', name: 'Alice', age: 30, createdAt: new Date() },
    ]);

    const exported = designer.exportSchema('users');
    expect(exported).toBeDefined();
    expect(exported!.name).toBe('users');
    expect(exported!.timestamps).toBe(true);
  });

  it('should list all schemas', async () => {
    await designer.inferSchema('users', [{ _id: '1', name: 'Alice' }]);
    await designer.inferSchema('todos', [{ _id: '1', title: 'Test' }]);
    expect(designer.getAllSchemas().length).toBe(2);
  });
});

// ── DataExplorer ────────────────────────────────────────────────────

describe('DataExplorer', () => {
  let explorer: DataExplorer;
  const docs = Array.from({ length: 25 }, (_, i) => ({
    _id: String(i),
    name: `User ${i}`,
    age: 20 + (i % 10),
    status: i % 3 === 0 ? 'active' : 'inactive',
  }));

  beforeEach(() => {
    explorer = createDataExplorer({ pageSize: 10 });
  });

  it('should paginate documents', () => {
    const page1 = explorer.paginate(docs, 1);
    expect(page1.documents.length).toBe(10);
    expect(page1.total).toBe(25);
    expect(page1.hasMore).toBe(true);

    const page3 = explorer.paginate(docs, 3);
    expect(page3.documents.length).toBe(5);
    expect(page3.hasMore).toBe(false);
  });

  it('should compute field statistics', () => {
    const stats = explorer.computeFieldStats(docs, 'age');
    expect(stats.type).toBe('number');
    expect(stats.nonNullCount).toBe(25);
    expect(stats.nullCount).toBe(0);
    expect(stats.minValue).toBe(20);
    expect(stats.maxValue).toBe(29);
    expect(stats.avgValue).toBeGreaterThan(0);
  });

  it('should compute string field stats with top values', () => {
    const stats = explorer.computeFieldStats(docs, 'status');
    expect(stats.topValues).toBeDefined();
    expect(stats.topValues!.length).toBeGreaterThan(0);
  });

  it('should aggregate count', () => {
    const result = explorer.aggregate(docs, 'name', 'count');
    expect(result.value).toBe(25);
  });

  it('should aggregate sum', () => {
    const result = explorer.aggregate(docs, 'age', 'sum');
    expect(typeof result.value).toBe('number');
    expect(result.value as number).toBeGreaterThan(0);
  });

  it('should aggregate avg', () => {
    const result = explorer.aggregate(docs, 'age', 'avg');
    expect(typeof result.value).toBe('number');
  });

  it('should aggregate min/max', () => {
    const min = explorer.aggregate(docs, 'age', 'min');
    const max = explorer.aggregate(docs, 'age', 'max');
    expect(min.value).toBe(20);
    expect(max.value).toBe(29);
  });

  it('should aggregate distinct', () => {
    const result = explorer.aggregate(docs, 'status', 'distinct');
    expect(Array.isArray(result.value)).toBe(true);
    expect((result.value as unknown[]).length).toBe(2);
  });

  it('should export as JSON', () => {
    const json = explorer.exportJSON(docs.slice(0, 2));
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(2);
  });

  it('should export as CSV', () => {
    const csv = explorer.exportCSV(docs.slice(0, 3));
    const lines = csv.split('\n');
    expect(lines.length).toBe(4); // header + 3 rows
    expect(lines[0]).toContain('name');
  });

  it('should handle empty CSV export', () => {
    expect(explorer.exportCSV([])).toBe('');
  });
});

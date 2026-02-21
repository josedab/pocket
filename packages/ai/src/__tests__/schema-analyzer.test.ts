import { describe, it, expect } from 'vitest';
import {
  SchemaAnalyzer,
  createSchemaAnalyzer,
  type AnalyzableCollection,
  type AnalyzableDatabase,
} from '../schema-analyzer.js';

function mockCollection(name: string, docs: Record<string, unknown>[]): AnalyzableCollection {
  return {
    name,
    find: async (opts?: { limit?: number }) => docs.slice(0, opts?.limit ?? docs.length),
    count: async () => docs.length,
  };
}

function mockDatabase(collections: Record<string, Record<string, unknown>[]>): AnalyzableDatabase {
  return {
    collectionNames: () => Object.keys(collections),
    collection: (name: string) => mockCollection(name, collections[name] ?? []),
  };
}

describe('SchemaAnalyzer', () => {
  const SAMPLE_TODOS = [
    { _id: '1', title: 'Buy milk', completed: false, priority: 3, createdAt: '2024-01-15T10:00:00Z' },
    { _id: '2', title: 'Walk dog', completed: true, priority: 1, createdAt: '2024-01-16T08:00:00Z' },
    { _id: '3', title: 'Read book', completed: false, priority: 2, createdAt: '2024-01-17T09:30:00Z' },
  ];

  it('should create via factory', () => {
    const analyzer = createSchemaAnalyzer();
    expect(analyzer).toBeInstanceOf(SchemaAnalyzer);
  });

  describe('analyzeCollection', () => {
    it('should infer field types from documents', async () => {
      const analyzer = new SchemaAnalyzer();
      const coll = mockCollection('todos', SAMPLE_TODOS);
      const analysis = await analyzer.analyzeCollection(coll);

      expect(analysis.name).toBe('todos');
      expect(analysis.totalDocuments).toBe(3);
      expect(analysis.sampledDocuments).toBe(3);

      const fieldNames = analysis.fieldStats.map((f) => f.name);
      expect(fieldNames).toContain('title');
      expect(fieldNames).toContain('completed');
      expect(fieldNames).toContain('priority');
    });

    it('should detect string fields', async () => {
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      const titleField = analysis.fieldStats.find((f) => f.name === 'title');
      expect(titleField?.type).toBe('string');
    });

    it('should detect boolean fields', async () => {
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      const completedField = analysis.fieldStats.find((f) => f.name === 'completed');
      expect(completedField?.type).toBe('boolean');
    });

    it('should detect number fields with min/max', async () => {
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      const prioField = analysis.fieldStats.find((f) => f.name === 'priority');
      expect(prioField?.type).toBe('number');
      expect(prioField?.min).toBe(1);
      expect(prioField?.max).toBe(3);
    });

    it('should detect date strings as date type', async () => {
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      const dateField = analysis.fieldStats.find((f) => f.name === 'createdAt');
      expect(dateField?.type).toBe('date');
    });

    it('should detect low-cardinality enums', async () => {
      const docs = [
        { status: 'active' }, { status: 'active' },
        { status: 'inactive' }, { status: 'pending' },
      ];
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', docs));
      const statusField = analysis.fieldStats.find((f) => f.name === 'status');
      expect(statusField?.detectedEnums).toContain('active');
      expect(statusField?.detectedEnums).toContain('inactive');
    });

    it('should mark high-presence fields as required', async () => {
      const analyzer = new SchemaAnalyzer();
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      const titleField = analysis.fieldStats.find((f) => f.name === 'title');
      expect(titleField?.likelyRequired).toBe(true);
    });
  });

  describe('analyzeDatabase', () => {
    it('should analyze all collections', async () => {
      const analyzer = new SchemaAnalyzer();
      const db = mockDatabase({
        todos: SAMPLE_TODOS,
        users: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      const result = await analyzer.analyzeDatabase(db);
      expect(result.totalCollections).toBe(2);
      expect(result.collections).toHaveLength(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('extractSchemas', () => {
    it('should return SmartQueryEngine-compatible schemas', async () => {
      const analyzer = new SchemaAnalyzer();
      const db = mockDatabase({ todos: SAMPLE_TODOS });
      const schemas = await analyzer.extractSchemas(db);
      expect(schemas).toHaveLength(1);
      expect(schemas[0]!.name).toBe('todos');
      expect(schemas[0]!.fields.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should respect sample size', async () => {
      const docs = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const analyzer = new SchemaAnalyzer({ sampleSize: 10 });
      const analysis = await analyzer.analyzeCollection(mockCollection('t', docs));
      expect(analysis.sampledDocuments).toBe(10);
    });

    it('should include sample documents when configured', async () => {
      const analyzer = new SchemaAnalyzer({ includeSamples: true, maxSampleDocs: 2 });
      const analysis = await analyzer.analyzeCollection(mockCollection('t', SAMPLE_TODOS));
      expect(analysis.schema.sampleDocuments).toHaveLength(2);
    });
  });
});

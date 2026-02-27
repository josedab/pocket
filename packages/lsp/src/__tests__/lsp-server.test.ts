import { describe, expect, it } from 'vitest';
import { createSchemaSymbolTable } from '../index.js';
import type { ParsedPocketConfig } from '../lsp-server.js';

const sampleConfig: ParsedPocketConfig = {
  database: { name: 'test-app' },
  collections: [
    {
      name: 'users',
      fields: [
        { name: 'name', type: 'string', required: true, description: 'User display name' },
        { name: 'email', type: 'string', required: true },
        { name: 'age', type: 'number' },
      ],
    },
    {
      name: 'posts',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'body', type: 'string' },
        { name: 'authorId', type: 'string', required: true },
      ],
    },
  ],
};

describe('SchemaSymbolTable', () => {
  it('should load config and list collections', () => {
    const st = createSchemaSymbolTable();
    st.load(sampleConfig);
    expect(st.getCollectionNames()).toEqual(['users', 'posts']);
  });

  describe('completions', () => {
    it('should complete collection names', () => {
      const st = createSchemaSymbolTable();
      st.load(sampleConfig);
      const items = st.getCompletions({ type: 'collection-name' });
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.label)).toContain('users');
      expect(items[0]!.kind).toBe('collection');
    });

    it('should complete field names for a collection', () => {
      const st = createSchemaSymbolTable();
      st.load(sampleConfig);
      const items = st.getCompletions({ type: 'field-name', collection: 'users' });
      expect(items).toHaveLength(3);
      expect(items.map((i) => i.label)).toContain('email');
    });

    it('should complete query operators', () => {
      const st = createSchemaSymbolTable();
      const items = st.getCompletions({ type: 'operator' });
      expect(items.length).toBeGreaterThanOrEqual(8);
      expect(items.map((i) => i.label)).toContain('eq');
      expect(items.map((i) => i.label)).toContain('contains');
    });

    it('should complete collection methods', () => {
      const st = createSchemaSymbolTable();
      const items = st.getCompletions({ type: 'method' });
      expect(items.map((i) => i.label)).toContain('find');
      expect(items.map((i) => i.label)).toContain('insert');
      expect(items.map((i) => i.label)).toContain('find$');
    });

    it('should complete field types', () => {
      const st = createSchemaSymbolTable();
      const items = st.getCompletions({ type: 'field-type' });
      expect(items.map((i) => i.label)).toContain('string');
      expect(items.map((i) => i.label)).toContain('number');
    });

    it('should return empty for unknown collection', () => {
      const st = createSchemaSymbolTable();
      st.load(sampleConfig);
      const items = st.getCompletions({ type: 'field-name', collection: 'nonexistent' });
      expect(items).toHaveLength(0);
    });
  });

  describe('hover', () => {
    it('should return hover for collection name', () => {
      const st = createSchemaSymbolTable();
      st.load(sampleConfig);
      const hover = st.getHover('users');
      expect(hover).not.toBeNull();
      expect(hover!.content).toContain('Collection: users');
      expect(hover!.content).toContain('name');
    });

    it('should return hover for field name', () => {
      const st = createSchemaSymbolTable();
      st.load(sampleConfig);
      const hover = st.getHover('email');
      expect(hover).not.toBeNull();
      expect(hover!.content).toContain('string');
    });

    it('should return hover for operator', () => {
      const st = createSchemaSymbolTable();
      const hover = st.getHover('contains');
      expect(hover).not.toBeNull();
      expect(hover!.content).toContain('Operator: contains');
    });

    it('should return null for unknown symbol', () => {
      const st = createSchemaSymbolTable();
      expect(st.getHover('xyz_unknown')).toBeNull();
    });
  });

  describe('diagnostics', () => {
    it('should pass valid config', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate(sampleConfig);
      expect(diags.filter((d) => d.severity === 'error')).toHaveLength(0);
    });

    it('should detect missing database name', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate({ database: { name: '' }, collections: [] });
      // Empty name passes; no name fails
      const diags2 = st.validate({ database: {} as { name: string }, collections: [] });
      expect(diags2.some((d) => d.message.includes('database.name'))).toBe(true);
    });

    it('should detect duplicate collection names', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate({
        database: { name: 'test' },
        collections: [
          { name: 'todos', fields: [{ name: 'title', type: 'string' }] },
          { name: 'todos', fields: [{ name: 'name', type: 'string' }] },
        ],
      });
      expect(diags.some((d) => d.message.includes('Duplicate collection'))).toBe(true);
    });

    it('should warn on empty collections', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate({
        database: { name: 'test' },
        collections: [{ name: 'empty', fields: [] }],
      });
      expect(diags.some((d) => d.severity === 'warning' && d.message.includes('no fields'))).toBe(
        true
      );
    });

    it('should detect duplicate field names', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate({
        database: { name: 'test' },
        collections: [
          {
            name: 'items',
            fields: [
              { name: 'title', type: 'string' },
              { name: 'title', type: 'number' },
            ],
          },
        ],
      });
      expect(diags.some((d) => d.message.includes('Duplicate field'))).toBe(true);
    });

    it('should warn on reserved field prefix', () => {
      const st = createSchemaSymbolTable();
      const diags = st.validate({
        database: { name: 'test' },
        collections: [
          {
            name: 'items',
            fields: [{ name: '_secret', type: 'string' }],
          },
        ],
      });
      expect(diags.some((d) => d.message.includes('reserved prefix'))).toBe(true);
    });
  });
});

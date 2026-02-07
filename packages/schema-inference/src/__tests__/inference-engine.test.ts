import { describe, it, expect } from 'vitest';
import { createInferenceEngine, generateSchema, detectSemanticType } from '../index.js';

describe('InferenceEngine', () => {
  it('should infer basic types from documents', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
      { name: 'Charlie', age: 35, active: true },
    ]);

    expect(schema.totalDocumentsAnalyzed).toBe(3);
    expect(schema.fields.get('name')?.type).toBe('string');
    expect(schema.fields.get('age')?.type).toBe('number');
    expect(schema.fields.get('active')?.type).toBe('boolean');
  });

  it('should detect required vs optional fields', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { name: 'Alice', age: 30 },
      { name: 'Bob' },
      { name: 'Charlie', age: 35 },
    ]);

    expect(schema.fields.get('name')?.required).toBe(true);
    expect(schema.fields.get('age')?.required).toBe(false);
  });

  it('should detect nullable fields', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { name: 'Alice', bio: null },
      { name: 'Bob', bio: 'Hello' },
    ]);

    expect(schema.fields.get('bio')?.nullable).toBe(true);
    expect(schema.fields.get('name')?.nullable).toBe(false);
  });

  it('should detect email semantic type', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { email: 'alice@example.com' },
      { email: 'bob@test.org' },
    ]);

    expect(schema.fields.get('email')?.semanticType).toBe('email');
  });

  it('should detect UUID semantic type', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
    ]);

    expect(schema.fields.get('id')?.semanticType).toBe('uuid');
  });

  it('should detect enum candidates', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { status: 'active' },
      { status: 'inactive' },
      { status: 'active' },
      { status: 'pending' },
    ]);

    const field = schema.fields.get('status');
    expect(field?.enumValues).toBeDefined();
    expect(field?.enumValues).toContain('active');
    expect(field?.enumValues).toContain('inactive');
    expect(field?.enumValues).toContain('pending');
  });

  it('should handle nested objects', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { user: { name: 'Alice', age: 30 } },
      { user: { name: 'Bob', age: 25 } },
    ]);

    const userField = schema.fields.get('user');
    expect(userField?.type).toBe('object');
    expect(userField?.properties?.get('name')?.type).toBe('string');
    expect(userField?.properties?.get('age')?.type).toBe('number');
  });

  it('should handle arrays', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { tags: ['a', 'b'] },
      { tags: ['c'] },
    ]);

    const tagsField = schema.fields.get('tags');
    expect(tagsField?.type).toBe('array');
    expect(tagsField?.items).toBeDefined();
  });

  it('should return empty schema for empty input', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([]);

    expect(schema.totalDocumentsAnalyzed).toBe(0);
    expect(schema.fields.size).toBe(0);
  });

  it('should generate recommendations', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { email: 'alice@example.com', status: 'active' },
      { email: 'bob@test.org', status: 'active' },
      { email: 'charlie@demo.com', status: 'inactive' },
    ]);

    expect(schema.recommendations.length).toBeGreaterThan(0);
  });

  it('should merge schemas incrementally', () => {
    const engine = createInferenceEngine();
    const schema1 = engine.analyze([
      { name: 'Alice', age: 30 },
    ]);
    const schema2 = engine.merge(schema1, [
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    expect(schema2.totalDocumentsAnalyzed).toBe(2);
    expect(schema2.fields.has('name')).toBe(true);
    expect(schema2.fields.has('age')).toBe(true);
    expect(schema2.fields.has('email')).toBe(true);
  });

  it('should respect maxSampleSize config', () => {
    const engine = createInferenceEngine({ maxSampleSize: 5 });
    const docs = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User ${i}` }));
    const schema = engine.analyze(docs);

    expect(schema.totalDocumentsAnalyzed).toBe(5);
  });
});

describe('detectSemanticType', () => {
  it('should detect email', () => {
    expect(detectSemanticType('test@example.com')).toBe('email');
  });

  it('should detect URL', () => {
    expect(detectSemanticType('https://example.com/path')).toBe('url');
  });

  it('should detect UUID', () => {
    expect(detectSemanticType('550e8400-e29b-41d4-a716-446655440000')).toBe('uuid');
  });

  it('should detect ISO date', () => {
    expect(detectSemanticType('2024-01-15T10:30:00Z')).toBe('iso-date');
  });

  it('should detect hex color', () => {
    expect(detectSemanticType('#ff0000')).toBe('hex-color');
  });

  it('should return none for plain strings', () => {
    expect(detectSemanticType('hello world')).toBe('none');
  });
});

describe('generateSchema', () => {
  it('should generate TypeScript interface', () => {
    const engine = createInferenceEngine({ enumThreshold: 3 });
    const schema = engine.analyze([
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
      { name: 'Charlie', age: 35, active: true },
      { name: 'Diana', age: 28, active: false },
    ]);
    const result = generateSchema(schema, 'User', 'typescript');

    expect(result.format).toBe('typescript');
    expect(result.code).toContain('export interface User');
    expect(result.code).toContain('name');
    expect(result.code).toContain('age');
    expect(result.code).toContain('string');
    expect(result.code).toContain('number');
  });

  it('should generate Zod schema', () => {
    const engine = createInferenceEngine({ enumThreshold: 3 });
    const schema = engine.analyze([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@test.org' },
      { name: 'Charlie', email: 'charlie@demo.com' },
      { name: 'Diana', email: 'diana@sample.net' },
    ]);
    const result = generateSchema(schema, 'User', 'zod');

    expect(result.format).toBe('zod');
    expect(result.code).toContain("import { z } from 'zod'");
    expect(result.code).toContain('UserSchema');
    expect(result.code).toContain('.email()');
  });

  it('should generate JSON Schema', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { name: 'Alice', age: 30 },
    ]);
    const result = generateSchema(schema, 'User', 'json-schema');

    expect(result.format).toBe('json-schema');
    const parsed = JSON.parse(result.code);
    expect(parsed.title).toBe('User');
    expect(parsed.properties.name).toBeDefined();
    expect(parsed.properties.age).toBeDefined();
  });

  it('should generate Pocket schema definition', () => {
    const engine = createInferenceEngine();
    const schema = engine.analyze([
      { name: 'Alice', age: 30 },
    ]);
    const result = generateSchema(schema, 'user', 'pocket-schema');

    expect(result.format).toBe('pocket-schema');
    expect(result.code).toContain('userSchema');
    expect(result.code).toContain("type: 'string'");
    expect(result.code).toContain("type: 'number'");
  });
});

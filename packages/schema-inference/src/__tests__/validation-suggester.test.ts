import { describe, it, expect } from 'vitest';
import {
  createValidationSuggester,
  ValidationSuggester,
} from '../validation-suggester.js';
import { createInferenceEngine } from '../inference-engine.js';
import type { InferredSchema } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const engine = createInferenceEngine();

function schemaFrom(docs: Record<string, unknown>[]): InferredSchema {
  return engine.analyze(docs);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ValidationSuggester', () => {
  describe('createValidationSuggester', () => {
    it('returns a ValidationSuggester instance', () => {
      const suggester = createValidationSuggester();
      expect(suggester).toBeInstanceOf(ValidationSuggester);
    });

    it('accepts partial config', () => {
      const suggester = createValidationSuggester({ minConfidence: 0.8 });
      expect(suggester).toBeInstanceOf(ValidationSuggester);
    });
  });

  describe('suggest', () => {
    it('detects min/max ranges for numbers', () => {
      const docs = [
        { score: 10 },
        { score: 20 },
        { score: 30 },
        { score: 40 },
        { score: 50 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const minRule = result.suggestions.find(
        s => s.fieldPath === 'score' && s.rule === 'min',
      );
      const maxRule = result.suggestions.find(
        s => s.fieldPath === 'score' && s.rule === 'max',
      );

      expect(minRule).toBeDefined();
      expect(minRule!.value).toBe(10);
      expect(maxRule).toBeDefined();
      expect(maxRule!.value).toBe(50);
    });

    it('detects string length constraints', () => {
      const docs = [
        { code: 'AB' },
        { code: 'CDE' },
        { code: 'FGHI' },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const minLen = result.suggestions.find(
        s => s.fieldPath === 'code' && s.rule === 'min-length',
      );
      const maxLen = result.suggestions.find(
        s => s.fieldPath === 'code' && s.rule === 'max-length',
      );

      expect(minLen).toBeDefined();
      expect(minLen!.value).toBe(2);
      expect(maxLen).toBeDefined();
      expect(maxLen!.value).toBe(4);
    });

    it('detects enum values for limited distinct values', () => {
      const docs = [
        { status: 'active' },
        { status: 'inactive' },
        { status: 'pending' },
        { status: 'active' },
        { status: 'inactive' },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const enumRule = result.suggestions.find(
        s => s.fieldPath === 'status' && s.rule === 'enum',
      );

      expect(enumRule).toBeDefined();
      expect(enumRule!.value).toContain('active');
      expect(enumRule!.value).toContain('inactive');
      expect(enumRule!.value).toContain('pending');
    });

    it('detects required fields', () => {
      const docs = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const required = result.suggestions.find(
        s => s.fieldPath === 'name' && s.rule === 'required',
      );
      expect(required).toBeDefined();
    });

    it('detects optional fields', () => {
      const docs = [
        { name: 'Alice', bio: 'Hello' },
        { name: 'Bob', bio: 'World' },
        { name: 'Charlie' },
        { name: 'Dave', bio: 'Hi' },
        { name: 'Eve', bio: 'Hey' },
      ];
      const schema = schemaFrom(docs);
      // optional confidence = 1 - presenceRatio = 0.2, so lower threshold
      const suggester = createValidationSuggester({ minConfidence: 0.1 });
      const result = suggester.suggest(schema, docs);

      const optional = result.suggestions.find(
        s => s.fieldPath === 'bio' && s.rule === 'optional',
      );
      expect(optional).toBeDefined();
    });

    it('provides confidence scores for all suggestions', () => {
      const docs = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      for (const suggestion of result.suggestions) {
        expect(suggestion.confidence).toBeDefined();
        expect(suggestion.confidence.value).toBeGreaterThanOrEqual(0);
        expect(suggestion.confidence.value).toBeLessThanOrEqual(1);
        expect(suggestion.confidence.sampleCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('detects integer constraint for whole numbers', () => {
      const docs = [
        { count: 1 },
        { count: 2 },
        { count: 3 },
        { count: 4 },
        { count: 5 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const intRule = result.suggestions.find(
        s => s.fieldPath === 'count' && s.rule === 'integer',
      );
      expect(intRule).toBeDefined();
    });

    it('detects positive constraint for positive numbers', () => {
      const docs = [
        { price: 10 },
        { price: 20 },
        { price: 30 },
        { price: 40 },
        { price: 50 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const positiveRule = result.suggestions.find(
        s => s.fieldPath === 'price' && s.rule === 'positive',
      );
      expect(positiveRule).toBeDefined();
    });

    it('detects non-negative constraint when zero is included', () => {
      const docs = [
        { balance: 0 },
        { balance: 10 },
        { balance: 20 },
        { balance: 30 },
        { balance: 40 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const nonNegRule = result.suggestions.find(
        s => s.fieldPath === 'balance' && s.rule === 'non-negative',
      );
      expect(nonNegRule).toBeDefined();
    });

    it('detects nullable fields', () => {
      const docs = [
        { name: 'Alice', nickname: null },
        { name: 'Bob', nickname: 'Bobby' },
        { name: 'Charlie', nickname: null },
        { name: 'Dave', nickname: 'D' },
        { name: 'Eve', nickname: null },
        { name: 'Frank', nickname: 'Franky' },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      const nullable = result.suggestions.find(
        s => s.fieldPath === 'nickname' && s.rule === 'nullable',
      );
      expect(nullable).toBeDefined();
    });
  });

  describe('suggestFromSchema', () => {
    it('suggests required from schema only', () => {
      const schema = schemaFrom([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      const suggester = createValidationSuggester();
      const suggestions = suggester.suggestFromSchema(schema);

      const required = suggestions.find(
        s => s.fieldPath === 'name' && s.rule === 'required',
      );
      expect(required).toBeDefined();
    });

    it('suggests nullable from schema only', () => {
      const schema = schemaFrom([
        { name: 'Alice', bio: null },
        { name: 'Bob', bio: 'Hi' },
      ]);
      const suggester = createValidationSuggester();
      const suggestions = suggester.suggestFromSchema(schema);

      const nullable = suggestions.find(
        s => s.fieldPath === 'bio' && s.rule === 'nullable',
      );
      expect(nullable).toBeDefined();
    });

    it('suggests semantic types from schema (email)', () => {
      const schema = schemaFrom([
        { email: 'alice@example.com' },
        { email: 'bob@test.org' },
      ]);
      const suggester = createValidationSuggester();
      const suggestions = suggester.suggestFromSchema(schema);

      const emailRule = suggestions.find(
        s => s.fieldPath === 'email' && s.rule === 'email',
      );
      expect(emailRule).toBeDefined();
    });

    it('suggests enum values from schema when available', () => {
      const schema = schemaFrom([
        { status: 'active' },
        { status: 'inactive' },
        { status: 'pending' },
        { status: 'active' },
      ]);
      const suggester = createValidationSuggester();
      const suggestions = suggester.suggestFromSchema(schema);

      const enumRule = suggestions.find(
        s => s.fieldPath === 'status' && s.rule === 'enum',
      );
      // May or may not exist depending on whether enumValues is populated
      // in the schema; this checks the path works
      if (schema.fields.get('status')?.enumValues?.length) {
        expect(enumRule).toBeDefined();
      }
    });
  });

  describe('Zod code generation', () => {
    it('generates Zod validation code', () => {
      const docs = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.zodCode).toContain("import { z } from 'zod'");
      expect(result.zodCode).toContain('z.object({');
      expect(result.zodCode).toContain('name:');
      expect(result.zodCode).toContain('age:');
    });

    it('generates z.string() for string fields', () => {
      const docs = [
        { label: 'alpha' },
        { label: 'beta' },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.zodCode).toContain('z.string()');
    });

    it('generates z.number() for number fields', () => {
      // Use enough distinct values to avoid enum detection
      const docs = Array.from({ length: 20 }, (_, i) => ({
        value: i * 1.1,
      }));
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.zodCode).toContain('z.number()');
    });

    it('generates z.boolean() for boolean fields', () => {
      const docs = [
        { active: true },
        { active: false },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.zodCode).toContain('z.boolean()');
    });

    it('generates z.enum for enum fields', () => {
      const docs = [
        { role: 'admin' },
        { role: 'user' },
        { role: 'admin' },
        { role: 'guest' },
        { role: 'user' },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.zodCode).toContain('z.enum(');
    });
  });

  describe('edge cases', () => {
    it('handles empty documents array', () => {
      const schema = schemaFrom([{ name: 'placeholder' }]);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, []);

      // Should not crash, suggestions may be minimal
      expect(result.suggestions).toBeDefined();
      expect(result.zodCode).toBeDefined();
    });

    it('handles all null values', () => {
      const docs = [
        { value: null },
        { value: null },
        { value: null },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.suggestions).toBeDefined();
    });

    it('handles mixed types gracefully', () => {
      const docs = [
        { data: 'hello' },
        { data: 42 },
        { data: true },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, docs);

      expect(result.suggestions).toBeDefined();
      expect(result.zodCode).toBeDefined();
    });

    it('filters suggestions below minConfidence', () => {
      const docs = [
        { score: 10 },
        { score: 20 },
        { score: 30 },
        { score: 40 },
        { score: 50 },
      ];
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester({ minConfidence: 0.99 });
      const result = suggester.suggest(schema, docs);

      for (const s of result.suggestions) {
        expect(s.confidence.value).toBeGreaterThanOrEqual(0.99);
      }
    });

    it('does not suggest enum for too many distinct values', () => {
      const docs = Array.from({ length: 20 }, (_, i) => ({
        code: `code_${i}`,
      }));
      const schema = schemaFrom(docs);
      const suggester = createValidationSuggester({ enumMaxValues: 5 });
      const result = suggester.suggest(schema, docs);

      const enumRule = result.suggestions.find(
        s => s.fieldPath === 'code' && s.rule === 'enum',
      );
      expect(enumRule).toBeUndefined();
    });

    it('handles schema with no fields', () => {
      const schema = schemaFrom([]);
      const suggester = createValidationSuggester();
      const result = suggester.suggest(schema, []);

      expect(result.suggestions.length).toBe(0);
    });
  });
});

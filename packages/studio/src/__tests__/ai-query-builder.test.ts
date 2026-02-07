import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  AIQueryBuilder,
  createAIQueryBuilder,
  type AIQueryFieldInfo,
} from '../ai-query-builder.js';

describe('AIQueryBuilder', () => {
  let builder: AIQueryBuilder;

  const userFields: AIQueryFieldInfo[] = [
    { name: 'name', type: 'string' },
    { name: 'age', type: 'number', indexed: true },
    { name: 'role', type: 'string' },
  ];

  beforeEach(() => {
    builder = createAIQueryBuilder({ maxHistory: 50 });
    builder.registerSchema('users', userFields);
  });

  afterEach(() => {
    builder.destroy();
  });

  describe('createAIQueryBuilder', () => {
    it('should return an AIQueryBuilder instance', () => {
      const b = createAIQueryBuilder();
      expect(b).toBeInstanceOf(AIQueryBuilder);
      b.destroy();
    });

    it('should accept optional config', () => {
      const b = createAIQueryBuilder({ maxHistory: 10, defaultCollection: 'items' });
      expect(b).toBeInstanceOf(AIQueryBuilder);
      b.destroy();
    });
  });

  describe('registerSchema', () => {
    it('should register fields for a collection', () => {
      const collections = builder.getRegisteredCollections();
      expect(collections).toContain('users');
    });

    it('should allow registering multiple collections', () => {
      builder.registerSchema('posts', [
        { name: 'title', type: 'string' },
      ]);
      const collections = builder.getRegisteredCollections();
      expect(collections).toContain('users');
      expect(collections).toContain('posts');
    });

    it('should overwrite schema when registering same collection', () => {
      builder.registerSchema('users', [{ name: 'email', type: 'string' }]);
      const suggestions = builder.getAutoComplete('users', 'em');
      expect(suggestions.some((s) => s.text === 'email')).toBe(true);
      expect(suggestions.some((s) => s.text === 'name')).toBe(false);
    });
  });

  describe('parseNaturalLanguage', () => {
    it('should parse a simple greater-than query', () => {
      const parsed = builder.parseNaturalLanguage('find users where age greater than 25');
      expect(parsed.collection).toBe('users');
      expect(parsed.filter).toEqual({ age: { $gt: 25 } });
      expect(parsed.confidence).toBeGreaterThan(0);
      expect(parsed.explanation).toContain('users');
    });

    it('should parse equality with "equals"', () => {
      const parsed = builder.parseNaturalLanguage('find users where name equals John');
      expect(parsed.collection).toBe('users');
      expect(parsed.filter).toEqual({ name: 'John' });
    });

    it('should parse equality with "is"', () => {
      const parsed = builder.parseNaturalLanguage('find users where role is admin');
      expect(parsed.collection).toBe('users');
      expect(parsed.filter).toEqual({ role: 'admin' });
    });

    it('should parse less-than query', () => {
      const parsed = builder.parseNaturalLanguage('find users where age less than 18');
      expect(parsed.filter).toEqual({ age: { $lt: 18 } });
    });

    it('should detect sort', () => {
      const parsed = builder.parseNaturalLanguage('find users sorted by age descending');
      expect(parsed.sort).toEqual({ age: 'desc' });
    });

    it('should detect limit', () => {
      const parsed = builder.parseNaturalLanguage('find users limit 10');
      expect(parsed.limit).toBe(10);
    });

    it('should include a performance estimate', () => {
      const parsed = builder.parseNaturalLanguage('find users where age greater than 25');
      expect(parsed.performanceEstimate).toBeDefined();
      expect(parsed.performanceEstimate.strategy).toBeDefined();
      expect(parsed.performanceEstimate.estimatedCost).toBeDefined();
    });

    it('should include a label', () => {
      const parsed = builder.parseNaturalLanguage('find users where age greater than 30');
      expect(parsed.label).toBeTruthy();
    });

    it('should add entry to history', async () => {
      builder.parseNaturalLanguage('find users where age greater than 25');
      const history = await firstValueFrom(builder.getHistory().pipe(take(1)));
      expect(history).toHaveLength(1);
      expect(history[0]!.collection).toBe('users');
    });
  });

  describe('explainFilter', () => {
    it('should generate human-readable explanation for $gt', () => {
      const explanation = builder.explainFilter('users', { age: { $gt: 30 } });
      expect(explanation).toContain('users');
      expect(explanation).toContain('age');
      expect(explanation).toContain('greater than');
    });

    it('should generate explanation for equality', () => {
      const explanation = builder.explainFilter('users', { name: 'Alice' });
      expect(explanation).toContain('name');
      expect(explanation).toContain('equals');
    });

    it('should generate explanation for empty filter', () => {
      const explanation = builder.explainFilter('users', {});
      expect(explanation).toContain('users');
    });
  });

  describe('getAutoComplete', () => {
    it('should return field suggestions matching prefix', () => {
      const suggestions = builder.getAutoComplete('users', 'na');
      expect(suggestions.some((s) => s.text === 'name' && s.type === 'field')).toBe(true);
    });

    it('should return operator suggestions matching prefix', () => {
      const suggestions = builder.getAutoComplete('users', '$g');
      expect(suggestions.some((s) => s.text === '$gt' && s.type === 'operator')).toBe(true);
      expect(suggestions.some((s) => s.text === '$gte' && s.type === 'operator')).toBe(true);
    });

    it('should return empty array for non-matching prefix', () => {
      const suggestions = builder.getAutoComplete('users', 'zzz');
      expect(suggestions).toEqual([]);
    });

    it('should include indexed annotation in description', () => {
      const suggestions = builder.getAutoComplete('users', 'ag');
      const ageSuggestion = suggestions.find((s) => s.text === 'age');
      expect(ageSuggestion).toBeDefined();
      expect(ageSuggestion!.description).toContain('indexed');
    });
  });

  describe('estimateQueryPerformance', () => {
    it('should return estimate with complexity fields', () => {
      const estimate = builder.estimateQueryPerformance('users', { age: { $gt: 25 } });
      expect(estimate.strategy).toBeDefined();
      expect(estimate.indexCoverage).toBeDefined();
      expect(estimate.estimatedCost).toBeDefined();
      expect(estimate.suggestions).toBeDefined();
    });

    it('should detect index coverage for indexed field', () => {
      const estimate = builder.estimateQueryPerformance('users', { age: { $gt: 25 } });
      expect(estimate.indexCoverage).toBe(true);
      expect(estimate.strategy).toBe('index-scan');
    });

    it('should detect full-scan for non-indexed field', () => {
      const estimate = builder.estimateQueryPerformance('users', { name: 'Alice' });
      expect(estimate.indexCoverage).toBe(false);
      expect(estimate.strategy).toBe('full-scan');
    });

    it('should detect full-scan for empty filter', () => {
      const estimate = builder.estimateQueryPerformance('users', {});
      expect(estimate.strategy).toBe('full-scan');
      expect(estimate.estimatedCost).toBe('high');
    });

    it('should detect key-lookup for _id filter', () => {
      const estimate = builder.estimateQueryPerformance('users', { _id: 'abc' });
      expect(estimate.strategy).toBe('key-lookup');
      expect(estimate.estimatedCost).toBe('low');
    });
  });

  describe('getHistory', () => {
    it('should track query history via observable', async () => {
      builder.parseNaturalLanguage('find users where age greater than 20');
      builder.parseNaturalLanguage('find users where name equals Alice');

      const history = await firstValueFrom(builder.getHistory().pipe(take(1)));
      expect(history).toHaveLength(2);
      // Most recent first
      expect(history[0]!.naturalLanguage).toBe('find users where name equals Alice');
    });

    it('should respect maxHistory config', async () => {
      const b = createAIQueryBuilder({ maxHistory: 2 });
      b.registerSchema('users', userFields);

      b.parseNaturalLanguage('find users where age greater than 10');
      b.parseNaturalLanguage('find users where age greater than 20');
      b.parseNaturalLanguage('find users where age greater than 30');

      const history = await firstValueFrom(b.getHistory().pipe(take(1)));
      expect(history).toHaveLength(2);
      b.destroy();
    });

    it('should clear history', () => {
      builder.parseNaturalLanguage('find users where age greater than 20');
      builder.clearHistory();
      expect(builder.getHistorySnapshot()).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('should complete streams on destroy', async () => {
      let completed = false;
      builder.getHistory().subscribe({ complete: () => { completed = true; } });
      builder.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle unknown collection gracefully', () => {
      const parsed = builder.parseNaturalLanguage('find orders where total greater than 100');
      // Falls back to first registered or 'unknown'
      expect(parsed.collection).toBeDefined();
      expect(parsed.filter).toBeDefined();
    });

    it('should throw for empty input', () => {
      expect(() => builder.parseNaturalLanguage('')).toThrow('Query input must not be empty');
    });

    it('should throw for whitespace-only input', () => {
      expect(() => builder.parseNaturalLanguage('   ')).toThrow('Query input must not be empty');
    });

    it('should handle input with no matching fields', () => {
      const parsed = builder.parseNaturalLanguage('show me everything from users');
      expect(parsed.collection).toBe('users');
      expect(parsed.filter).toEqual({});
    });
  });
});

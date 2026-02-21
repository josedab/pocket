import { describe, it, expect } from 'vitest';
import {
  QueryExplainer,
  createQueryExplainer,
  type QueryInput,
} from '../query-explainer.js';

const SCHEMAS = [
  {
    name: 'todos',
    fields: [
      { name: 'title', type: 'string' as const },
      { name: 'completed', type: 'boolean' as const },
      { name: 'priority', type: 'number' as const },
      { name: 'createdAt', type: 'date' as const },
    ],
  },
];

describe('QueryExplainer', () => {
  let explainer: QueryExplainer;

  beforeEach(() => {
    explainer = createQueryExplainer({ schemas: SCHEMAS });
  });

  describe('explain', () => {
    it('should produce a summary for a simple query', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false },
        limit: 10,
      });
      expect(result.summary).toContain('todos');
      expect(result.summary).toContain('10');
      expect(result.level).toBe('detailed');
    });

    it('should produce steps', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false },
        sort: { createdAt: 'desc' },
      });
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.steps[0]).toContain('todos');
    });

    it('should handle queries with no filter', () => {
      const result = explainer.explain({ collection: 'todos' });
      expect(result.summary).toContain('all documents');
      expect(result.cost.costScore).toBeGreaterThan(50); // full scan = expensive
    });

    it('should handle limit=1 queries', () => {
      const result = explainer.explain({ collection: 'todos', filter: { _id: '1' }, limit: 1 });
      expect(result.summary).toContain('one document');
    });

    it('should describe sort direction', () => {
      const result = explainer.explain({
        collection: 'todos',
        sort: { createdAt: 'desc' },
      });
      expect(result.summary).toContain('descending');
    });

    it('should describe skip', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: true },
        skip: 20,
      });
      expect(result.summary).toContain('20');
    });
  });

  describe('cost estimation', () => {
    it('should rate filtered queries cheaper than full scans', () => {
      const filtered = explainer.explain({ collection: 'todos', filter: { completed: false } });
      const fullScan = explainer.explain({ collection: 'todos' });
      expect(filtered.cost.costScore).toBeLessThan(fullScan.cost.costScore);
    });

    it('should detect index usage for single-field filters', () => {
      const result = explainer.explain({ collection: 'todos', filter: { completed: false } });
      expect(result.cost.usesIndex).toBe(true);
    });

    it('should classify time category', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false },
        limit: 10,
      });
      expect(['instant', 'fast', 'moderate', 'slow']).toContain(result.cost.timeCategory);
    });
  });

  describe('optimization suggestions', () => {
    it('should suggest adding limit for unlimited queries', () => {
      const result = explainer.explain({ collection: 'todos', filter: { completed: false } });
      expect(result.suggestions.some((s) => s.type === 'add-limit')).toBe(true);
    });

    it('should suggest index for non-indexed filters', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false, priority: { $gte: 3 } },
      });
      expect(result.suggestions.some((s) => s.type === 'add-index')).toBe(true);
    });

    it('should suggest projection when not used', () => {
      const result = explainer.explain({ collection: 'todos', filter: { completed: false } });
      expect(result.suggestions.some((s) => s.type === 'use-projection')).toBe(true);
    });

    it('should suggest narrowing filter when sorting without filter', () => {
      const result = explainer.explain({
        collection: 'todos',
        sort: { createdAt: 'desc' },
      });
      expect(result.suggestions.some((s) => s.type === 'narrow-filter')).toBe(true);
    });
  });

  describe('index recommendations', () => {
    it('should recommend single-field index', () => {
      const result = explainer.explain({ collection: 'todos', filter: { completed: false } });
      const singleRec = result.indexRecommendations.find((r) => r.type === 'single');
      expect(singleRec).toBeDefined();
      expect(singleRec!.fields).toContain('completed');
    });

    it('should recommend compound index for multi-field filter', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false, priority: { $gte: 3 } },
      });
      const compoundRec = result.indexRecommendations.find((r) => r.type === 'compound');
      expect(compoundRec).toBeDefined();
    });

    it('should recommend covering index for filter+sort', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false },
        sort: { createdAt: 'desc' },
      });
      const coveringRec = result.indexRecommendations.find(
        (r) => r.type === 'compound' && r.fields.includes('createdAt'),
      );
      expect(coveringRec).toBeDefined();
    });
  });

  describe('explainGenerated', () => {
    it('should accept GeneratedQuery format', () => {
      const result = explainer.explainGenerated({
        collection: 'todos',
        filter: { completed: false },
        sort: { createdAt: 'desc' },
        limit: 10,
        explanation: 'test',
        confidence: 0.9,
        naturalLanguage: 'show incomplete todos',
      });
      expect(result.summary).toBeTruthy();
      expect(result.cost).toBeDefined();
    });
  });

  describe('filter descriptions', () => {
    it('should describe comparison operators', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { priority: { $gte: 3 } },
      });
      expect(result.summary).toContain('at least');
    });

    it('should describe equality filters', () => {
      const result = explainer.explain({
        collection: 'todos',
        filter: { completed: false },
      });
      expect(result.summary).toContain('equals');
    });
  });
});

import { beforeEach } from 'vitest';

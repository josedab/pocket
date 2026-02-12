import { describe, it, expect, beforeEach } from 'vitest';
import { AIAssistant, createAIAssistant } from '../commands/ai-assistant.js';
import type { PocketConfig } from '../config/types.js';

const testConfig: PocketConfig = {
  database: { name: 'test-app' },
  collections: {
    users: {
      schema: {
        properties: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
          age: { type: 'number' },
          isAdmin: { type: 'boolean', default: false },
          teamId: { type: 'string' },
        },
      },
      indexes: [{ fields: ['email'], unique: true }],
      sync: true,
    },
    posts: {
      schema: {
        properties: {
          title: { type: 'string', required: true },
          body: { type: 'string' },
          authorId: { type: 'string', ref: 'users' },
          tags: { type: 'array' },
          publishedAt: { type: 'date' },
        },
      },
    },
    comments: {
      schema: {
        properties: {
          postId: { type: 'string', ref: 'posts' },
          userId: { type: 'string', ref: 'users' },
          text: { type: 'string', required: true },
        },
      },
    },
  },
};

describe('AIAssistant', () => {
  let assistant: AIAssistant;

  beforeEach(() => {
    assistant = createAIAssistant();
  });

  describe('analyzeSchema', () => {
    it('should analyze all collections', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      expect(analyses).toHaveLength(3);
      expect(analyses.map((a) => a.collectionName)).toEqual(['users', 'posts', 'comments']);
    });

    it('should count fields correctly', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      const users = analyses.find((a) => a.collectionName === 'users');
      expect(users?.fieldCount).toBe(5);
    });

    it('should detect field issues', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      const users = analyses.find((a) => a.collectionName === 'users');
      // age has no default and is optional
      const ageField = users?.fields.find((f) => f.name === 'age');
      expect(ageField?.issues.length).toBeGreaterThan(0);
    });

    it('should detect relationships via refs', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      const posts = analyses.find((a) => a.collectionName === 'posts');
      const authorRel = posts?.relationships.find((r) => r.field === 'authorId');
      expect(authorRel?.to).toBe('users');
      expect(authorRel?.type).toBe('one-to-one');
    });

    it('should detect relationships via naming convention', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      const users = analyses.find((a) => a.collectionName === 'users');
      const teamRel = users?.relationships.find((r) => r.field === 'teamId');
      expect(teamRel?.to).toBe('team');
      expect(teamRel?.reason).toContain('Naming convention');
    });

    it('should estimate document size', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      for (const analysis of analyses) {
        expect(analysis.estimatedDocSize).toBeGreaterThan(0);
      }
    });

    it('should generate collection-level suggestions', () => {
      const analyses = assistant.analyzeSchema(testConfig);
      const posts = analyses.find((a) => a.collectionName === 'posts');
      // posts has no indexes and no sync config
      expect(posts?.suggestions.some((s) => s.includes('index'))).toBe(true);
      expect(posts?.suggestions.some((s) => s.includes('Sync'))).toBe(true);
    });
  });

  describe('recommendIndexes', () => {
    it('should recommend indexes for ref fields', () => {
      const recs = assistant.recommendIndexes(testConfig);
      const authorIdx = recs.find((r) => r.collection === 'posts' && r.fields.includes('authorId'));
      expect(authorIdx).toBeDefined();
      expect(authorIdx?.estimatedImpact).toBe('high');
    });

    it('should not duplicate existing indexes', () => {
      const recs = assistant.recommendIndexes(testConfig);
      // email already has an index in users
      const emailIdx = recs.find((r) => r.collection === 'users' && r.fields.includes('email'));
      expect(emailIdx).toBeUndefined();
    });

    it('should recommend compound indexes', () => {
      const recs = assistant.recommendIndexes(testConfig);
      const compound = recs.find((r) => r.fields.length > 1);
      expect(compound).toBeDefined();
    });
  });

  describe('generateQuery', () => {
    it('should generate query for "find all"', () => {
      const queries = assistant.generateQuery('find all users', testConfig);
      expect(queries.length).toBeGreaterThan(0);
      expect(queries[0]?.code).toContain("'users'");
    });

    it('should generate filtered query for field mentions', () => {
      const queries = assistant.generateQuery('find users by email', testConfig);
      const emailQuery = queries.find((q) => q.code.includes('email'));
      expect(emailQuery).toBeDefined();
      expect(emailQuery?.code).toContain('$eq');
    });

    it('should generate count query', () => {
      const queries = assistant.generateQuery('count posts', testConfig);
      expect(queries.some((q) => q.code.includes('length'))).toBe(true);
    });

    it('should generate sort query', () => {
      const queries = assistant.generateQuery('sort users by name', testConfig);
      const sortQuery = queries.find((q) => q.code.includes('sort'));
      expect(sortQuery).toBeDefined();
    });

    it('should return template for unknown queries', () => {
      const queries = assistant.generateQuery('something unrelated', testConfig);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.description).toContain('template');
    });
  });

  describe('suggestMigrations', () => {
    it('should suggest adding timestamps', () => {
      const suggestions = assistant.suggestMigrations(testConfig);
      const timestampMig = suggestions.find((s) => s.name.includes('timestamps'));
      expect(timestampMig).toBeDefined();
      expect(timestampMig?.risk).toBe('low');
    });

    it('should suggest soft delete', () => {
      const suggestions = assistant.suggestMigrations(testConfig);
      const softDelete = suggestions.find((s) => s.name.includes('soft-delete'));
      expect(softDelete).toBeDefined();
    });

    it('should suggest indexes for required fields', () => {
      const suggestions = assistant.suggestMigrations(testConfig);
      const indexSuggestion = suggestions.find((s) => s.name.includes('index'));
      expect(indexSuggestion).toBeDefined();
    });
  });
});

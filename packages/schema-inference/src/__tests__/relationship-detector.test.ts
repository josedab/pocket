import { describe, it, expect } from 'vitest';
import {
  createRelationshipDetector,
  RelationshipDetector,
} from '../relationship-detector.js';
import { createInferenceEngine } from '../inference-engine.js';
import type { CollectionInput } from '../relationship-detector.js';
import type { InferredSchema } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const engine = createInferenceEngine();

function schemaFrom(docs: Record<string, unknown>[]): InferredSchema {
  return engine.analyze(docs);
}

function makeCollection(
  name: string,
  docs: Record<string, unknown>[],
): CollectionInput {
  return { name, schema: schemaFrom(docs), documents: docs };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RelationshipDetector', () => {
  describe('createRelationshipDetector', () => {
    it('returns a RelationshipDetector instance', () => {
      const detector = createRelationshipDetector();
      expect(detector).toBeInstanceOf(RelationshipDetector);
    });

    it('accepts partial config', () => {
      const detector = createRelationshipDetector({ minConfidence: 0.8 });
      expect(detector).toBeInstanceOf(RelationshipDetector);
    });
  });

  describe('detect', () => {
    it('finds foreign key relationships for fields ending in _id', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const posts = makeCollection('posts', [
        { id: '10', user_id: '1', title: 'Post A' },
        { id: '11', user_id: '2', title: 'Post B' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, posts]);

      const fk = result.relationships.find(
        r => r.sourceField === 'user_id' && r.target === 'users',
      );
      expect(fk).toBeDefined();
      expect(fk!.source).toBe('posts');
      expect(fk!.isEmbedded).toBe(false);
    });

    it('identifies one-to-one relationships', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const profiles = makeCollection('profiles', [
        { id: 'p1', user_id: '1', bio: 'Bio A' },
        { id: 'p2', user_id: '2', bio: 'Bio B' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, profiles]);

      const rel = result.relationships.find(
        r => r.sourceField === 'user_id' && r.target === 'users',
      );
      expect(rel).toBeDefined();
      expect(rel!.type).toBe('one-to-one');
    });

    it('identifies one-to-many relationships', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const orders = makeCollection('orders', [
        { id: 'o1', user_id: '1', total: 100 },
        { id: 'o2', user_id: '1', total: 200 },
        { id: 'o3', user_id: '2', total: 50 },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, orders]);

      const rel = result.relationships.find(
        r => r.sourceField === 'user_id' && r.target === 'users',
      );
      expect(rel).toBeDefined();
      // Multiple orders per user → one-to-many
      expect(rel!.type).toBe('one-to-many');
    });

    it('identifies many-to-many relationships via junction table', () => {
      const students = makeCollection('students', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const courses = makeCollection('courses', [
        { id: 'c1', title: 'Math' },
        { id: 'c2', title: 'Science' },
      ]);
      const enrollments = makeCollection('enrollments', [
        { id: 'e1', student_id: '1', course_id: 'c1' },
        { id: 'e2', student_id: '1', course_id: 'c2' },
        { id: 'e3', student_id: '2', course_id: 'c1' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([students, courses, enrollments]);

      const studentRel = result.relationships.find(
        r => r.sourceField === 'student_id' && r.target === 'students',
      );
      const courseRel = result.relationships.find(
        r => r.sourceField === 'course_id' && r.target === 'courses',
      );

      expect(studentRel).toBeDefined();
      expect(courseRel).toBeDefined();
    });

    it('detects embedded one-to-one relationships for object fields', () => {
      const schema = schemaFrom([
        { name: 'Alice', address: { city: 'NYC', zip: '10001' } },
        { name: 'Bob', address: { city: 'LA', zip: '90001' } },
      ]);
      const collection: CollectionInput = { name: 'users', schema };
      const detector = createRelationshipDetector();
      const result = detector.detect([collection]);

      const embedded = result.relationships.find(
        r => r.isEmbedded && r.sourceField === 'address',
      );
      expect(embedded).toBeDefined();
      expect(embedded!.type).toBe('one-to-one');
    });
  });

  describe('ER diagram', () => {
    it('generates ER diagram with nodes and edges', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
      ]);
      const posts = makeCollection('posts', [
        { id: 'p1', user_id: '1', title: 'Hello' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, posts]);

      expect(result.erDiagram.nodes.length).toBe(2);
      expect(result.erDiagram.nodes.map(n => n.name)).toContain('users');
      expect(result.erDiagram.nodes.map(n => n.name)).toContain('posts');

      // Nodes have fields
      const usersNode = result.erDiagram.nodes.find(n => n.name === 'users');
      expect(usersNode!.fields).toContain('id');
      expect(usersNode!.fields).toContain('name');
    });

    it('generates edges for non-embedded relationships', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const posts = makeCollection('posts', [
        { id: 'p1', user_id: '1', title: 'Hello' },
        { id: 'p2', user_id: '2', title: 'World' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, posts]);

      const edge = result.erDiagram.edges.find(
        e => e.from === 'posts' && e.to === 'users',
      );
      expect(edge).toBeDefined();
      expect(edge!.label).toContain('user_id');
    });

    it('does not include embedded relationships in edges', () => {
      const schema = schemaFrom([
        { name: 'Alice', profile: { bio: 'Hello' } },
      ]);
      const collection: CollectionInput = { name: 'users', schema };

      const detector = createRelationshipDetector();
      const result = detector.detect([collection]);

      // Embedded relationships should NOT appear as edges
      expect(result.erDiagram.edges.length).toBe(0);
    });
  });

  describe('confidence scoring', () => {
    it('provides confidence scores for detected relationships', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const posts = makeCollection('posts', [
        { id: 'p1', user_id: '1', title: 'Hello' },
        { id: 'p2', user_id: '2', title: 'World' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, posts]);

      for (const rel of result.relationships) {
        expect(rel.confidence.value).toBeGreaterThanOrEqual(0);
        expect(rel.confidence.value).toBeLessThanOrEqual(1);
        expect(rel.confidence.sampleCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('filters out relationships below minConfidence', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
      ]);
      const posts = makeCollection('posts', [
        { id: 'p1', user_id: '999', title: 'Hello' },
      ]);

      // High threshold
      const detector = createRelationshipDetector({ minConfidence: 0.99 });
      const result = detector.detect([users, posts]);

      for (const rel of result.relationships) {
        expect(rel.confidence.value).toBeGreaterThanOrEqual(0.99);
      }
    });
  });

  describe('edge cases', () => {
    it('returns no relationships for unrelated collections', () => {
      const cats = makeCollection('cats', [
        { id: '1', breed: 'Siamese' },
      ]);
      const cars = makeCollection('cars', [
        { id: 'c1', make: 'Toyota' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([cats, cars]);

      const nonEmbedded = result.relationships.filter(r => !r.isEmbedded);
      expect(nonEmbedded.length).toBe(0);
    });

    it('returns empty result for empty collections array', () => {
      const detector = createRelationshipDetector();
      const result = detector.detect([]);

      expect(result.relationships.length).toBe(0);
      expect(result.erDiagram.nodes.length).toBe(0);
      expect(result.erDiagram.edges.length).toBe(0);
    });

    it('handles single collection with no foreign keys', () => {
      const items = makeCollection('items', [
        { id: '1', name: 'Widget', price: 9.99 },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([items]);

      const nonEmbedded = result.relationships.filter(r => !r.isEmbedded);
      expect(nonEmbedded.length).toBe(0);
    });

    it('handles collections without id fields', () => {
      const logs = makeCollection('logs', [
        { message: 'hello', level: 'info' },
      ]);
      const events = makeCollection('events', [
        { log_id: '1', type: 'click' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([logs, events]);

      // No id field in logs → no FK relationship from events to logs
      const fk = result.relationships.find(
        r => r.sourceField === 'log_id' && r.target === 'logs',
      );
      expect(fk).toBeUndefined();
    });

    it('supports Id suffix pattern', () => {
      const users = makeCollection('users', [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
      const comments = makeCollection('comments', [
        { id: 'c1', userId: '1', text: 'Great!' },
        { id: 'c2', userId: '2', text: 'Thanks!' },
      ]);

      const detector = createRelationshipDetector();
      const result = detector.detect([users, comments]);

      const rel = result.relationships.find(
        r => r.sourceField === 'userId' && r.target === 'users',
      );
      expect(rel).toBeDefined();
    });
  });
});

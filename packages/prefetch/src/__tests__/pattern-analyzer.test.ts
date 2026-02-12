import { describe, it, expect, beforeEach } from 'vitest';
import { PatternAnalyzer, createPatternAnalyzer } from '../pattern-analyzer.js';

describe('PatternAnalyzer', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = createPatternAnalyzer();
  });

  /* ------------------------------------------------------------------ */
  /*  Recording & Retrieval                                              */
  /* ------------------------------------------------------------------ */

  describe('recordQuery', () => {
    it('should record queries and retrieve patterns', () => {
      analyzer.recordQuery('todos', { completed: false }, 10);
      analyzer.recordQuery('users', { role: 'admin' }, 5);

      const patterns = analyzer.getPatterns();
      expect(patterns).toHaveLength(2);
      expect(patterns[0].collection).toBe('todos');
      expect(patterns[0].frequency).toBe(1);
      expect(patterns[0].avgExecutionMs).toBe(10);
    });

    it('should update frequency and avgExecutionMs on repeated queries', () => {
      analyzer.recordQuery('todos', { completed: false }, 10);
      analyzer.recordQuery('todos', { completed: false }, 20);

      const patterns = analyzer.getPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].frequency).toBe(2);
      expect(patterns[0].avgExecutionMs).toBe(15);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Frequency-based Ranking                                            */
  /* ------------------------------------------------------------------ */

  describe('getPatterns', () => {
    it('should rank patterns by frequency descending', () => {
      analyzer.recordQuery('users', { active: true }, 5);
      analyzer.recordQuery('todos', { completed: false }, 10);
      analyzer.recordQuery('todos', { completed: false }, 12);
      analyzer.recordQuery('todos', { completed: false }, 8);

      const patterns = analyzer.getPatterns();
      expect(patterns[0].collection).toBe('todos');
      expect(patterns[0].frequency).toBe(3);
      expect(patterns[1].collection).toBe('users');
      expect(patterns[1].frequency).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Predictions                                                        */
  /* ------------------------------------------------------------------ */

  describe('predict', () => {
    it('should predict next queries', () => {
      analyzer.recordQuery('todos', { completed: false }, 10);
      analyzer.recordQuery('users', { role: 'admin' }, 5);
      analyzer.recordQuery('todos', { completed: false }, 8);

      const predictions = analyzer.predict(2);
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions.length).toBeLessThanOrEqual(2);
      expect(predictions[0].confidence).toBeGreaterThan(0);
      expect(predictions[0].pattern).toBeDefined();
    });

    it('should return empty array when no patterns exist', () => {
      const predictions = analyzer.predict();
      expect(predictions).toHaveLength(0);
    });

    it('should respect count parameter', () => {
      analyzer.recordQuery('a', {}, 1);
      analyzer.recordQuery('b', {}, 1);
      analyzer.recordQuery('c', {}, 1);

      const predictions = analyzer.predict(1);
      expect(predictions).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Sequences / Transitions                                            */
  /* ------------------------------------------------------------------ */

  describe('getSequences', () => {
    it('should track query sequences (transitions)', () => {
      analyzer.recordQuery('todos', {}, 10);
      analyzer.recordQuery('users', {}, 5);
      analyzer.recordQuery('todos', {}, 8);

      const sequences = analyzer.getSequences();
      const todosHash = 'todos:{}';
      const usersHash = 'users:{}';

      expect(sequences.has(todosHash)).toBe(true);
      expect(sequences.get(todosHash)!.get(usersHash)).toBe(1);

      expect(sequences.has(usersHash)).toBe(true);
      expect(sequences.get(usersHash)!.get(todosHash)).toBe(1);
    });

    it('should increment transition counts', () => {
      analyzer.recordQuery('a', {}, 1);
      analyzer.recordQuery('b', {}, 1);
      analyzer.recordQuery('a', {}, 1);
      analyzer.recordQuery('b', {}, 1);

      const sequences = analyzer.getSequences();
      expect(sequences.get('a:{}')!.get('b:{}')).toBe(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Reset                                                              */
  /* ------------------------------------------------------------------ */

  describe('reset', () => {
    it('should clear all data', () => {
      analyzer.recordQuery('todos', {}, 10);
      analyzer.recordQuery('users', {}, 5);

      analyzer.reset();

      expect(analyzer.getPatterns()).toHaveLength(0);
      expect(analyzer.predict()).toHaveLength(0);
      expect(analyzer.getSequences().size).toBe(0);
    });
  });
});

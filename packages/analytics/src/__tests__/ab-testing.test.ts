import { describe, it, expect, beforeEach } from 'vitest';
import { ABTestEngine, createABTestEngine } from '../ab-testing.js';

describe('ABTestEngine', () => {
  let engine: ABTestEngine;

  beforeEach(() => {
    engine = createABTestEngine();
  });

  describe('experiment lifecycle', () => {
    it('should create an experiment', () => {
      const exp = engine.createExperiment({
        id: 'test-1',
        name: 'Test Experiment',
        variants: [
          { id: 'control', name: 'Control', weight: 50 },
          { id: 'treatment', name: 'Treatment', weight: 50 },
        ],
        trafficPercent: 100,
      });
      expect(exp.id).toBe('test-1');
      expect(exp.status).toBe('running');
    });

    it('should list experiments', () => {
      engine.createExperiment({ id: 'a', name: 'A', variants: [{ id: 'v', name: 'V', weight: 1 }], trafficPercent: 100 });
      engine.createExperiment({ id: 'b', name: 'B', variants: [{ id: 'v', name: 'V', weight: 1 }], trafficPercent: 100 });
      expect(engine.listExperiments()).toHaveLength(2);
    });

    it('should end an experiment', () => {
      engine.createExperiment({ id: 'test', name: 'T', variants: [{ id: 'v', name: 'V', weight: 1 }], trafficPercent: 100 });
      engine.endExperiment('test');
      expect(engine.getExperiment('test')?.status).toBe('completed');
    });
  });

  describe('variant assignment', () => {
    it('should assign users to variants deterministically', () => {
      engine.createExperiment({
        id: 'exp-1',
        name: 'Test',
        variants: [
          { id: 'control', name: 'Control', weight: 50 },
          { id: 'treatment', name: 'Treatment', weight: 50 },
        ],
        trafficPercent: 100,
      });
      const v1 = engine.getVariant('exp-1', 'user-1');
      const v2 = engine.getVariant('exp-1', 'user-1');
      expect(v1?.id).toBe(v2?.id); // Same user gets same variant
    });

    it('should return null for non-running experiments', () => {
      engine.createExperiment({ id: 'exp', name: 'T', variants: [{ id: 'v', name: 'V', weight: 1 }], trafficPercent: 100 });
      engine.endExperiment('exp');
      expect(engine.getVariant('exp', 'user-1')).toBeNull();
    });

    it('should return null for unknown experiments', () => {
      expect(engine.getVariant('nonexistent', 'user-1')).toBeNull();
    });

    it('should distribute users across variants', () => {
      engine.createExperiment({
        id: 'exp',
        name: 'Test',
        variants: [
          { id: 'a', name: 'A', weight: 50 },
          { id: 'b', name: 'B', weight: 50 },
        ],
        trafficPercent: 100,
      });
      const counts = { a: 0, b: 0 };
      for (let i = 0; i < 100; i++) {
        const v = engine.getVariant('exp', `user-${i}`);
        if (v?.id === 'a') counts.a++;
        else if (v?.id === 'b') counts.b++;
      }
      // Both variants should get some users (not all in one)
      expect(counts.a).toBeGreaterThan(10);
      expect(counts.b).toBeGreaterThan(10);
    });
  });

  describe('conversion tracking', () => {
    it('should track conversions', () => {
      engine.createExperiment({
        id: 'exp',
        name: 'T',
        variants: [{ id: 'v', name: 'V', weight: 1 }],
        trafficPercent: 100,
      });
      engine.getVariant('exp', 'user-1');
      expect(engine.trackConversion('exp', 'user-1')).toBe(true);
    });

    it('should return false for unknown experiment', () => {
      expect(engine.trackConversion('bad', 'user-1')).toBe(false);
    });
  });

  describe('results', () => {
    it('should compute experiment results', () => {
      engine.createExperiment({
        id: 'exp',
        name: 'Test',
        variants: [
          { id: 'control', name: 'Control', weight: 50 },
          { id: 'treatment', name: 'Treatment', weight: 50 },
        ],
        trafficPercent: 100,
      });

      // Assign 20 users
      for (let i = 0; i < 20; i++) engine.getVariant('exp', `user-${i}`);

      // Track some conversions
      for (let i = 0; i < 5; i++) engine.trackConversion('exp', `user-${i}`);

      const results = engine.getResults('exp');
      expect(results).not.toBeNull();
      expect(results!.totalParticipants).toBe(20);
      expect(results!.variants.length).toBe(2);
    });

    it('should return null for unknown experiment', () => {
      expect(engine.getResults('bad')).toBeNull();
    });
  });
});

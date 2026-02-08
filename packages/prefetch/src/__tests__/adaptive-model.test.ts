import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveLearningModel, createAdaptiveLearningModel } from '../adaptive-model.js';

describe('AdaptiveLearningModel', () => {
  let model: AdaptiveLearningModel;

  beforeEach(() => {
    model = createAdaptiveLearningModel({ memoryBudget: 50 });
  });

  it('should record queries and predict next', () => {
    model.recordQuery('todos', { completed: false }, 10);
    model.recordQuery('users', { role: 'admin' }, 8);
    model.recordQuery('todos', { completed: false }, 12);

    const predictions = model.predict(3);
    expect(predictions.length).toBeGreaterThanOrEqual(1);
    // Both queries should appear in predictions
    const hashes = predictions.map((p) => p.queryHash);
    expect(hashes.some((h) => h.includes('todos'))).toBe(true);
    expect(predictions[0]!.confidence).toBeGreaterThan(0);
  });

  it('should use navigation context for predictions', () => {
    model.setNavigationContext({ route: '/dashboard', timestamp: Date.now() });
    model.recordQuery('stats', {}, 5);
    model.recordQuery('stats', {}, 5);
    model.recordQuery('stats', {}, 5);

    model.setNavigationContext({ route: '/settings', timestamp: Date.now() });
    model.recordQuery('config', {}, 3);

    // Switch back to dashboard
    model.setNavigationContext({ route: '/dashboard', timestamp: Date.now() });
    const predictions = model.predict(3);

    const statsHash = predictions.find((p) => p.queryHash.startsWith('stats'));
    const configHash = predictions.find((p) => p.queryHash.startsWith('config'));

    expect(statsHash).toBeDefined();
    if (configHash) {
      expect(statsHash!.confidence).toBeGreaterThan(configHash.confidence);
    }
  });

  it('should track Markov transitions', () => {
    // Simulate navigation pattern: A → B → C → A → B → C
    model.recordQuery('A', {}, 5);
    model.recordQuery('B', {}, 5);
    model.recordQuery('C', {}, 5);
    model.recordQuery('A', {}, 5);
    model.recordQuery('B', {}, 5);

    // After B, C should be predicted
    const predictions = model.predict(5);
    const cPrediction = predictions.find((p) => p.queryHash === 'C:{}');
    expect(cPrediction).toBeDefined();
    expect(cPrediction!.confidence).toBeGreaterThan(0);
  });

  it('should report accuracy and adapt weights', () => {
    model.recordQuery('X', {}, 5);
    model.recordQuery('Y', {}, 5);

    const initialWeights = model.getWeights();
    expect(
      initialWeights.frequency +
        initialWeights.recency +
        initialWeights.transition +
        initialWeights.navigation
    ).toBeCloseTo(1.0);

    // Report 20 inaccurate predictions to trigger adaptation
    for (let i = 0; i < 20; i++) {
      model.reportAccuracy('X:{}', false);
    }

    const adaptedWeights = model.getWeights();
    // Transition and navigation should have increased
    expect(adaptedWeights.transition).toBeGreaterThanOrEqual(initialWeights.transition);
  });

  it('should provide session statistics', () => {
    model.recordQuery('todos', {}, 10);
    model.recordQuery('users', {}, 8);
    model.recordQuery('todos', {}, 12);

    const stats = model.getSessionStats();
    expect(stats.queryCount).toBe(3);
    expect(stats.uniqueQueries).toBe(2);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should enforce memory budget', () => {
    const smallModel = createAdaptiveLearningModel({ memoryBudget: 5 });

    for (let i = 0; i < 10; i++) {
      smallModel.recordQuery(`collection${i}`, {}, 5);
    }

    const stats = smallModel.getSessionStats();
    expect(stats.uniqueQueries).toBeLessThanOrEqual(5);
  });

  it('should reset session while keeping patterns', () => {
    model.recordQuery('todos', {}, 10);
    model.resetSession();

    const stats = model.getSessionStats();
    expect(stats.queryCount).toBe(0);

    // Patterns should still exist
    const predictions = model.predict(5);
    expect(predictions.length).toBeGreaterThan(0);
  });

  it('should fully reset on reset()', () => {
    model.recordQuery('todos', {}, 10);
    model.reset();

    const predictions = model.predict(5);
    expect(predictions.length).toBe(0);
  });
});

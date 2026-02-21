import { describe, it, expect } from 'vitest';
import { computeFunnel, computeFunnels } from '../funnel-engine.js';
import type { AnalyticsEvent } from '../types.js';

function makeEvent(name: string, userId: string, timestamp: number): AnalyticsEvent {
  return {
    id: `e_${Math.random().toString(36).slice(2)}`,
    name,
    properties: {},
    userId,
    anonymousId: 'anon',
    sessionId: 'sess',
    timestamp,
    synced: false,
    context: { userAgent: '', locale: '', timezone: '' },
  };
}

describe('Funnel Engine', () => {
  describe('basic funnel', () => {
    it('should compute step-by-step conversion', () => {
      const events = [
        makeEvent('page_view', 'u1', 1000),
        makeEvent('sign_up', 'u1', 2000),
        makeEvent('purchase', 'u1', 3000),
        makeEvent('page_view', 'u2', 1000),
        makeEvent('sign_up', 'u2', 2000),
        // u2 doesn't purchase
        makeEvent('page_view', 'u3', 1000),
        // u3 only views
      ];

      const result = computeFunnel(
        { id: 'f1', name: 'Signup Flow', steps: ['page_view', 'sign_up', 'purchase'] },
        events,
      );

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0]!.uniqueUsers).toBe(3); // page_view
      expect(result.steps[1]!.uniqueUsers).toBe(2); // sign_up
      expect(result.steps[2]!.uniqueUsers).toBe(1); // purchase
      expect(result.totalConversionRate).toBeCloseTo(33.33, 0);
    });

    it('should enforce step ordering', () => {
      const events = [
        // u1 does steps in wrong order
        makeEvent('purchase', 'u1', 1000),
        makeEvent('page_view', 'u1', 2000),
      ];

      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['page_view', 'purchase'] },
        events,
      );

      // page_view comes after purchase chronologically, but funnel should match in order
      expect(result.steps[0]!.uniqueUsers).toBe(1); // page_view found (at ts=2000)
      expect(result.steps[1]!.uniqueUsers).toBe(0); // no purchase after page_view
    });
  });

  describe('time window', () => {
    it('should exclude users who complete outside window', () => {
      const events = [
        makeEvent('step1', 'u1', 1000),
        makeEvent('step2', 'u1', 1000 + 5000), // 5s later — within window
        makeEvent('step1', 'u2', 1000),
        makeEvent('step2', 'u2', 1000 + 20000), // 20s later — outside window
      ];

      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['step1', 'step2'], windowMs: 10000 },
        events,
      );

      expect(result.steps[0]!.uniqueUsers).toBe(2);
      expect(result.steps[1]!.uniqueUsers).toBe(1); // only u1 within window
    });
  });

  describe('dropout analysis', () => {
    it('should compute dropoff rates', () => {
      const events = [
        makeEvent('a', 'u1', 100), makeEvent('b', 'u1', 200),
        makeEvent('a', 'u2', 100),
        // u2 drops off at step b
      ];

      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['a', 'b'] },
        events,
      );

      expect(result.steps[1]!.dropoffRate).toBe(50);
      expect(result.steps[1]!.dropoffCount).toBe(1);
    });
  });

  describe('completion time', () => {
    it('should compute median completion time', () => {
      const events = [
        makeEvent('start', 'u1', 1000), makeEvent('end', 'u1', 2000), // 1000ms
        makeEvent('start', 'u2', 1000), makeEvent('end', 'u2', 4000), // 3000ms
      ];

      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['start', 'end'] },
        events,
      );

      expect(result.medianCompletionTimeMs).not.toBeNull();
    });

    it('should return null when no one completes', () => {
      const events = [makeEvent('start', 'u1', 1000)];
      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['start', 'end'] },
        events,
      );
      expect(result.medianCompletionTimeMs).toBeNull();
    });
  });

  describe('empty inputs', () => {
    it('should handle empty events', () => {
      const result = computeFunnel(
        { id: 'f1', name: 'Test', steps: ['a', 'b'] },
        [],
      );
      expect(result.totalConversionRate).toBe(0);
      expect(result.uniqueUsersEntered).toBe(0);
    });
  });

  describe('computeFunnels', () => {
    it('should compute multiple funnels', () => {
      const events = [
        makeEvent('view', 'u1', 1000),
        makeEvent('click', 'u1', 2000),
      ];

      const results = computeFunnels([
        { id: 'f1', name: 'A', steps: ['view', 'click'] },
        { id: 'f2', name: 'B', steps: ['view', 'purchase'] },
      ], events);

      expect(results).toHaveLength(2);
      expect(results[0]!.steps[1]!.uniqueUsers).toBe(1);
      expect(results[1]!.steps[1]!.uniqueUsers).toBe(0);
    });
  });
});

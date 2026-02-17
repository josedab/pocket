import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AutoScaler,
  createAutoScaler,
  type AutoScalerConfig,
  type ScalerMetrics,
  type ScalingDecision,
} from '../auto-scaler.js';

const BASE_METRICS: ScalerMetrics = {
  cpuPercent: 50,
  memoryPercent: 40,
  activeConnections: 50,
  maxConnections: 100,
  messagesPerSecond: 500,
  maxMessagesPerSecond: 1000,
  avgLatencyMs: 50,
  maxLatencyMs: 200,
};

const BASE_CONFIG: AutoScalerConfig = {
  minInstances: 1,
  maxInstances: 10,
  scaleUpCooldownMs: 0,
  scaleDownCooldownMs: 0,
  policies: [
    { type: 'cpu', scaleUpThreshold: 80, scaleDownThreshold: 20 },
    { type: 'connections', scaleUpThreshold: 80, scaleDownThreshold: 20 },
  ],
};

describe('AutoScaler', () => {
  let scaler: AutoScaler;

  beforeEach(() => {
    scaler = createAutoScaler(BASE_CONFIG);
  });

  afterEach(() => {
    scaler.destroy();
  });

  describe('evaluation', () => {
    it('should return null when no metrics reported', () => {
      expect(scaler.evaluate()).toBeNull();
    });

    it('should not scale when metrics are within range', () => {
      scaler.reportMetrics(BASE_METRICS);
      const decision = scaler.evaluate()!;
      expect(decision.direction).toBe('none');
      expect(decision.reason).toContain('acceptable range');
    });

    it('should scale up on high CPU', () => {
      scaler.reportMetrics({ ...BASE_METRICS, cpuPercent: 90 });
      const decision = scaler.evaluate()!;
      expect(decision.direction).toBe('up');
      expect(decision.desiredInstances).toBe(2);
    });

    it('should scale up on high connection utilization', () => {
      scaler.reportMetrics({
        ...BASE_METRICS,
        activeConnections: 90,
        maxConnections: 100,
      });
      const decision = scaler.evaluate()!;
      expect(decision.direction).toBe('up');
    });

    it('should scale down on low utilization', () => {
      const s = createAutoScaler({
        ...BASE_CONFIG,
        minInstances: 1,
        maxInstances: 10,
      });
      s.setCurrentInstances(5);
      s.reportMetrics({
        ...BASE_METRICS,
        cpuPercent: 10,
        activeConnections: 5,
        maxConnections: 100,
      });
      const decision = s.evaluate()!;
      expect(decision.direction).toBe('down');
      expect(decision.desiredInstances).toBe(4);
      s.destroy();
    });

    it('should not scale below minInstances', () => {
      scaler.reportMetrics({
        ...BASE_METRICS,
        cpuPercent: 5,
        activeConnections: 5,
        maxConnections: 100,
      });
      const decision = scaler.evaluate()!;
      // Already at min (1), so direction should be 'none'
      expect(decision.desiredInstances).toBeGreaterThanOrEqual(1);
    });

    it('should not scale above maxInstances', () => {
      scaler.setCurrentInstances(10);
      scaler.reportMetrics({ ...BASE_METRICS, cpuPercent: 95 });
      const decision = scaler.evaluate()!;
      expect(decision.desiredInstances).toBeLessThanOrEqual(10);
    });
  });

  describe('cooldown', () => {
    it('should respect cooldown period', () => {
      const s = createAutoScaler({
        ...BASE_CONFIG,
        scaleUpCooldownMs: 60_000,
      });
      s.reportMetrics({ ...BASE_METRICS, cpuPercent: 95 });
      s.evaluate(); // triggers scale up
      s.reportMetrics({ ...BASE_METRICS, cpuPercent: 95 });
      const second = s.evaluate();
      expect(second).toBeNull(); // in cooldown
      s.destroy();
    });
  });

  describe('state management', () => {
    it('should allow setting current instances', () => {
      scaler.setCurrentInstances(5);
      expect(scaler.getState().currentInstances).toBe(5);
    });

    it('should clamp instances to min/max', () => {
      scaler.setCurrentInstances(0);
      expect(scaler.getState().currentInstances).toBe(1);
      scaler.setCurrentInstances(999);
      expect(scaler.getState().currentInstances).toBe(10);
    });
  });

  describe('decisions stream', () => {
    it('should emit scaling decisions', () => {
      const decisions: ScalingDecision[] = [];
      scaler.decisions$.subscribe((d) => decisions.push(d));
      scaler.reportMetrics({ ...BASE_METRICS, cpuPercent: 95 });
      scaler.evaluate();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.direction).toBe('up');
    });
  });
});

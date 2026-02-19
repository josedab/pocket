import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NetworkSimulator,
  createNetworkSimulator,
  type NetworkEvent,
} from '../network-simulator.js';

describe('NetworkSimulator', () => {
  let sim: NetworkSimulator;

  beforeEach(() => {
    sim = createNetworkSimulator();
  });

  afterEach(() => {
    sim.destroy();
  });

  describe('presets', () => {
    it('should initialize with perfect preset', () => {
      const cond = sim.getCondition();
      expect(cond.latencyMs).toBe(0);
      expect(cond.packetLossRate).toBe(0);
      expect(cond.online).toBe(true);
    });

    it('should switch to 3g preset', () => {
      sim.setPreset('3g');
      const cond = sim.getCondition();
      expect(cond.latencyMs).toBe(200);
      expect(cond.packetLossRate).toBe(0.03);
    });

    it('should switch to offline preset', () => {
      sim.setPreset('offline');
      expect(sim.getCondition().online).toBe(false);
    });

    it('should list all available presets', () => {
      const presets = sim.getPresets();
      expect(presets).toContain('perfect');
      expect(presets).toContain('3g');
      expect(presets).toContain('offline');
      expect(presets).toContain('flaky');
    });

    it('should get condition for a specific preset', () => {
      const cond = sim.getPresetCondition('broadband');
      expect(cond.latencyMs).toBe(20);
      expect(cond.online).toBe(true);
    });
  });

  describe('custom conditions', () => {
    it('should accept custom conditions', () => {
      sim.setCustomCondition({ latencyMs: 500, packetLossRate: 0.5 });
      const cond = sim.getCondition();
      expect(cond.latencyMs).toBe(500);
      expect(cond.packetLossRate).toBe(0.5);
    });

    it('should initialize with custom config', () => {
      const s = createNetworkSimulator({
        preset: '4g',
        custom: { latencyMs: 75 },
      });
      expect(s.getCondition().latencyMs).toBe(75);
      s.destroy();
    });
  });

  describe('request simulation', () => {
    it('should simulate instant request on perfect network', async () => {
      const result = await sim.simulateRequest(1024);
      expect(result.dropped).toBe(false);
      expect(result.actualLatencyMs).toBe(0);
    });

    it('should drop all requests when offline', async () => {
      sim.setPreset('offline');
      const result = await sim.simulateRequest(1024);
      expect(result.dropped).toBe(true);
    });

    it('should add latency on slow networks', async () => {
      sim.setCustomCondition({
        latencyMs: 100,
        jitterMs: 0,
        packetLossRate: 0,
        downloadBandwidth: 0,
        uploadBandwidth: 0,
        online: true,
      });
      const result = await sim.simulateRequest(100);
      expect(result.dropped).toBe(false);
      expect(result.actualLatencyMs).toBeGreaterThanOrEqual(90);
    });

    it('should apply bandwidth throttling', async () => {
      sim.setCustomCondition({
        latencyMs: 0,
        jitterMs: 0,
        packetLossRate: 0,
        downloadBandwidth: 1000,
        uploadBandwidth: 10_000, // 10KB/sec
        online: true,
      });
      const result = await sim.simulateRequest(500); // 500B at 10KB/s = 50ms
      expect(result.throttled).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track request counts', async () => {
      await sim.simulateRequest(100);
      await sim.simulateRequest(100);
      const stats = sim.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.droppedRequests).toBe(0);
    });

    it('should track dropped requests', async () => {
      sim.setPreset('offline');
      await sim.simulateRequest(100);
      expect(sim.getStats().droppedRequests).toBe(1);
    });

    it('should reset statistics', async () => {
      await sim.simulateRequest(100);
      sim.resetStats();
      expect(sim.getStats().totalRequests).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit events for condition changes', () => {
      const events: NetworkEvent[] = [];
      sim.events$.subscribe((e) => events.push(e));
      sim.setPreset('3g');
      expect(events.some((e) => e.type === 'condition-changed')).toBe(true);
    });

    it('should emit went-offline event', () => {
      const events: NetworkEvent[] = [];
      sim.events$.subscribe((e) => events.push(e));
      sim.setPreset('offline');
      expect(events.some((e) => e.type === 'went-offline')).toBe(true);
    });

    it('should emit went-online event', () => {
      sim.setPreset('offline');
      const events: NetworkEvent[] = [];
      sim.events$.subscribe((e) => events.push(e));
      sim.setPreset('broadband');
      expect(events.some((e) => e.type === 'went-online')).toBe(true);
    });

    it('should emit request-dropped event', async () => {
      sim.setPreset('offline');
      const events: NetworkEvent[] = [];
      sim.events$.subscribe((e) => events.push(e));
      await sim.simulateRequest(100);
      expect(events.some((e) => e.type === 'request-dropped')).toBe(true);
    });
  });
});

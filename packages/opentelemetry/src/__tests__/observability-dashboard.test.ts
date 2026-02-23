import { describe, expect, it } from 'vitest';
import { ObservabilityDashboard } from '../observability-dashboard.js';

describe('ObservabilityDashboard', () => {
  it('should record and retrieve metrics', () => {
    const dash = new ObservabilityDashboard();
    dash.record('query.latency', 5);
    dash.record('query.latency', 10);
    dash.record('query.latency', 3);

    const metric = dash.getMetric('query.latency');
    expect(metric).not.toBeNull();
    expect(metric!.points).toHaveLength(3);
    expect(metric!.avg).toBeCloseTo(6);
    expect(metric!.min).toBe(3);
    expect(metric!.max).toBe(10);
    dash.destroy();
  });

  it('should generate snapshots with all metrics', () => {
    const dash = new ObservabilityDashboard();
    dash.record('query.count', 100);
    dash.record('sync.latency', 50);

    const snapshot = dash.getSnapshot();
    expect(snapshot.metrics['query.count']).toBeDefined();
    expect(snapshot.metrics['sync.latency']).toBeDefined();
    expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
    dash.destroy();
  });

  it('should trigger alerts when threshold exceeded', () => {
    const dash = new ObservabilityDashboard();
    dash.addAlert({
      name: 'slow-query',
      metric: 'query.latency',
      condition: 'above',
      threshold: 100,
      cooldownMs: 0,
    });

    const events: unknown[] = [];
    dash.events$.subscribe((e) => events.push(e));

    dash.record('query.latency', 50); // below threshold
    dash.record('query.latency', 150); // above threshold

    const alertEvents = events.filter((e) => (e as { type: string }).type === 'alert:triggered');
    expect(alertEvents).toHaveLength(1);
    dash.destroy();
  });

  it('should respect alert cooldown', () => {
    const dash = new ObservabilityDashboard();
    dash.addAlert({
      name: 'test',
      metric: 'query.latency',
      condition: 'above',
      threshold: 10,
      cooldownMs: 60000,
    });

    dash.record('query.latency', 20);
    dash.record('query.latency', 30); // Should be suppressed by cooldown

    const alerts = dash.getAlerts();
    expect(alerts).toHaveLength(1);
    dash.destroy();
  });

  it('should register custom metrics', () => {
    const dash = new ObservabilityDashboard();
    dash.registerMetric('custom.counter', 'ops');
    dash.record('custom.counter', 42);

    const metric = dash.getMetric('custom.counter');
    expect(metric!.current).toBe(42);
    dash.destroy();
  });

  it('should auto-register unknown metrics', () => {
    const dash = new ObservabilityDashboard();
    dash.record('brand.new.metric', 99);
    expect(dash.getMetric('brand.new.metric')!.current).toBe(99);
    dash.destroy();
  });

  it('should limit data points', () => {
    const dash = new ObservabilityDashboard({ maxDataPoints: 5 });
    for (let i = 0; i < 10; i++) dash.record('test', i);
    expect(dash.getMetric('test')!.points).toHaveLength(5);
    dash.destroy();
  });

  it('should reset all metrics', () => {
    const dash = new ObservabilityDashboard();
    dash.record('a', 1);
    dash.record('b', 2);
    dash.reset();
    expect(dash.getMetric('a')!.points).toHaveLength(0);
    dash.destroy();
  });
});

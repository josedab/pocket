import { describe, it, expect } from 'vitest';
import {
  buildMetricCard,
  buildChart,
  buildFunnel,
  buildTopEvents,
} from '../dashboard-components.js';

describe('Dashboard Components', () => {
  describe('buildMetricCard', () => {
    it('should build a metric card with change calculation', () => {
      const card = buildMetricCard('users', 'Total Users', 150, 100);
      expect(card.id).toBe('users');
      expect(card.title).toBe('Total Users');
      expect(card.value).toBe(150);
      expect(card.previousValue).toBe(100);
      expect(card.changePercent).toBe(50);
      expect(card.changeDirection).toBe('up');
    });

    it('should detect decrease', () => {
      const card = buildMetricCard('rev', 'Revenue', 80, 100);
      expect(card.changeDirection).toBe('down');
      expect(card.changePercent).toBe(-20);
    });

    it('should detect flat', () => {
      const card = buildMetricCard('x', 'X', 100, 100);
      expect(card.changeDirection).toBe('flat');
      expect(card.changePercent).toBe(0);
    });

    it('should handle zero previous', () => {
      const card = buildMetricCard('x', 'X', 50, 0);
      expect(card.changePercent).toBe(0);
    });

    it('should assign colors based on direction', () => {
      const up = buildMetricCard('a', 'A', 200, 100);
      const down = buildMetricCard('b', 'B', 50, 100);
      expect(up.color).not.toBe(down.color);
    });

    it('should support format types', () => {
      const card = buildMetricCard('dur', 'Duration', 5000, 4000, 'duration');
      expect(card.format).toBe('duration');
    });
  });

  describe('buildChart', () => {
    it('should build a chart descriptor', () => {
      const chart = buildChart('events', 'Events', 'line', [
        { label: 'Mon', value: 10 },
        { label: 'Tue', value: 20 },
      ]);
      expect(chart.id).toBe('events');
      expect(chart.type).toBe('line');
      expect(chart.data).toHaveLength(2);
      expect(chart.color).toBeTruthy();
    });

    it('should assign fill color for area charts', () => {
      const chart = buildChart('x', 'X', 'area', []);
      expect(chart.fillColor).toBeTruthy();
      expect(chart.fillColor).toContain('33'); // alpha
    });

    it('should not assign fill for line charts', () => {
      const chart = buildChart('x', 'X', 'line', []);
      expect(chart.fillColor).toBeUndefined();
    });

    it('should cycle colors by index', () => {
      const c1 = buildChart('a', 'A', 'line', [], 0);
      const c2 = buildChart('b', 'B', 'line', [], 1);
      expect(c1.color).not.toBe(c2.color);
    });
  });

  describe('buildFunnel', () => {
    it('should build funnel with conversion rates', () => {
      const funnel = buildFunnel('signup', 'Signup', [
        { label: 'Visit', count: 1000 },
        { label: 'Signup', count: 300 },
        { label: 'Purchase', count: 50 },
      ]);
      expect(funnel.steps).toHaveLength(3);
      expect(funnel.steps[0]!.percent).toBe(100);
      expect(funnel.steps[1]!.percent).toBe(30);
      expect(funnel.steps[2]!.percent).toBe(5);
      expect(funnel.totalConversion).toBe(5);
    });

    it('should compute dropoff rates', () => {
      const funnel = buildFunnel('f', 'F', [
        { label: 'A', count: 100 },
        { label: 'B', count: 60 },
      ]);
      expect(funnel.steps[1]!.dropoffPercent).toBe(40);
    });

    it('should handle empty funnel', () => {
      const funnel = buildFunnel('f', 'F', []);
      expect(funnel.totalConversion).toBe(0);
    });
  });

  describe('buildTopEvents', () => {
    it('should build top events with percentages', () => {
      const result = buildTopEvents([
        { name: 'click', count: 50 },
        { name: 'view', count: 30 },
        { name: 'scroll', count: 20 },
      ]);
      expect(result.totalEvents).toBe(100);
      expect(result.events[0]!.percentOfTotal).toBe(50);
      expect(result.events[1]!.percentOfTotal).toBe(30);
    });

    it('should handle empty events', () => {
      const result = buildTopEvents([]);
      expect(result.totalEvents).toBe(0);
    });
  });
});

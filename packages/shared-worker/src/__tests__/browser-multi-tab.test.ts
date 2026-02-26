/**
 * Browser-environment tests for multi-tab coordination.
 *
 * Tests BroadcastChannel-based communication, leader election,
 * and mutation broadcasting in a simulated browser environment.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoordinationEvent, MultiTabMiddleware } from '../multi-tab-middleware.js';
import { createMultiTabMiddleware } from '../multi-tab-middleware.js';

// jsdom provides BroadcastChannel

describe('MultiTabMiddleware (browser environment)', () => {
  const instances: MultiTabMiddleware[] = [];

  afterEach(() => {
    for (const inst of instances) inst.destroy();
    instances.length = 0;
  });

  function createTab(name: string): MultiTabMiddleware {
    const mw = createMultiTabMiddleware({
      databaseName: `test-${name}`,
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 500,
    });
    instances.push(mw);
    return mw;
  }

  it('should detect BroadcastChannel availability', () => {
    expect(typeof BroadcastChannel).toBe('function');
  });

  it('should elect a leader when first tab starts', async () => {
    const tab1 = createTab('leader-election');
    const events: CoordinationEvent[] = [];
    const sub = tab1.events.subscribe((e) => events.push(e));

    tab1.start();

    // Wait for election timeout
    await new Promise((r) => setTimeout(r, 200));

    sub.unsubscribe();
    expect(tab1.getRole()).toBe('leader');
    expect(events.some((e) => e.type === 'leader-elected')).toBe(true);
  });

  it('should broadcast mutations without errors', async () => {
    const tab1 = createTab('mutation-broadcast');
    tab1.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(() => {
      tab1.broadcastMutation('todos', 'insert', 'doc-123');
    }).not.toThrow();
  });

  it('should report health via observable', async () => {
    const tab1 = createTab('health-check');
    const healthStates: string[] = [];
    const sub = tab1.health.subscribe((h) => healthStates.push(h.role));

    tab1.start();
    await new Promise((r) => setTimeout(r, 200));

    sub.unsubscribe();
    expect(healthStates.length).toBeGreaterThan(0);
    // Should transition from standalone → leader
    expect(healthStates).toContain('leader');
  });

  it('should generate unique tab IDs', () => {
    const tab1 = createTab('unique-1');
    const tab2 = createTab('unique-2');
    expect(tab1.getTabId()).not.toBe(tab2.getTabId());
  });

  it('should clean up BroadcastChannel on destroy', async () => {
    const tab1 = createTab('cleanup');
    tab1.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(() => tab1.destroy()).not.toThrow();
  });

  it('should count connected tabs', async () => {
    const tab1 = createTab('count');
    tab1.start();
    await new Promise((r) => setTimeout(r, 200));
    // Only self in this environment
    expect(tab1.getTabCount()).toBeGreaterThanOrEqual(1);
  });
});

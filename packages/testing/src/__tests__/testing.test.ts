import { describe, it, expect, beforeEach } from 'vitest';
import { createNetworkSimulator } from '../network-simulator.js';
import { createConflictInjector } from '../conflict-injector.js';
import { createConsistencyChecker } from '../consistency-checker.js';
import { createSyncTestHarness } from '../sync-test-harness.js';
import type { NetworkState } from '../types.js';

describe('NetworkSimulator', () => {
  it('should start with online condition by default', () => {
    const simulator = createNetworkSimulator();
    const state = simulator.getState();

    expect(state.condition).toBe('online');
    expect(state.latencyMs).toBe(0);
    expect(state.packetLossRate).toBe(0);
    expect(state.requestCount).toBe(0);
    expect(state.droppedCount).toBe(0);
  });

  it('should start with configured initial condition', () => {
    const simulator = createNetworkSimulator({ initialCondition: 'slow' });
    const state = simulator.getState();

    expect(state.condition).toBe('slow');
    expect(state.latencyMs).toBe(3000);
  });

  it('should transition to offline', () => {
    const simulator = createNetworkSimulator();
    simulator.simulateOffline();

    const state = simulator.getState();
    expect(state.condition).toBe('offline');
    expect(state.packetLossRate).toBe(1);
  });

  it('should transition to online', () => {
    const simulator = createNetworkSimulator({ initialCondition: 'offline' });
    simulator.simulateOnline();

    const state = simulator.getState();
    expect(state.condition).toBe('online');
    expect(state.packetLossRate).toBe(0);
  });

  it('should transition to slow with custom latency', () => {
    const simulator = createNetworkSimulator();
    simulator.simulateSlow(5000);

    const state = simulator.getState();
    expect(state.condition).toBe('slow');
    expect(state.latencyMs).toBe(5000);
  });

  it('should apply latency to requests', async () => {
    const simulator = createNetworkSimulator({ latencyMs: 50 });

    const start = Date.now();
    const result = await simulator.simulateRequest(() => Promise.resolve('ok'));
    const elapsed = Date.now() - start;

    expect(result).toBe('ok');
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('should drop requests when offline', async () => {
    const simulator = createNetworkSimulator();
    simulator.simulateOffline();

    await expect(
      simulator.simulateRequest(() => Promise.resolve('ok')),
    ).rejects.toThrow('Network request dropped');
  });

  it('should track request and dropped counts', async () => {
    const simulator = createNetworkSimulator();
    simulator.simulateOffline();

    try {
      await simulator.simulateRequest(() => Promise.resolve('ok'));
    } catch {
      // expected
    }

    const state = simulator.getState();
    expect(state.requestCount).toBe(1);
    expect(state.droppedCount).toBe(1);
  });

  it('should emit state changes via state$ observable', () => {
    const simulator = createNetworkSimulator();
    const states: NetworkState[] = [];

    const sub = simulator.state$.subscribe((s) => states.push(s));

    simulator.simulateOffline();
    simulator.simulateOnline();

    sub.unsubscribe();

    expect(states.length).toBe(3); // initial + offline + online
    expect(states[0].condition).toBe('online');
    expect(states[1].condition).toBe('offline');
    expect(states[2].condition).toBe('online');
  });

  it('should simulate network partition', () => {
    const simulator = createNetworkSimulator();
    simulator.simulatePartition(['client-1', 'client-2']);

    const state = simulator.getState();
    expect(state.condition).toBe('partitioned');
    expect(state.packetLossRate).toBe(1);
  });

  it('should reset to initial state', async () => {
    const simulator = createNetworkSimulator();
    simulator.simulateOffline();

    try {
      await simulator.simulateRequest(() => Promise.resolve('ok'));
    } catch {
      // expected
    }

    simulator.reset();
    const state = simulator.getState();

    expect(state.condition).toBe('online');
    expect(state.requestCount).toBe(0);
    expect(state.droppedCount).toBe(0);
  });
});

describe('ConflictInjector', () => {
  it('should inject a conflict and return local and remote docs', () => {
    const injector = createConflictInjector();

    const { localDoc, remoteDoc } = injector.injectConflict({
      documentId: 'doc-1',
      localChanges: { title: 'Local Title' },
      remoteChanges: { title: 'Remote Title' },
    });

    expect(localDoc).toEqual({ _id: 'doc-1', title: 'Local Title' });
    expect(remoteDoc).toEqual({ _id: 'doc-1', title: 'Remote Title' });
  });

  it('should generate concurrent edits', () => {
    const injector = createConflictInjector();
    const scenarios = injector.generateConcurrentEdits('doc-1', 3);

    expect(scenarios).toHaveLength(3);
    scenarios.forEach((scenario, i) => {
      expect(scenario.documentId).toBe('doc-1');
      expect(scenario.localChanges[`field_${i}`]).toBe(`local_value_${i}`);
      expect(scenario.remoteChanges[`field_${i}`]).toBe(`remote_value_${i}`);
    });
  });

  it('should generate field-level conflict', () => {
    const injector = createConflictInjector();
    const scenario = injector.generateFieldConflict('doc-1', 'name', 'Alice', 'Bob');

    expect(scenario.documentId).toBe('doc-1');
    expect(scenario.localChanges).toEqual({ name: 'Alice' });
    expect(scenario.remoteChanges).toEqual({ name: 'Bob' });
  });
});

describe('ConsistencyChecker', () => {
  it('should detect no differences for matching data', () => {
    const checker = createConsistencyChecker();

    const clientA = createTestClient('a', { doc1: { name: 'Alice' } });
    const clientB = createTestClient('b', { doc1: { name: 'Alice' } });

    const diffs = checker.checkPairwise(clientA, clientB);
    expect(diffs).toHaveLength(0);
  });

  it('should detect field-level differences', () => {
    const checker = createConsistencyChecker();

    const clientA = createTestClient('a', { doc1: { name: 'Alice' } });
    const clientB = createTestClient('b', { doc1: { name: 'Bob' } });

    const diffs = checker.checkPairwise(clientA, clientB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('name');
    expect(diffs[0].localValue).toBe('Alice');
    expect(diffs[0].remoteValue).toBe('Bob');
  });

  it('should detect missing documents', () => {
    const checker = createConsistencyChecker();

    const clientA = createTestClient('a', { doc1: { name: 'Alice' } });
    const clientB = createTestClient('b', {});

    const diffs = checker.checkPairwise(clientA, clientB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('_exists');
  });

  it('should assert eventual consistency for matching clients', async () => {
    const checker = createConsistencyChecker();

    const clientA = createTestClient('a', { doc1: 'value' });
    const clientB = createTestClient('b', { doc1: 'value' });

    const result = await checker.assertEventualConsistency([clientA, clientB], 100);
    expect(result.consistent).toBe(true);
    expect(result.differences).toHaveLength(0);
  });

  it('should detect inconsistency across clients', async () => {
    const checker = createConsistencyChecker();

    const clientA = createTestClient('a', { doc1: 'value-a' });
    const clientB = createTestClient('b', { doc1: 'value-b' });

    const result = await checker.assertEventualConsistency([clientA, clientB], 100);
    expect(result.consistent).toBe(false);
    expect(result.differences.length).toBeGreaterThan(0);
  });

  it('should assert document exists', () => {
    const checker = createConsistencyChecker();
    const client = createTestClient('a', { 'users:user-1': { name: 'Alice' } });

    expect(() => checker.assertDocumentExists(client, 'users', 'user-1')).not.toThrow();
    expect(() => checker.assertDocumentExists(client, 'users', 'user-2')).toThrow('not found');
  });

  it('should assert document equals', () => {
    const checker = createConsistencyChecker();
    const client = createTestClient('a', { 'users:user-1': { name: 'Alice' } });

    expect(() => checker.assertDocumentEquals(client, 'users', 'user-1', { name: 'Alice' })).not.toThrow();
    expect(() => checker.assertDocumentEquals(client, 'users', 'user-1', { name: 'Bob' })).toThrow('does not match');
  });
});

describe('SyncTestHarness', () => {
  let harness: ReturnType<typeof createSyncTestHarness>;

  beforeEach(() => {
    harness = createSyncTestHarness();
  });

  it('should create clients', () => {
    const client = harness.createClient('client-1');

    expect(client.id).toBe('client-1');
    expect(client.getData().size).toBe(0);
    expect(harness.clients).toHaveLength(1);
  });

  it('should create server', () => {
    const server = harness.createServer();

    expect(server.getData().size).toBe(0);
    expect(server.getChanges()).toHaveLength(0);
  });

  it('should apply changes to client', () => {
    const client = harness.createClient('client-1');
    client.applyChange({ doc1: { name: 'Alice' } });

    expect(client.getData().get('doc1')).toEqual({ name: 'Alice' });
  });

  it('should apply changes to server', () => {
    const server = harness.createServer();
    server.applyChange({ doc1: { name: 'Alice' } });

    expect(server.getData().get('doc1')).toEqual({ name: 'Alice' });
    expect(server.getChanges()).toHaveLength(1);
  });

  it('should sync all clients with server', async () => {
    const client1 = harness.createClient('client-1');
    const client2 = harness.createClient('client-2');
    harness.createServer();

    client1.applyChange({ doc1: 'value-1' });
    client2.applyChange({ doc2: 'value-2' });

    await harness.syncAll();

    // Both clients should have both documents after sync
    expect(client1.getData().get('doc1')).toBe('value-1');
    expect(client1.getData().get('doc2')).toBe('value-2');
    expect(client2.getData().get('doc1')).toBe('value-1');
    expect(client2.getData().get('doc2')).toBe('value-2');
  });

  it('should verify consistency after sync', async () => {
    const checker = createConsistencyChecker();
    const client1 = harness.createClient('client-1');
    const client2 = harness.createClient('client-2');
    harness.createServer();

    client1.applyChange({ doc1: 'shared-value' });
    await harness.syncAll();

    const result = await checker.assertEventualConsistency([client1, client2], 100);
    expect(result.consistent).toBe(true);
  });

  it('should track timeline events', () => {
    harness.createClient('client-1');
    const client2 = harness.createClient('client-2');
    client2.applyChange({ doc1: 'value' });

    const timeline = harness.getTimeline();
    expect(timeline.events.length).toBeGreaterThanOrEqual(3);

    const eventTypes = timeline.events.map((e) => e.type);
    expect(eventTypes).toContain('client-created');
    expect(eventTypes).toContain('change');
  });

  it('should reset harness state', () => {
    harness.createClient('client-1');
    harness.reset();

    expect(harness.clients).toHaveLength(0);
  });

  it('should destroy harness', () => {
    harness.createClient('client-1');
    harness.destroy();

    expect(harness.clients).toHaveLength(0);
  });
});

// Helper to create test clients for consistency checks
function createTestClient(id: string, initialData: Record<string, unknown>) {
  const data = new Map<string, unknown>(Object.entries(initialData));
  return {
    id,
    data,
    applyChange(change: Record<string, unknown>): void {
      for (const [key, value] of Object.entries(change)) {
        data.set(key, value);
      }
    },
    getData(): Map<string, unknown> {
      return data;
    },
  };
}

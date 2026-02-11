import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScenarioRunner, LATENCY_PROFILES, ScenarioRunner } from '../scenario-runner.js';

describe('ScenarioRunner', () => {
  let runner: ScenarioRunner;

  beforeEach(() => {
    runner = createScenarioRunner();
  });

  afterEach(() => {
    runner.destroy();
  });

  it('should define and list scenarios', () => {
    runner.defineScenario({
      name: 'basic',
      steps: [{ action: 'create-clients', count: 2 }],
    });
    expect(runner.getScenarios()).toEqual(['basic']);
  });

  it('should create clients and insert data', async () => {
    runner.defineScenario({
      name: 'insert-test',
      steps: [
        { action: 'create-clients', count: 2 },
        { action: 'insert', client: 0, data: { key1: 'value1' } },
        { action: 'assert-value', client: 0, key: 'key1', expected: 'value1' },
        { action: 'assert-count', client: 0, expectedCount: 1 },
      ],
    });

    const result = await runner.run('insert-test');
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(4);
  });

  it('should sync data between online clients', async () => {
    runner.defineScenario({
      name: 'sync-test',
      steps: [
        { action: 'create-clients', count: 3 },
        { action: 'insert', client: 0, data: { x: 1 } },
        { action: 'insert', client: 1, data: { y: 2 } },
        { action: 'sync' },
        { action: 'assert-consistency' },
      ],
    });

    const result = await runner.run('sync-test');
    expect(result.success).toBe(true);
  });

  it('should handle network partitions', async () => {
    runner.defineScenario({
      name: 'partition-test',
      steps: [
        { action: 'create-clients', count: 3 },
        { action: 'insert', client: 0, data: { a: 1 } },
        { action: 'sync' },
        // Partition client 1
        { action: 'network', condition: 'offline', clients: [1] },
        // Insert on client 0 while client 1 is offline
        { action: 'insert', client: 0, data: { b: 2 } },
        { action: 'sync' },
        // Client 2 should have 'b', but client 1 should not
        { action: 'assert-value', client: 2, key: 'b', expected: 2 },
        // Bring client 1 back online
        { action: 'network', condition: 'online', clients: [1] },
        { action: 'sync' },
        { action: 'assert-consistency' },
      ],
    });

    const result = await runner.run('partition-test');
    expect(result.success).toBe(true);
  });

  it('should inject conflicts', async () => {
    runner.defineScenario({
      name: 'conflict-test',
      steps: [
        { action: 'create-clients', count: 2 },
        { action: 'inject-conflict', key: 'doc1', localValue: 'v1', remoteValue: 'v2' },
        { action: 'assert-value', client: 0, key: 'doc1', expected: 'v1' },
        { action: 'assert-value', client: 1, key: 'doc1', expected: 'v2' },
      ],
    });

    const result = await runner.run('conflict-test');
    expect(result.success).toBe(true);
  });

  it('should detect failed assertions', async () => {
    runner.defineScenario({
      name: 'fail-test',
      steps: [
        { action: 'create-clients', count: 1 },
        { action: 'assert-value', client: 0, key: 'missing', expected: 'nope' },
      ],
    });

    const result = await runner.run('fail-test');
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe(1);
    expect(result.steps[1]!.error).toContain('Value assertion failed');
  });

  it('should support delete action', async () => {
    runner.defineScenario({
      name: 'delete-test',
      steps: [
        { action: 'create-clients', count: 1 },
        { action: 'insert', client: 0, data: { a: 1, b: 2 } },
        { action: 'assert-count', client: 0, expectedCount: 2 },
        { action: 'delete', client: 0, key: 'a' },
        { action: 'assert-count', client: 0, expectedCount: 1 },
      ],
    });

    const result = await runner.run('delete-test');
    expect(result.success).toBe(true);
  });

  it('should support update action', async () => {
    runner.defineScenario({
      name: 'update-test',
      steps: [
        { action: 'create-clients', count: 1 },
        { action: 'insert', client: 0, data: { doc: { name: 'Alice', age: 30 } } },
        { action: 'update', client: 0, key: 'doc', data: { age: 31 } },
        { action: 'assert-value', client: 0, key: 'doc', expected: { name: 'Alice', age: 31 } },
      ],
    });

    const result = await runner.run('update-test');
    expect(result.success).toBe(true);
  });

  it('should deterministically replay with seed', async () => {
    runner.defineScenario({
      name: 'seed-test',
      steps: [
        { action: 'create-clients', count: 2 },
        { action: 'insert', client: 0, data: { x: 1 } },
        { action: 'sync' },
        { action: 'assert-consistency' },
      ],
    });

    const r1 = await runner.run('seed-test', 12345);
    const r2 = await runner.replay({ scenarioName: 'seed-test', seed: 12345, steps: [] });

    expect(r1.success).toBe(r2.success);
    expect(r1.steps.length).toBe(r2.steps.length);
  });

  it('should expose predefined latency profiles', () => {
    expect(LATENCY_PROFILES['4g']).toBeDefined();
    expect(LATENCY_PROFILES['3g']!.minLatencyMs).toBe(100);
    expect(LATENCY_PROFILES['satellite']!.packetLossRate).toBe(0.03);
    expect(runner.getProfile('lan')).toBeDefined();
  });

  it('should emit step events', async () => {
    const events: string[] = [];
    runner.onStep$.subscribe((s) => events.push(s.action));

    runner.defineScenario({
      name: 'events-test',
      steps: [
        { action: 'create-clients', count: 1 },
        { action: 'insert', client: 0, data: { a: 1 } },
      ],
    });

    await runner.run('events-test');
    expect(events).toEqual(['create-clients', 'insert']);
  });

  it('should track results history', async () => {
    runner.defineScenario({
      name: 'hist-test',
      steps: [{ action: 'create-clients', count: 1 }],
    });

    await runner.run('hist-test');
    await runner.run('hist-test');
    expect(runner.getResults()).toHaveLength(2);
  });
});

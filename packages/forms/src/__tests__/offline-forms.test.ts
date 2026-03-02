import { describe, expect, it } from 'vitest';
import { createOfflineFormManager } from '../offline-form-manager.js';
import type {
  OfflineFormConfig,
  OfflineFormSnapshot,
  OfflineFormState,
} from '../offline-form-types.js';

describe('OfflineFormManager', () => {
  const defaultConfig: OfflineFormConfig = {
    formId: 'test-form',
    nodeId: 'node-a',
  };

  it('should create with initial values', () => {
    const manager = createOfflineFormManager(defaultConfig, { name: 'Alice', age: 30 });
    const values = manager.getValues();
    expect(values.name).toBe('Alice');
    expect(values.age).toBe(30);
  });

  it('should set and get field values', () => {
    const manager = createOfflineFormManager(defaultConfig);
    manager.setValue('name', 'Bob');
    expect(manager.getValues().name).toBe('Bob');
  });

  it('should track pending changes', () => {
    const manager = createOfflineFormManager(defaultConfig);
    manager.setValue('name', 'Alice');
    manager.setValue('email', 'alice@test.com');
    expect(manager.getState().pendingChanges).toBe(2);
  });

  it('should handle counter fields', () => {
    const config: OfflineFormConfig = {
      ...defaultConfig,
      fieldTypes: { likes: { type: 'counter' } },
    };
    const manager = createOfflineFormManager(config, { likes: 0 });
    manager.increment('likes', 5);
    manager.decrement('likes', 2);
    expect(manager.getValues().likes).toBe(3);
  });

  it('should generate and apply snapshots', () => {
    const managerA = createOfflineFormManager(
      { formId: 'form', nodeId: 'node-a' },
      { name: 'Alice' }
    );
    const managerB = createOfflineFormManager(
      { formId: 'form', nodeId: 'node-b' },
      { name: 'Bob' }
    );

    managerA.setValue('name', 'Alice Updated');
    const snapshot = managerA.getSnapshot();

    // Apply A's changes to B (A's clock > B's initial, so A wins)
    managerB.applyRemote(snapshot);
    expect(managerB.getValues().name).toBe('Alice Updated');
  });

  it('should detect concurrent conflicts', () => {
    const managerA = createOfflineFormManager({ formId: 'form', nodeId: 'node-a' });
    const managerB = createOfflineFormManager({ formId: 'form', nodeId: 'node-b' });

    // Both write concurrently (no prior sync)
    managerA.setValue('title', 'Version A');
    managerB.setValue('title', 'Version B');

    const snapshotB = managerB.getSnapshot();
    const result = managerA.applyRemote(snapshotB);
    expect(result.hadConflict).toBe(true);
  });

  it('should resolve conflicts', () => {
    const manager = createOfflineFormManager(defaultConfig);
    manager.setValue('title', 'Local');

    const remoteSnapshot: OfflineFormSnapshot = {
      fieldStates: {},
      vectorClock: { 'node-b': 1 },
      timestamp: Date.now(),
    };

    manager.applyRemote(remoteSnapshot);
    manager.resolveConflict('title', 'Resolved');
    expect(manager.getValues().title).toBe('Resolved');
    expect(manager.getState().hasConflicts).toBe(false);
  });

  it('should resolve all conflicts with strategy', () => {
    const manager = createOfflineFormManager(defaultConfig);
    manager.setValue('a', 'localA');
    manager.setValue('b', 'localB');

    const remoteSnapshot: OfflineFormSnapshot = {
      formId: 'test-form',
      nodeId: 'node-b',
      values: { a: 'remoteA', b: 'remoteB' },
      fieldStates: {},
      vectorClock: { 'node-b': 1 },
      timestamp: Date.now(),
    };

    manager.applyRemote(remoteSnapshot);
    manager.resolveAllConflicts('local');
    expect(manager.getState().hasConflicts).toBe(false);
  });

  it('should merge counter fields without conflict', () => {
    const config: OfflineFormConfig = {
      formId: 'form',
      nodeId: 'node-a',
      fieldTypes: { count: { type: 'counter' } },
    };
    const managerA = createOfflineFormManager(config, { count: 0 });
    managerA.increment('count', 10);

    const configB: OfflineFormConfig = {
      formId: 'form',
      nodeId: 'node-b',
      fieldTypes: { count: { type: 'counter' } },
    };
    const managerB = createOfflineFormManager(configB, { count: 0 });
    managerB.increment('count', 5);

    const snapshotB = managerB.getSnapshot();
    const result = managerA.applyRemote(snapshotB);
    // Counters merge without conflict: 10 (node-a) + 5 (node-b) = 15
    expect(result.hadConflict).toBe(false);
    expect(managerA.getValues().count).toBe(15);
  });

  it('should reset state', () => {
    const manager = createOfflineFormManager(defaultConfig, { name: 'Test' });
    manager.setValue('name', 'Changed');
    manager.reset();
    expect(manager.getValues()).toEqual({});
    expect(manager.getState().pendingChanges).toBe(0);
  });

  it('should emit state updates via observable', () => {
    const manager = createOfflineFormManager(defaultConfig);
    const states: OfflineFormState[] = [];

    const sub = manager.state.subscribe((s) => states.push(s));
    manager.setValue('name', 'Alice');
    manager.setValue('email', 'alice@test.com');
    sub.unsubscribe();

    // Initial + 2 changes
    expect(states.length).toBeGreaterThanOrEqual(2);
  });

  it('should destroy cleanly', () => {
    const manager = createOfflineFormManager(defaultConfig);
    expect(() => manager.destroy()).not.toThrow();
  });
});

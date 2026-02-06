import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AwarenessProtocol, createAwarenessProtocol } from '../awareness.js';

describe('AwarenessProtocol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('set and get local state', () => {
    it('should set and get local state', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ user: { name: 'Alice' }, cursor: { x: 10, y: 20 } });

      const state = awareness.getLocalState();
      expect(state).toEqual({ user: { name: 'Alice' }, cursor: { x: 10, y: 20 } });

      awareness.destroy();
    });

    it('should return null when local state is not set', () => {
      const awareness = createAwarenessProtocol();

      expect(awareness.getLocalState()).toBeNull();

      awareness.destroy();
    });

    it('should return a copy of local state', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ value: 1 });

      const state1 = awareness.getLocalState();
      const state2 = awareness.getLocalState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);

      awareness.destroy();
    });

    it('should update local state when called multiple times', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ step: 1 });
      awareness.setLocalState({ step: 2 });

      expect(awareness.getLocalState()).toEqual({ step: 2 });

      awareness.destroy();
    });
  });

  describe('handle remote state updates', () => {
    it('should handle incoming state update from remote client', () => {
      const awareness = createAwarenessProtocol();

      awareness.onUpdate('user-2', { user: { name: 'Bob' }, cursor: { x: 50, y: 80 } });

      const states = awareness.getStates();
      expect(states.size).toBe(1);
      expect(states.get('user-2')).toEqual({ user: { name: 'Bob' }, cursor: { x: 50, y: 80 } });

      awareness.destroy();
    });

    it('should handle updates from multiple remote clients', () => {
      const awareness = createAwarenessProtocol();

      awareness.onUpdate('user-2', { name: 'Bob' });
      awareness.onUpdate('user-3', { name: 'Charlie' });

      const states = awareness.getStates();
      expect(states.size).toBe(2);

      awareness.destroy();
    });

    it('should update existing remote state', () => {
      const awareness = createAwarenessProtocol();

      awareness.onUpdate('user-2', { cursor: { x: 10, y: 20 } });
      awareness.onUpdate('user-2', { cursor: { x: 30, y: 40 } });

      const states = awareness.getStates();
      expect(states.size).toBe(1);
      expect(states.get('user-2')).toEqual({ cursor: { x: 30, y: 40 } });

      awareness.destroy();
    });
  });

  describe('remove state', () => {
    it('should remove a client state', () => {
      const awareness = createAwarenessProtocol();

      awareness.onUpdate('user-2', { name: 'Bob' });
      awareness.onUpdate('user-3', { name: 'Charlie' });

      awareness.removeState('user-2');

      const states = awareness.getStates();
      expect(states.size).toBe(1);
      expect(states.has('user-2')).toBe(false);
      expect(states.has('user-3')).toBe(true);

      awareness.destroy();
    });

    it('should be a no-op for non-existent client', () => {
      const awareness = createAwarenessProtocol();

      awareness.removeState('non-existent');

      expect(awareness.getStates().size).toBe(0);

      awareness.destroy();
    });
  });

  describe('get all states', () => {
    it('should include both local and remote states', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ role: 'editor' });
      awareness.onUpdate('user-2', { role: 'viewer' });

      const states = awareness.getStates();
      expect(states.size).toBe(2);

      awareness.destroy();
    });

    it('should return a copy of the states map', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ value: 1 });

      const states1 = awareness.getStates();
      const states2 = awareness.getStates();
      expect(states1).not.toBe(states2);

      awareness.destroy();
    });

    it('should return empty map when no states', () => {
      const awareness = createAwarenessProtocol();

      expect(awareness.getStates().size).toBe(0);

      awareness.destroy();
    });
  });

  describe('states$ observable', () => {
    it('should emit initial empty state', () => {
      const awareness = createAwarenessProtocol();
      const emissions: Map<string, Record<string, unknown>>[] = [];

      awareness.states$.subscribe((s) => {
        emissions.push(s);
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].size).toBe(0);

      awareness.destroy();
    });

    it('should emit when local state is set', () => {
      const awareness = createAwarenessProtocol();
      const emissions: Map<string, Record<string, unknown>>[] = [];

      awareness.states$.subscribe((s) => {
        emissions.push(s);
      });

      awareness.setLocalState({ cursor: { x: 10, y: 20 } });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(1);

      awareness.destroy();
    });

    it('should emit when remote state is updated', () => {
      const awareness = createAwarenessProtocol();
      const emissions: Map<string, Record<string, unknown>>[] = [];

      awareness.states$.subscribe((s) => {
        emissions.push(s);
      });

      awareness.onUpdate('user-2', { name: 'Bob' });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(1);

      awareness.destroy();
    });

    it('should emit when state is removed', () => {
      const awareness = createAwarenessProtocol();

      awareness.onUpdate('user-2', { name: 'Bob' });

      const emissions: Map<string, Record<string, unknown>>[] = [];
      awareness.states$.subscribe((s) => {
        emissions.push(s);
      });

      awareness.removeState('user-2');

      // Subscribe emission + remove emission
      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(0);

      awareness.destroy();
    });

    it('should complete on destroy', () => {
      const awareness = createAwarenessProtocol();
      let completed = false;

      awareness.states$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      awareness.destroy();

      expect(completed).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should clear all states on destroy', () => {
      const awareness = createAwarenessProtocol();

      awareness.setLocalState({ value: 1 });
      awareness.onUpdate('user-2', { value: 2 });

      awareness.destroy();

      expect(awareness.getStates().size).toBe(0);
      expect(awareness.getLocalState()).toBeNull();
    });

    it('should prevent setLocalState after destroy', () => {
      const awareness = createAwarenessProtocol();

      awareness.destroy();
      awareness.setLocalState({ value: 1 });

      expect(awareness.getLocalState()).toBeNull();
    });

    it('should prevent onUpdate after destroy', () => {
      const awareness = createAwarenessProtocol();

      awareness.destroy();
      awareness.onUpdate('user-2', { value: 1 });

      expect(awareness.getStates().size).toBe(0);
    });
  });

  describe('createAwarenessProtocol factory', () => {
    it('should create instance with default config', () => {
      const awareness = createAwarenessProtocol();
      expect(awareness).toBeInstanceOf(AwarenessProtocol);
      awareness.destroy();
    });

    it('should create instance with custom config', () => {
      const awareness = createAwarenessProtocol({ cleanupInterval: 60000 });
      expect(awareness).toBeInstanceOf(AwarenessProtocol);
      awareness.destroy();
    });
  });
});

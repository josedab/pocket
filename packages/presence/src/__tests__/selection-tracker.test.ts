import { describe, it, expect } from 'vitest';
import {
  SelectionTracker,
  createSelectionTracker,
  type SelectionInfo,
} from '../selection-tracker.js';

describe('SelectionTracker', () => {
  describe('trackSelection', () => {
    it('should track a selection for a user', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 10, end: 25, elementId: 'editor', color: '#E91E63' });

      const selection = tracker.getSelectionForUser('user-1');
      expect(selection).toBeDefined();
      expect(selection!.userId).toBe('user-1');
      expect(selection!.start).toBe(10);
      expect(selection!.end).toBe(25);
      expect(selection!.elementId).toBe('editor');
      expect(selection!.color).toBe('#E91E63');

      tracker.destroy();
    });

    it('should track multiple users', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-2', { start: 20, end: 30 });
      tracker.trackSelection('user-3', { start: 40, end: 50 });

      const selections = tracker.getSelections();
      expect(selections.size).toBe(3);

      tracker.destroy();
    });

    it('should update existing selection for same user', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-1', { start: 5, end: 15 });

      const selections = tracker.getSelections();
      expect(selections.size).toBe(1);
      expect(selections.get('user-1')!.start).toBe(5);
      expect(selections.get('user-1')!.end).toBe(15);

      tracker.destroy();
    });

    it('should respect maxSelections limit', () => {
      const tracker = createSelectionTracker({ maxSelections: 2 });

      tracker.trackSelection('user-1', { start: 0, end: 5 });
      tracker.trackSelection('user-2', { start: 10, end: 15 });
      tracker.trackSelection('user-3', { start: 20, end: 25 });

      const selections = tracker.getSelections();
      expect(selections.size).toBe(2);
      expect(selections.has('user-3')).toBe(false);

      tracker.destroy();
    });

    it('should allow updating when at maxSelections', () => {
      const tracker = createSelectionTracker({ maxSelections: 2 });

      tracker.trackSelection('user-1', { start: 0, end: 5 });
      tracker.trackSelection('user-2', { start: 10, end: 15 });

      // Updating existing user should work even at max
      tracker.trackSelection('user-1', { start: 3, end: 8 });

      const selections = tracker.getSelections();
      expect(selections.size).toBe(2);
      expect(selections.get('user-1')!.start).toBe(3);

      tracker.destroy();
    });
  });

  describe('clearSelection', () => {
    it('should clear selection for a specific user', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-2', { start: 20, end: 30 });

      tracker.clearSelection('user-1');

      const selections = tracker.getSelections();
      expect(selections.size).toBe(1);
      expect(selections.has('user-1')).toBe(false);
      expect(selections.has('user-2')).toBe(true);

      tracker.destroy();
    });

    it('should be a no-op for non-existent user', () => {
      const tracker = createSelectionTracker();

      tracker.clearSelection('non-existent');

      expect(tracker.getSelections().size).toBe(0);

      tracker.destroy();
    });
  });

  describe('getSelections', () => {
    it('should return all active selections', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-2', { start: 20, end: 30 });

      const selections = tracker.getSelections();
      expect(selections.size).toBe(2);
      expect(selections.get('user-1')!.start).toBe(0);
      expect(selections.get('user-2')!.start).toBe(20);

      tracker.destroy();
    });

    it('should return a copy, not a reference', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });

      const selections1 = tracker.getSelections();
      const selections2 = tracker.getSelections();
      expect(selections1).not.toBe(selections2);

      tracker.destroy();
    });

    it('should return empty map when no selections', () => {
      const tracker = createSelectionTracker();

      expect(tracker.getSelections().size).toBe(0);

      tracker.destroy();
    });
  });

  describe('getSelectionForUser', () => {
    it('should return selection for a specific user', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 5, end: 15 });

      const selection = tracker.getSelectionForUser('user-1');
      expect(selection).toBeDefined();
      expect(selection!.start).toBe(5);
      expect(selection!.end).toBe(15);

      tracker.destroy();
    });

    it('should return undefined for non-existent user', () => {
      const tracker = createSelectionTracker();

      expect(tracker.getSelectionForUser('unknown')).toBeUndefined();

      tracker.destroy();
    });
  });

  describe('selections$ observable', () => {
    it('should emit initial empty state', () => {
      const tracker = createSelectionTracker();
      const emissions: Map<string, SelectionInfo>[] = [];

      tracker.selections$.subscribe((s) => {
        emissions.push(s);
      });

      // BehaviorSubject emits current value on subscribe
      expect(emissions).toHaveLength(1);
      expect(emissions[0].size).toBe(0);

      tracker.destroy();
    });

    it('should emit on track selection', () => {
      const tracker = createSelectionTracker();
      const emissions: Map<string, SelectionInfo>[] = [];

      tracker.selections$.subscribe((s) => {
        emissions.push(s);
      });

      tracker.trackSelection('user-1', { start: 0, end: 10 });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(1);
      expect(emissions[1].get('user-1')!.start).toBe(0);

      tracker.destroy();
    });

    it('should emit on clear selection', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });

      const emissions: Map<string, SelectionInfo>[] = [];
      tracker.selections$.subscribe((s) => {
        emissions.push(s);
      });

      tracker.clearSelection('user-1');

      // Subscribe emission + clear emission
      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(0);

      tracker.destroy();
    });

    it('should emit on clearAll', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-2', { start: 20, end: 30 });

      const emissions: Map<string, SelectionInfo>[] = [];
      tracker.selections$.subscribe((s) => {
        emissions.push(s);
      });

      tracker.clearAll();

      // Subscribe emission + clearAll emission
      expect(emissions).toHaveLength(2);
      expect(emissions[1].size).toBe(0);

      tracker.destroy();
    });
  });

  describe('clearAll', () => {
    it('should clear all tracked selections', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });
      tracker.trackSelection('user-2', { start: 20, end: 30 });

      tracker.clearAll();

      expect(tracker.getSelections().size).toBe(0);

      tracker.destroy();
    });

    it('should be a no-op when already empty', () => {
      const tracker = createSelectionTracker();
      const emissions: Map<string, SelectionInfo>[] = [];

      tracker.selections$.subscribe((s) => {
        emissions.push(s);
      });

      tracker.clearAll();

      // Only BehaviorSubject initial emission (no extra emission for no-op)
      expect(emissions).toHaveLength(1);

      tracker.destroy();
    });
  });

  describe('destroy', () => {
    it('should clear all entries on destroy', () => {
      const tracker = createSelectionTracker();

      tracker.trackSelection('user-1', { start: 0, end: 10 });

      tracker.destroy();

      expect(tracker.getSelections().size).toBe(0);
    });

    it('should complete the observable on destroy', () => {
      const tracker = createSelectionTracker();
      let completed = false;

      tracker.selections$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      tracker.destroy();

      expect(completed).toBe(true);
    });

    it('should prevent trackSelection after destroy', () => {
      const tracker = createSelectionTracker();

      tracker.destroy();
      tracker.trackSelection('user-1', { start: 0, end: 10 });

      expect(tracker.getSelections().size).toBe(0);
    });
  });

  describe('createSelectionTracker factory', () => {
    it('should create instance with default config', () => {
      const tracker = createSelectionTracker();
      expect(tracker).toBeInstanceOf(SelectionTracker);
      tracker.destroy();
    });

    it('should create instance with custom config', () => {
      const tracker = createSelectionTracker({ throttleMs: 100, maxSelections: 10 });
      expect(tracker).toBeInstanceOf(SelectionTracker);
      tracker.destroy();
    });
  });
});

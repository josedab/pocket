/**
 * Time Travel Debugger - Navigate and replay database history
 */

import type { Document } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { HistoryTracker } from './history-tracker.js';
import type { ReplayOptions, Snapshot, TimeTravelEvent, TimeTravelState } from './types.js';

/**
 * Time Travel Debugger for navigating database history
 */
export class TimeTravelDebugger {
  private readonly tracker: HistoryTracker;
  private readonly state$ = new BehaviorSubject<TimeTravelState>({
    currentIndex: 0,
    totalEntries: 0,
    isTimeTraveling: false,
    currentSnapshot: null,
    checkpoints: [],
  });

  private readonly events$ = new Subject<TimeTravelEvent>();
  private isReplaying = false;
  private replayAbortController: AbortController | null = null;

  constructor(tracker: HistoryTracker) {
    this.tracker = tracker;

    // Sync state with tracker
    tracker.state.subscribe((trackerState) => {
      if (!this.state$.value.isTimeTraveling) {
        this.state$.next({
          ...this.state$.value,
          totalEntries: trackerState.totalEntries,
          checkpoints: trackerState.checkpoints,
        });
      }
    });
  }

  /**
   * Enter time travel mode
   */
  enterTimeTravel(): void {
    if (this.state$.value.isTimeTraveling) return;

    const trackerState = this.tracker.getCurrentState();

    this.state$.next({
      currentIndex: trackerState.totalEntries,
      totalEntries: trackerState.totalEntries,
      isTimeTraveling: true,
      currentSnapshot: null,
      checkpoints: trackerState.checkpoints,
    });

    this.emitEvent('time_travel_start');
  }

  /**
   * Exit time travel mode
   */
  exitTimeTravel(): void {
    if (!this.state$.value.isTimeTraveling) return;

    this.abortReplay();

    const trackerState = this.tracker.getCurrentState();

    this.state$.next({
      currentIndex: trackerState.totalEntries,
      totalEntries: trackerState.totalEntries,
      isTimeTraveling: false,
      currentSnapshot: null,
      checkpoints: trackerState.checkpoints,
    });

    this.emitEvent('time_travel_end');
  }

  /**
   * Travel to a specific history index
   */
  travelTo(index: number): Snapshot {
    if (!this.state$.value.isTimeTraveling) {
      this.enterTimeTravel();
    }

    const totalEntries = this.state$.value.totalEntries;
    const targetIndex = Math.max(0, Math.min(index, totalEntries));

    const snapshot = this.tracker.getSnapshotAtIndex(targetIndex);

    this.state$.next({
      ...this.state$.value,
      currentIndex: targetIndex,
      currentSnapshot: snapshot,
    });

    this.emitEvent('time_travel_to', { index: targetIndex, snapshot });

    return snapshot;
  }

  /**
   * Travel to a specific timestamp
   */
  travelToTime(timestamp: number): Snapshot | null {
    const history = this.tracker.getHistory();
    let targetIndex = 0;

    for (let i = 0; i < history.length; i++) {
      if (history[i]!.timestamp <= timestamp) {
        targetIndex = i + 1;
      } else {
        break;
      }
    }

    return this.travelTo(targetIndex);
  }

  /**
   * Travel to a checkpoint
   */
  travelToCheckpoint(checkpointId: string): Snapshot | null {
    const checkpoints = this.tracker.getCheckpoints();
    const checkpoint = checkpoints.find((c) => c.id === checkpointId);

    if (!checkpoint) return null;

    return this.travelTo(checkpoint.index);
  }

  /**
   * Step forward one entry
   */
  stepForward(): Snapshot | null {
    if (!this.state$.value.isTimeTraveling) {
      this.enterTimeTravel();
    }

    const { currentIndex, totalEntries } = this.state$.value;
    if (currentIndex >= totalEntries) return null;

    return this.travelTo(currentIndex + 1);
  }

  /**
   * Step backward one entry
   */
  stepBackward(): Snapshot | null {
    if (!this.state$.value.isTimeTraveling) {
      this.enterTimeTravel();
    }

    const { currentIndex } = this.state$.value;
    if (currentIndex <= 0) return null;

    return this.travelTo(currentIndex - 1);
  }

  /**
   * Go to the beginning of history
   */
  goToBeginning(): Snapshot {
    return this.travelTo(0);
  }

  /**
   * Go to the end of history (present)
   */
  goToPresent(): Snapshot {
    return this.travelTo(this.state$.value.totalEntries);
  }

  /**
   * Replay operations from current position
   */
  async replay(options: ReplayOptions = {}): Promise<void> {
    const { speed = 1, pauseBetweenOps = false, onOperation, onComplete, filter } = options;

    if (this.isReplaying) {
      throw new Error('Replay already in progress');
    }

    if (!this.state$.value.isTimeTraveling) {
      this.enterTimeTravel();
    }

    this.isReplaying = true;
    this.replayAbortController = new AbortController();
    const signal = this.replayAbortController.signal;

    this.emitEvent('replay_start');

    try {
      const history = this.tracker.getHistory();
      const { currentIndex, totalEntries } = this.state$.value;

      for (let i = currentIndex; i < totalEntries && !signal.aborted; i++) {
        const entry = history[i];
        if (!entry) continue;

        for (const op of entry.operations) {
          if (signal.aborted) break;
          if (filter && !filter(op)) continue;

          // Calculate delay based on timestamps and speed
          const baseDelay = pauseBetweenOps ? 500 : 0;
          const delay = Math.max(baseDelay / speed, 10);

          await this.sleep(delay);

          if (signal.aborted) break;

          // Move to this position
          this.travelTo(i + 1);

          // Notify callback
          onOperation?.(op);
        }
      }

      if (!signal.aborted) {
        onComplete?.();
        this.emitEvent('replay_end');
      }
    } finally {
      this.isReplaying = false;
      this.replayAbortController = null;
    }
  }

  /**
   * Abort ongoing replay
   */
  abortReplay(): void {
    this.replayAbortController?.abort();
    this.isReplaying = false;
    this.replayAbortController = null;
  }

  /**
   * Get document at current time travel position
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  getDocument<T extends Document>(collection: string, documentId: string): T | null {
    const snapshot = this.state$.value.currentSnapshot;
    if (!snapshot) {
      // Not time traveling, get from tracker's current state
      const currentSnapshot = this.tracker.getSnapshotAtIndex(
        this.tracker.getCurrentState().totalEntries
      );
      return (currentSnapshot.collections[collection]?.[documentId] as T) ?? null;
    }

    return (snapshot.collections[collection]?.[documentId] as T) ?? null;
  }

  /**
   * Get all documents in a collection at current position
   */
  getCollection<T extends Document>(collection: string): T[] {
    const snapshot = this.state$.value.currentSnapshot;
    if (!snapshot) {
      const currentSnapshot = this.tracker.getSnapshotAtIndex(
        this.tracker.getCurrentState().totalEntries
      );
      return Object.values(currentSnapshot.collections[collection] ?? {}) as T[];
    }

    return Object.values(snapshot.collections[collection] ?? {}) as T[];
  }

  /**
   * Get current snapshot
   */
  getCurrentSnapshot(): Snapshot | null {
    return this.state$.value.currentSnapshot;
  }

  /**
   * Check if currently time traveling
   */
  isTimeTraveling(): boolean {
    return this.state$.value.isTimeTraveling;
  }

  /**
   * Check if replaying
   */
  isReplayInProgress(): boolean {
    return this.isReplaying;
  }

  /**
   * Get state observable
   */
  get state(): Observable<TimeTravelState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state
   */
  getState(): TimeTravelState {
    return this.state$.value;
  }

  /**
   * Get events observable
   */
  get events(): Observable<TimeTravelEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get underlying tracker
   */
  getTracker(): HistoryTracker {
    return this.tracker;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Emit event
   */
  private emitEvent(type: TimeTravelEvent['type'], data?: unknown): void {
    this.events$.next({
      type,
      timestamp: Date.now(),
      data,
    });
  }

  /** Release resources */
  destroy(): void {
    this.state$.complete();
    this.events$.complete();
  }
}

/**
 * Create a time travel debugger
 */
export function createTimeTravelDebugger(tracker: HistoryTracker): TimeTravelDebugger {
  return new TimeTravelDebugger(tracker);
}

/**
 * Create both tracker and debugger
 */
export function createTimeTravel(config?: {
  maxHistorySize?: number;
  autoCheckpoint?: boolean;
  checkpointInterval?: number;
  enabled?: boolean;
}): {
  tracker: HistoryTracker;
  debugger: TimeTravelDebugger;
} {
  const tracker = new HistoryTracker(config);
  const debugger_ = new TimeTravelDebugger(tracker);

  return {
    tracker,
    debugger: debugger_,
  };
}

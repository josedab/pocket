/**
 * Selection Tracker for tracking user text/element selections in collaborative editing.
 *
 * Provides real-time tracking of selection ranges across users,
 * with observable streams for reactive updates.
 *
 * @module selection-tracker
 *
 * @example
 * ```typescript
 * import { createSelectionTracker } from '@pocket/presence';
 *
 * const tracker = createSelectionTracker({ throttleMs: 100 });
 *
 * tracker.trackSelection('user-1', {
 *   start: 10,
 *   end: 25,
 *   elementId: 'editor-1',
 *   color: '#E91E63',
 * });
 *
 * // Get all selections
 * const selections = tracker.getSelections();
 *
 * // Subscribe to changes
 * tracker.selections$.subscribe((allSelections) => {
 *   console.log('Selections changed:', allSelections);
 * });
 *
 * // Cleanup
 * tracker.destroy();
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

/**
 * Information about a user's selection.
 */
export interface SelectionInfo {
  /** User who owns this selection */
  userId: string;
  /** Start offset of the selection */
  start: number;
  /** End offset of the selection */
  end: number;
  /** Element or document the selection belongs to */
  elementId?: string;
  /** Color to render the selection highlight */
  color?: string;
  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Configuration for the selection tracker.
 */
export interface SelectionTrackerConfig {
  /** Throttle interval in ms for selection updates (default: 50) */
  throttleMs?: number;
  /** Maximum number of selections to track (default: 50) */
  maxSelections?: number;
}

/**
 * Default selection tracker configuration.
 */
const DEFAULT_SELECTION_CONFIG: Required<SelectionTrackerConfig> = {
  throttleMs: 50,
  maxSelections: 50,
};

/**
 * Tracks text/element selections for multiple users in a collaborative session.
 *
 * @example
 * ```typescript
 * const tracker = new SelectionTracker({ maxSelections: 20 });
 *
 * tracker.trackSelection('alice', { start: 0, end: 10, color: '#E91E63' });
 * tracker.trackSelection('bob', { start: 15, end: 30, color: '#2196F3' });
 *
 * const allSelections = tracker.getSelections();
 * // => Map { 'alice' => {...}, 'bob' => {...} }
 *
 * tracker.destroy();
 * ```
 */
export class SelectionTracker {
  private readonly config: Required<SelectionTrackerConfig>;
  private readonly selections = new Map<string, SelectionInfo>();
  private readonly selections$$ = new BehaviorSubject<Map<string, SelectionInfo>>(
    new Map()
  );
  private destroyed = false;

  constructor(config: SelectionTrackerConfig = {}) {
    this.config = { ...DEFAULT_SELECTION_CONFIG, ...config };
  }

  /**
   * Track a selection for a user.
   *
   * @param userId - The unique user identifier
   * @param selection - The selection range and metadata
   */
  trackSelection(
    userId: string,
    selection: { start: number; end: number; elementId?: string; color?: string }
  ): void {
    if (this.destroyed) return;

    if (
      this.selections.size >= this.config.maxSelections &&
      !this.selections.has(userId)
    ) {
      return;
    }

    const info: SelectionInfo = {
      userId,
      start: selection.start,
      end: selection.end,
      elementId: selection.elementId,
      color: selection.color,
      updatedAt: Date.now(),
    };

    this.selections.set(userId, info);
    this.emit();
  }

  /**
   * Clear the selection for a specific user.
   *
   * @param userId - The unique user identifier
   */
  clearSelection(userId: string): void {
    if (this.destroyed) return;

    if (this.selections.delete(userId)) {
      this.emit();
    }
  }

  /**
   * Get all active selections.
   *
   * @returns A Map of userId to SelectionInfo
   */
  getSelections(): Map<string, SelectionInfo> {
    return new Map(this.selections);
  }

  /**
   * Get selection for a specific user.
   *
   * @param userId - The unique user identifier
   * @returns The user's selection info or undefined
   */
  getSelectionForUser(userId: string): SelectionInfo | undefined {
    const info = this.selections.get(userId);
    return info ? { ...info } : undefined;
  }

  /**
   * Clear all tracked selections.
   */
  clearAll(): void {
    if (this.destroyed) return;

    if (this.selections.size > 0) {
      this.selections.clear();
      this.emit();
    }
  }

  /**
   * Observable that emits on any selection state change.
   *
   * Emits the complete Map of all current selections whenever
   * a selection is tracked, cleared, or removed.
   */
  get selections$(): Observable<Map<string, SelectionInfo>> {
    return this.selections$$.asObservable();
  }

  /**
   * Destroy the selection tracker and clean up resources.
   */
  destroy(): void {
    this.destroyed = true;
    this.selections.clear();
    this.selections$$.complete();
  }

  /**
   * Emit current selection state.
   */
  private emit(): void {
    if (this.destroyed) return;
    this.selections$$.next(new Map(this.selections));
  }
}

/**
 * Create a selection tracker instance.
 *
 * @param config - Optional configuration
 * @returns A new SelectionTracker instance
 */
export function createSelectionTracker(config?: SelectionTrackerConfig): SelectionTracker {
  return new SelectionTracker(config);
}

/**
 * Cursor Tracker for rendering multiplayer cursors
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { CursorPosition, CursorRenderOptions, PresenceUser, UserPresence } from './types.js';

/**
 * Tracked cursor state
 */
export interface TrackedCursor {
  /** User who owns the cursor */
  user: PresenceUser;
  /** Current position */
  position: CursorPosition;
  /** Whether cursor is visible */
  visible: boolean;
  /** Last update timestamp */
  lastUpdate: number;
  /** Interpolated position for smooth rendering */
  interpolatedPosition?: CursorPosition;
}

/**
 * Default render options
 */
const DEFAULT_RENDER_OPTIONS: Required<CursorRenderOptions> = {
  showLabel: true,
  labelFontSize: 12,
  cursorSize: 16,
  animationDuration: 100,
  zIndex: 1000,
};

/**
 * Tracks and renders multiplayer cursors
 */
export class CursorTracker {
  private readonly cursors = new Map<string, TrackedCursor>();
  private readonly cursors$ = new BehaviorSubject<TrackedCursor[]>([]);
  private readonly options: Required<CursorRenderOptions>;

  private animationFrame: number | null = null;
  private lastFrameTime = 0;
  private readonly interpolationSpeed = 0.15; // Smoothing factor

  constructor(options: CursorRenderOptions = {}) {
    this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
  }

  /**
   * Update cursor position for a user
   */
  updateCursor(user: PresenceUser, position: CursorPosition): void {
    const existing = this.cursors.get(user.id);
    const now = Date.now();

    if (existing) {
      existing.position = position;
      existing.lastUpdate = now;
      existing.visible = true;
    } else {
      this.cursors.set(user.id, {
        user,
        position,
        visible: true,
        lastUpdate: now,
        interpolatedPosition: { ...position },
      });
    }

    this.emitCursors();
  }

  /**
   * Update from presence data
   */
  updateFromPresence(presence: UserPresence): void {
    if (presence.cursor) {
      this.updateCursor(presence.user, presence.cursor);
    } else {
      this.hideCursor(presence.user.id);
    }
  }

  /**
   * Update multiple cursors from presence list
   */
  updateFromPresenceList(presences: UserPresence[]): void {
    const currentUserIds = new Set(presences.map((p) => p.user.id));

    // Update existing and add new
    for (const presence of presences) {
      if (presence.cursor) {
        this.updateCursor(presence.user, presence.cursor);
      }
    }

    // Remove cursors for users no longer present
    for (const userId of this.cursors.keys()) {
      if (!currentUserIds.has(userId)) {
        this.removeCursor(userId);
      }
    }
  }

  /**
   * Hide a user's cursor
   */
  hideCursor(userId: string): void {
    const cursor = this.cursors.get(userId);
    if (cursor) {
      cursor.visible = false;
      this.emitCursors();
    }
  }

  /**
   * Show a user's cursor
   */
  showCursor(userId: string): void {
    const cursor = this.cursors.get(userId);
    if (cursor) {
      cursor.visible = true;
      this.emitCursors();
    }
  }

  /**
   * Remove a user's cursor
   */
  removeCursor(userId: string): void {
    this.cursors.delete(userId);
    this.emitCursors();
  }

  /**
   * Get all tracked cursors
   */
  getCursors(): TrackedCursor[] {
    return Array.from(this.cursors.values());
  }

  /**
   * Get visible cursors only
   */
  getVisibleCursors(): TrackedCursor[] {
    return this.getCursors().filter((c) => c.visible);
  }

  /**
   * Get cursor for a specific user
   */
  getCursor(userId: string): TrackedCursor | undefined {
    return this.cursors.get(userId);
  }

  /**
   * Observable of cursor updates
   */
  get cursorsObservable(): Observable<TrackedCursor[]> {
    return this.cursors$.asObservable();
  }

  /**
   * Start smooth cursor interpolation animation
   */
  startAnimation(): void {
    if (this.animationFrame !== null) return;

    const animate = (time: number) => {
      const deltaTime = time - this.lastFrameTime;
      this.lastFrameTime = time;

      this.interpolateCursors(deltaTime);
      this.animationFrame = requestAnimationFrame(animate);
    };

    this.lastFrameTime = performance.now();
    this.animationFrame = requestAnimationFrame(animate);
  }

  /**
   * Stop cursor animation
   */
  stopAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Interpolate cursor positions for smooth rendering
   */
  private interpolateCursors(_deltaTime: number): void {
    let updated = false;

    for (const cursor of this.cursors.values()) {
      if (!cursor.interpolatedPosition) {
        cursor.interpolatedPosition = { ...cursor.position };
        continue;
      }

      // Interpolate x/y coordinates
      if (cursor.position.x !== undefined && cursor.interpolatedPosition.x !== undefined) {
        const dx = cursor.position.x - cursor.interpolatedPosition.x;
        if (Math.abs(dx) > 0.5) {
          cursor.interpolatedPosition.x += dx * this.interpolationSpeed;
          updated = true;
        } else {
          cursor.interpolatedPosition.x = cursor.position.x;
        }
      }

      if (cursor.position.y !== undefined && cursor.interpolatedPosition.y !== undefined) {
        const dy = cursor.position.y - cursor.interpolatedPosition.y;
        if (Math.abs(dy) > 0.5) {
          cursor.interpolatedPosition.y += dy * this.interpolationSpeed;
          updated = true;
        } else {
          cursor.interpolatedPosition.y = cursor.position.y;
        }
      }

      // For text positions, snap immediately (no interpolation)
      if (cursor.position.line !== undefined) {
        cursor.interpolatedPosition.line = cursor.position.line;
      }
      if (cursor.position.column !== undefined) {
        cursor.interpolatedPosition.column = cursor.position.column;
      }
      if (cursor.position.offset !== undefined) {
        cursor.interpolatedPosition.offset = cursor.position.offset;
      }
    }

    if (updated) {
      this.emitCursors();
    }
  }

  /**
   * Emit current cursor state
   */
  private emitCursors(): void {
    this.cursors$.next(this.getCursors());
  }

  /**
   * Generate CSS for a cursor element
   */
  generateCursorCSS(cursor: TrackedCursor): string {
    const pos = cursor.interpolatedPosition ?? cursor.position;

    const styles: string[] = [
      'position: absolute',
      'pointer-events: none',
      `z-index: ${this.options.zIndex}`,
      `transition: transform ${this.options.animationDuration}ms ease-out`,
    ];

    if (pos.x !== undefined && pos.y !== undefined) {
      styles.push(`transform: translate(${pos.x}px, ${pos.y}px)`);
    }

    return styles.join('; ');
  }

  /**
   * Generate SVG for cursor icon
   */
  generateCursorSVG(cursor: TrackedCursor): string {
    const color = cursor.user.color ?? '#000';
    const size = this.options.cursorSize;

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5 3.21V20.8c0 .45.54.67.86.36l4.4-4.4h6.24c.3 0 .54-.24.54-.54v-.17c0-.13-.05-.26-.15-.36L6.21 3.51c-.31-.31-.71-.09-.71.3z" fill="${color}"/>
        <path d="M5.5 3.21V20.8c0 .45.54.67.86.36l4.4-4.4h6.24c.3 0 .54-.24.54-.54v-.17c0-.13-.05-.26-.15-.36L6.21 3.51c-.31-.31-.71-.09-.71.3z" stroke="white" stroke-width="1.5"/>
      </svg>
    `;
  }

  /**
   * Generate label HTML for cursor
   */
  generateLabelHTML(cursor: TrackedCursor): string {
    if (!this.options.showLabel) return '';

    const name = cursor.user.name ?? cursor.user.id;
    const color = cursor.user.color ?? '#000';

    return `
      <div style="
        background: ${color};
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: ${this.options.labelFontSize}px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        white-space: nowrap;
        margin-top: 2px;
        margin-left: ${this.options.cursorSize - 2}px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      ">
        ${this.escapeHTML(name)}
      </div>
    `;
  }

  /**
   * Generate complete cursor element HTML
   */
  generateCursorHTML(cursor: TrackedCursor): string {
    return `
      <div class="pocket-cursor" data-user-id="${cursor.user.id}" style="${this.generateCursorCSS(cursor)}">
        ${this.generateCursorSVG(cursor)}
        ${this.generateLabelHTML(cursor)}
      </div>
    `;
  }

  /**
   * Escape HTML for safe rendering
   */
  private escapeHTML(str: string): string {
    const div = { textContent: str, innerHTML: '' };
    div.textContent = str;
    return div.textContent ?? str;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAnimation();
    this.cursors.clear();
    this.cursors$.complete();
  }

  /**
   * Get render options
   */
  getOptions(): Required<CursorRenderOptions> {
    return { ...this.options };
  }
}

/**
 * Create a cursor tracker
 */
export function createCursorTracker(options?: CursorRenderOptions): CursorTracker {
  return new CursorTracker(options);
}

/**
 * React-compatible cursor rendering hook factory
 */
export interface CursorHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useRef<T>(initial: T): { current: T };
}

/**
 * Create useCursors hook for React
 */
export function createUseCursorsHook(React: CursorHooks) {
  return function useCursors(tracker: CursorTracker) {
    const [cursors, setCursors] = React.useState<TrackedCursor[]>([]);

    React.useEffect(() => {
      const subscription = tracker.cursorsObservable.subscribe(setCursors);
      tracker.startAnimation();

      return () => {
        subscription.unsubscribe();
        tracker.stopAnimation();
      };
    }, [tracker]);

    return cursors;
  };
}

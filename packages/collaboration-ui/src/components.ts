/**
 * Collaboration UI SDK — framework-agnostic components and utilities
 * for rendering remote cursors, selections, and typing indicators.
 */

import { Subject, type Observable } from 'rxjs';

// ─── Color Assignment ────────────────────────────────────────────

const PALETTE = [
  '#E06C75',
  '#61AFEF',
  '#98C379',
  '#E5C07B',
  '#C678DD',
  '#56B6C2',
  '#D19A66',
  '#BE5046',
  '#7EC8E3',
  '#F0C674',
  '#B294BB',
  '#81A2BE',
  '#CC6666',
  '#A3BE8C',
  '#EBCB8B',
] as const;

/** Assign a stable color to a user ID. */
export function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

/** Check if a color has sufficient contrast against a background. */
export function hasContrast(fg: string, bg: string): boolean {
  const fgL = relativeLuminance(fg);
  const bgL = relativeLuminance(bg);
  const ratio = (Math.max(fgL, bgL) + 0.05) / (Math.min(fgL, bgL) + 0.05);
  return ratio >= 4.5; // WCAG AA
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// ─── Cursor State ────────────────────────────────────────────────

/** A remote user's cursor state. */
export interface CursorState {
  readonly userId: string;
  readonly displayName: string;
  readonly position: { x: number; y: number };
  readonly color: string;
  readonly lastUpdated: number;
  readonly isActive: boolean;
}

/** A remote user's text selection. */
export interface SelectionState {
  readonly userId: string;
  readonly displayName: string;
  readonly start: number;
  readonly end: number;
  readonly color: string;
  readonly lastUpdated: number;
}

/** Typing indicator state. */
export interface TypingState {
  readonly userId: string;
  readonly displayName: string;
  readonly isTyping: boolean;
  readonly lastTyped: number;
}

// ─── Cursor Overlay Data ─────────────────────────────────────────

/** Configuration for cursor rendering. */
export interface CursorOverlayConfig {
  /** How long before a cursor fades out (ms). Defaults to 30000. */
  readonly fadeTimeoutMs?: number;
  /** Whether to show user name labels. Defaults to true. */
  readonly showLabels?: boolean;
  /** Whether to animate cursor movements. Defaults to true. */
  readonly animate?: boolean;
  /** Custom color palette override. */
  readonly palette?: readonly string[];
}

/** CSS styles for a cursor element. */
export interface CursorStyles {
  readonly position: 'absolute';
  readonly left: string;
  readonly top: string;
  readonly backgroundColor: string;
  readonly opacity: string;
  readonly transition: string;
  readonly pointerEvents: 'none';
  readonly zIndex: number;
}

/** Generate CSS styles for a cursor at a position. */
export function cursorStyles(cursor: CursorState, config?: CursorOverlayConfig): CursorStyles {
  const fadeTimeout = config?.fadeTimeoutMs ?? 30000;
  const age = Date.now() - cursor.lastUpdated;
  const opacity = age > fadeTimeout ? 0 : age > fadeTimeout * 0.8 ? 0.3 : 1;
  const animate = config?.animate !== false;

  return {
    position: 'absolute',
    left: `${cursor.position.x}px`,
    top: `${cursor.position.y}px`,
    backgroundColor: cursor.color,
    opacity: String(opacity),
    transition: animate ? 'left 150ms ease, top 150ms ease, opacity 300ms ease' : 'none',
    pointerEvents: 'none',
    zIndex: 1000,
  };
}

/** Generate CSS styles for a selection highlight. */
export function selectionStyles(selection: SelectionState): {
  readonly backgroundColor: string;
  readonly opacity: string;
} {
  return {
    backgroundColor: selection.color,
    opacity: '0.25',
  };
}

// ─── Typing Indicator ────────────────────────────────────────────

/** Format a typing indicator message. */
export function formatTypingMessage(typingUsers: readonly TypingState[]): string {
  const active = typingUsers.filter((u) => u.isTyping);
  if (active.length === 0) return '';
  if (active.length === 1) return `${active[0]!.displayName} is typing...`;
  if (active.length === 2)
    return `${active[0]!.displayName} and ${active[1]!.displayName} are typing...`;
  return `${active[0]!.displayName} and ${active.length - 1} others are typing...`;
}

// ─── Presence Manager ────────────────────────────────────────────

/** Manages collaborative presence state for all connected users. */
export class CollaborationPresence {
  private readonly cursors = new Map<string, CursorState>();
  private readonly selections = new Map<string, SelectionState>();
  private readonly typing = new Map<string, TypingState>();
  private readonly changes$ = new Subject<{
    type: 'cursor' | 'selection' | 'typing';
    userId: string;
  }>();
  private readonly config: Required<CursorOverlayConfig>;

  constructor(config?: CursorOverlayConfig) {
    this.config = {
      fadeTimeoutMs: config?.fadeTimeoutMs ?? 30000,
      showLabels: config?.showLabels ?? true,
      animate: config?.animate ?? true,
      palette: config?.palette ?? [...PALETTE],
    };
  }

  /** Update a user's cursor position. */
  updateCursor(userId: string, displayName: string, x: number, y: number): void {
    this.cursors.set(userId, {
      userId,
      displayName,
      position: { x, y },
      color: assignColor(userId),
      lastUpdated: Date.now(),
      isActive: true,
    });
    this.changes$.next({ type: 'cursor', userId });
  }

  /** Update a user's text selection. */
  updateSelection(userId: string, displayName: string, start: number, end: number): void {
    this.selections.set(userId, {
      userId,
      displayName,
      start,
      end,
      color: assignColor(userId),
      lastUpdated: Date.now(),
    });
    this.changes$.next({ type: 'selection', userId });
  }

  /** Set a user's typing state. */
  setTyping(userId: string, displayName: string, isTyping: boolean): void {
    this.typing.set(userId, {
      userId,
      displayName,
      isTyping,
      lastTyped: Date.now(),
    });
    this.changes$.next({ type: 'typing', userId });
  }

  /** Remove a user from presence (disconnected). */
  removeUser(userId: string): void {
    this.cursors.delete(userId);
    this.selections.delete(userId);
    this.typing.delete(userId);
  }

  /** Get all active cursors. */
  getCursors(): readonly CursorState[] {
    return Array.from(this.cursors.values()).filter((c) => c.isActive);
  }

  /** Get all active selections. */
  getSelections(): readonly SelectionState[] {
    return Array.from(this.selections.values());
  }

  /** Get formatted typing message. */
  getTypingMessage(): string {
    return formatTypingMessage(Array.from(this.typing.values()));
  }

  /** Observable of all presence changes. */
  get changes(): Observable<{ type: string; userId: string }> {
    return this.changes$.asObservable();
  }

  /** Get CSS styles for a cursor. */
  getCursorStyles(userId: string): CursorStyles | null {
    const cursor = this.cursors.get(userId);
    if (!cursor) return null;
    return cursorStyles(cursor, this.config);
  }

  destroy(): void {
    this.changes$.complete();
  }
}

export function createCollaborationPresence(config?: CursorOverlayConfig): CollaborationPresence {
  return new CollaborationPresence(config);
}

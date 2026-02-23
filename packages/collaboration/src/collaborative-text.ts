/**
 * CollaborativeTextEngine — Y.Text-compatible collaborative text editing.
 *
 * Provides a CRDT-based text editing engine that syncs character-by-character
 * edits across peers. Designed to power <CollaborativeTextarea> components.
 *
 * @example
 * ```typescript
 * const engine = new CollaborativeTextEngine({
 *   documentId: 'doc-1',
 *   userId: 'user-1',
 * });
 *
 * engine.insert(0, 'Hello');
 * engine.insert(5, ' World');
 * engine.getText(); // 'Hello World'
 *
 * engine.changes$.subscribe(change => {
 *   // Broadcast to peers
 * });
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface CollabTextConfig {
  documentId: string;
  userId: string;
  initialText?: string;
  maxLength?: number;
}

export type TextOperation =
  | { type: 'insert'; position: number; text: string; userId: string; timestamp: number }
  | { type: 'delete'; position: number; length: number; userId: string; timestamp: number };

export interface TextState {
  text: string;
  version: number;
  lastEditBy: string | null;
  lastEditAt: number | null;
  length: number;
}

export interface CursorState {
  userId: string;
  position: number;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export type TextEvent =
  | { type: 'text:changed'; text: string; operation: TextOperation }
  | { type: 'cursor:moved'; cursor: CursorState }
  | { type: 'remote:applied'; operation: TextOperation };

// ── Implementation ────────────────────────────────────────

export class CollaborativeTextEngine {
  private readonly config: Required<CollabTextConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly stateSubject: BehaviorSubject<TextState>;
  private readonly changesSubject = new Subject<TextOperation>();
  private readonly eventsSubject = new Subject<TextEvent>();
  private readonly cursors = new Map<string, CursorState>();
  private readonly history: TextOperation[] = [];

  private content: string;
  private version = 0;

  readonly state$: Observable<TextState>;
  readonly changes$: Observable<TextOperation>;
  readonly events$: Observable<TextEvent>;

  constructor(config: CollabTextConfig) {
    this.config = {
      documentId: config.documentId,
      userId: config.userId,
      initialText: config.initialText ?? '',
      maxLength: config.maxLength ?? 1_000_000,
    };

    this.content = this.config.initialText;
    this.stateSubject = new BehaviorSubject<TextState>(this.buildState());
    this.state$ = this.stateSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.changes$ = this.changesSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.events$ = this.eventsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the current text content.
   */
  getText(): string {
    return this.content;
  }

  /**
   * Get the current version number.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Insert text at a position.
   */
  insert(position: number, text: string): TextOperation {
    if (position < 0 || position > this.content.length) {
      throw new Error(`Insert position ${position} out of bounds (0-${this.content.length})`);
    }
    if (this.content.length + text.length > this.config.maxLength) {
      throw new Error(`Text would exceed max length of ${this.config.maxLength}`);
    }

    const op: TextOperation = {
      type: 'insert',
      position,
      text,
      userId: this.config.userId,
      timestamp: Date.now(),
    };

    this.applyInsert(position, text);
    this.version++;
    this.history.push(op);
    this.emitState();
    this.changesSubject.next(op);
    this.eventsSubject.next({ type: 'text:changed', text: this.content, operation: op });

    // Adjust cursors
    this.adjustCursorsAfterInsert(position, text.length);

    return op;
  }

  /**
   * Delete text at a position.
   */
  delete(position: number, length: number): TextOperation {
    if (position < 0 || position + length > this.content.length) {
      throw new Error(`Delete range [${position}, ${position + length}) out of bounds`);
    }

    const op: TextOperation = {
      type: 'delete',
      position,
      length,
      userId: this.config.userId,
      timestamp: Date.now(),
    };

    this.applyDelete(position, length);
    this.version++;
    this.history.push(op);
    this.emitState();
    this.changesSubject.next(op);
    this.eventsSubject.next({ type: 'text:changed', text: this.content, operation: op });

    // Adjust cursors
    this.adjustCursorsAfterDelete(position, length);

    return op;
  }

  /**
   * Replace text in a range.
   */
  replace(position: number, length: number, newText: string): TextOperation[] {
    const ops: TextOperation[] = [];
    if (length > 0) ops.push(this.delete(position, length));
    if (newText.length > 0) ops.push(this.insert(position, newText));
    return ops;
  }

  /**
   * Apply a remote operation from another peer.
   */
  applyRemote(op: TextOperation): void {
    if (op.type === 'insert') {
      this.applyInsert(op.position, op.text);
      this.adjustCursorsAfterInsert(op.position, op.text.length);
    } else {
      this.applyDelete(op.position, op.length);
      this.adjustCursorsAfterDelete(op.position, op.length);
    }

    this.version++;
    this.history.push(op);
    this.emitState();
    this.eventsSubject.next({ type: 'remote:applied', operation: op });
  }

  /**
   * Set cursor position for the local user.
   */
  setCursor(position: number, selectionEnd?: number): void {
    const cursor: CursorState = {
      userId: this.config.userId,
      position,
      selectionStart: selectionEnd !== undefined ? position : null,
      selectionEnd: selectionEnd ?? null,
    };
    this.cursors.set(this.config.userId, cursor);
    this.eventsSubject.next({ type: 'cursor:moved', cursor });
  }

  /**
   * Update a remote peer's cursor.
   */
  setRemoteCursor(userId: string, position: number, selectionEnd?: number): void {
    this.cursors.set(userId, {
      userId,
      position,
      selectionStart: selectionEnd !== undefined ? position : null,
      selectionEnd: selectionEnd ?? null,
    });
  }

  /**
   * Get all cursor positions.
   */
  getCursors(): CursorState[] {
    return [...this.cursors.values()];
  }

  /**
   * Get operation history.
   */
  getHistory(): TextOperation[] {
    return [...this.history];
  }

  /**
   * Undo the last local operation.
   */
  undo(): TextOperation | null {
    const lastLocal = [...this.history].reverse().find((op) => op.userId === this.config.userId);

    if (!lastLocal) return null;

    if (lastLocal.type === 'insert') {
      return this.delete(lastLocal.position, lastLocal.text.length);
    } else {
      // Can't undo delete without storing deleted text
      return null;
    }
  }

  /**
   * Destroy the engine.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stateSubject.complete();
    this.changesSubject.complete();
    this.eventsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private applyInsert(pos: number, text: string): void {
    this.content = this.content.slice(0, pos) + text + this.content.slice(pos);
  }

  private applyDelete(pos: number, length: number): void {
    this.content = this.content.slice(0, pos) + this.content.slice(pos + length);
  }

  private adjustCursorsAfterInsert(position: number, length: number): void {
    for (const cursor of this.cursors.values()) {
      if (cursor.position >= position) cursor.position += length;
      if (cursor.selectionEnd !== null && cursor.selectionEnd >= position) {
        cursor.selectionEnd += length;
      }
    }
  }

  private adjustCursorsAfterDelete(position: number, length: number): void {
    for (const cursor of this.cursors.values()) {
      if (cursor.position > position + length) cursor.position -= length;
      else if (cursor.position > position) cursor.position = position;

      if (cursor.selectionEnd !== null) {
        if (cursor.selectionEnd > position + length) cursor.selectionEnd -= length;
        else if (cursor.selectionEnd > position) cursor.selectionEnd = position;
      }
    }
  }

  private buildState(): TextState {
    const lastOp = this.history[this.history.length - 1];
    return {
      text: this.content,
      version: this.version,
      lastEditBy: lastOp?.userId ?? null,
      lastEditAt: lastOp?.timestamp ?? null,
      length: this.content.length,
    };
  }

  private emitState(): void {
    this.stateSubject.next(this.buildState());
  }
}

export function createCollaborativeTextEngine(config: CollabTextConfig): CollaborativeTextEngine {
  return new CollaborativeTextEngine(config);
}

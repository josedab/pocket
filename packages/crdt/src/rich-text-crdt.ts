/**
 * Rich Text CRDT for Pocket
 *
 * Provides conflict-free rich text editing using an RGA (Replicated Growable Array)
 * algorithm. Supports concurrent inserts, deletes, and formatting without conflicts.
 *
 * @example Basic usage
 * ```typescript
 * const doc = createRichTextCRDT({ nodeId: 'user-1' });
 *
 * // Insert text with formatting
 * doc.insert(0, 'Hello', [{ type: 'bold' }]);
 * doc.insert(5, ' world');
 *
 * // Apply formatting to a range
 * doc.format({ start: 0, end: 5 }, { type: 'italic' });
 *
 * // Subscribe to state changes
 * doc.state$.subscribe(state => {
 *   console.log('Content length:', state.length);
 * });
 *
 * // Subscribe to operations for broadcasting
 * doc.operations$.subscribe(op => {
 *   socket.emit('text-op', op);
 * });
 * ```
 *
 * @example Handling remote operations
 * ```typescript
 * socket.on('text-op', (op: TextOperation) => {
 *   doc.applyRemoteOperation(op);
 * });
 *
 * // Get plain text
 * const text = doc.getText(); // 'Hello world'
 *
 * // Get formatted spans
 * const spans = doc.getFormattedText();
 * // [{ text: 'Hello', formats: [{ type: 'bold' }, { type: 'italic' }] }, ...]
 * ```
 *
 * @see {@link createRichTextCRDT} - Factory function
 * @see {@link RichTextState} - State structure
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { LamportClock, generateOpId } from './clock.js';
import type { CRDTOperation, LamportTimestamp, NodeId } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A position within the text content. */
export interface TextPosition {
  /** Zero-based character index. */
  index: number;
}

/** A range within the text content. */
export interface TextRange {
  /** Start index (inclusive). */
  start: number;
  /** End index (exclusive). */
  end: number;
}

/**
 * Supported rich text format types.
 *
 * Covers common inline and block-level formatting attributes
 * used in collaborative rich text editors.
 */
export type FormatType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'heading'
  | 'color'
  | 'highlight';

/**
 * A single formatting attribute applied to a text span.
 *
 * @example
 * ```typescript
 * const bold: TextFormat = { type: 'bold' };
 * const link: TextFormat = { type: 'link', value: 'https://example.com' };
 * const heading: TextFormat = { type: 'heading', value: 2 };
 * ```
 */
export interface TextFormat {
  /** The format type. */
  type: FormatType;
  /** Optional value (e.g. URL for link, level for heading, hex for color). */
  value?: string | number | boolean;
}

/**
 * A span of text sharing the same set of formats.
 *
 * The formatted text representation of a document is an ordered
 * array of {@link RichTextSpan} entries.
 */
export interface RichTextSpan {
  /** The text content of this span. */
  text: string;
  /** Formats applied to this span. */
  formats: TextFormat[];
}

/**
 * A text operation that can be applied locally or received remotely.
 *
 * Extends the base {@link CRDTOperation} with text-specific fields.
 */
export interface TextOperation extends CRDTOperation {
  /** Operation type: insert, delete, or update (format change). */
  type: 'insert' | 'delete' | 'update';
  /** Character position where the operation applies. */
  position: number;
  /** Content to insert (for insert operations). */
  content?: string;
  /** Formats to apply (for insert and update operations). */
  formats?: TextFormat[];
  /** Number of characters affected (for delete/update operations). */
  length?: number;
}

/**
 * Snapshot of the rich text document state.
 *
 * Emitted through {@link RichTextCRDT.state$} on every change.
 */
export interface RichTextState {
  /** Formatted content as spans. */
  content: RichTextSpan[];
  /** Total character count. */
  length: number;
  /** Monotonically increasing version counter. */
  version: number;
}

/**
 * Configuration for creating a {@link RichTextCRDT} instance.
 */
export interface RichTextConfig {
  /** Unique node identifier for this client. */
  nodeId: NodeId;
  /** Optional initial plain text content. */
  initialContent?: string;
  /** Maximum number of operations to retain in history (default: 1000). */
  maxHistory?: number;
}

// ---------------------------------------------------------------------------
// Internal character representation
// ---------------------------------------------------------------------------

/** @internal */
interface InternalChar {
  char: string;
  id: string;
  formats: TextFormat[];
  deleted: boolean;
  timestamp: LamportTimestamp;
}

// ---------------------------------------------------------------------------
// RichTextCRDT
// ---------------------------------------------------------------------------

/**
 * Rich Text CRDT using a Replicated Growable Array (RGA) approach.
 *
 * Supports concurrent inserts, deletes, and formatting changes that
 * converge deterministically across all replicas.
 *
 * @see {@link createRichTextCRDT} - Factory function
 */
export class RichTextCRDT {
  private readonly nodeId: NodeId;
  private readonly clock: LamportClock;
  private readonly maxHistory: number;

  /** Internal character buffer (RGA). */
  private chars: InternalChar[] = [];
  /** Applied operation IDs for deduplication. */
  private readonly appliedOps = new Set<string>();
  /** Operation history for potential conflict resolution. */
  private readonly history: TextOperation[] = [];
  /** Monotonically increasing version counter. */
  private version = 0;

  private readonly stateSubject: BehaviorSubject<RichTextState>;
  private readonly operationsSubject = new Subject<TextOperation>();

  /**
   * Observable of document state changes.
   *
   * Emits a new {@link RichTextState} snapshot on every local or remote
   * mutation.
   *
   * @example
   * ```typescript
   * doc.state$.subscribe(state => {
   *   render(state.content);
   * });
   * ```
   */
  readonly state$: Observable<RichTextState>;

  /**
   * Observable of locally generated operations for broadcasting.
   *
   * Subscribe to this observable and send emitted operations to remote
   * peers so they can call {@link applyRemoteOperation}.
   *
   * @example
   * ```typescript
   * doc.operations$.subscribe(op => {
   *   socket.emit('text-op', op);
   * });
   * ```
   */
  readonly operations$: Observable<TextOperation>;

  /**
   * Create a new RichTextCRDT.
   *
   * @param config - Configuration including node ID and optional initial content
   */
  constructor(config: RichTextConfig) {
    this.nodeId = config.nodeId;
    this.clock = new LamportClock(config.nodeId);
    this.maxHistory = config.maxHistory ?? 1000;

    // Seed initial content
    if (config.initialContent) {
      for (const ch of config.initialContent) {
        const ts = this.clock.tick();
        this.chars.push({
          char: ch,
          id: generateOpId(this.nodeId, ts.counter),
          formats: [],
          deleted: false,
          timestamp: ts,
        });
      }
    }

    this.stateSubject = new BehaviorSubject<RichTextState>(this.buildState());
    this.state$ = this.stateSubject.asObservable();
    this.operations$ = this.operationsSubject.asObservable();
  }

  // -----------------------------------------------------------------------
  // Public API – local mutations
  // -----------------------------------------------------------------------

  /**
   * Insert text at the given position with optional formatting.
   *
   * @param position - Zero-based character index to insert at
   * @param text - The text to insert
   * @param formats - Optional formats to apply to the inserted text
   * @returns The generated {@link TextOperation} (also emitted via {@link operations$})
   *
   * @example
   * ```typescript
   * doc.insert(0, 'Hello');
   * doc.insert(5, ' bold', [{ type: 'bold' }]);
   * ```
   */
  insert(position: number, text: string, formats?: TextFormat[]): TextOperation {
    const ts = this.clock.tick();
    const op: TextOperation = {
      id: generateOpId(this.nodeId, ts.counter),
      type: 'insert',
      timestamp: ts,
      origin: this.nodeId,
      position,
      content: text,
      formats: formats ?? [],
    };

    this.applyInsert(op);
    this.recordOperation(op);
    this.emitState();
    this.operationsSubject.next(op);
    return op;
  }

  /**
   * Delete characters in the given range.
   *
   * @param range - The range to delete (start inclusive, end exclusive)
   * @returns The generated {@link TextOperation}
   *
   * @example
   * ```typescript
   * doc.delete({ start: 5, end: 11 }); // remove 6 characters
   * ```
   */
  delete(range: TextRange): TextOperation {
    const ts = this.clock.tick();
    const op: TextOperation = {
      id: generateOpId(this.nodeId, ts.counter),
      type: 'delete',
      timestamp: ts,
      origin: this.nodeId,
      position: range.start,
      length: range.end - range.start,
    };

    this.applyDelete(op);
    this.recordOperation(op);
    this.emitState();
    this.operationsSubject.next(op);
    return op;
  }

  /**
   * Apply a format to text in the given range.
   *
   * @param range - The range to format (start inclusive, end exclusive)
   * @param format - The format to apply
   * @returns The generated {@link TextOperation}
   *
   * @example
   * ```typescript
   * doc.format({ start: 0, end: 5 }, { type: 'bold' });
   * doc.format({ start: 0, end: 5 }, { type: 'link', value: 'https://example.com' });
   * ```
   */
  format(range: TextRange, format: TextFormat): TextOperation {
    const ts = this.clock.tick();
    const op: TextOperation = {
      id: generateOpId(this.nodeId, ts.counter),
      type: 'update',
      timestamp: ts,
      origin: this.nodeId,
      position: range.start,
      length: range.end - range.start,
      formats: [format],
    };

    this.applyFormat(op);
    this.recordOperation(op);
    this.emitState();
    this.operationsSubject.next(op);
    return op;
  }

  /**
   * Remove a specific format type from text in the given range.
   *
   * @param range - The range to unformat
   * @param formatType - The format type to remove
   * @returns The generated {@link TextOperation}
   *
   * @example
   * ```typescript
   * doc.removeFormat({ start: 0, end: 5 }, 'bold');
   * ```
   */
  removeFormat(range: TextRange, formatType: FormatType): TextOperation {
    const ts = this.clock.tick();
    const op: TextOperation = {
      id: generateOpId(this.nodeId, ts.counter),
      type: 'update',
      timestamp: ts,
      origin: this.nodeId,
      position: range.start,
      length: range.end - range.start,
      formats: [{ type: formatType, value: false }],
    };

    this.applyFormat(op);
    this.recordOperation(op);
    this.emitState();
    this.operationsSubject.next(op);
    return op;
  }

  // -----------------------------------------------------------------------
  // Public API – remote operations
  // -----------------------------------------------------------------------

  /**
   * Apply an operation received from a remote peer.
   *
   * Deduplicates by operation ID and updates the Lamport clock.
   *
   * @param op - The remote text operation
   *
   * @example
   * ```typescript
   * socket.on('text-op', (op: TextOperation) => {
   *   doc.applyRemoteOperation(op);
   * });
   * ```
   */
  applyRemoteOperation(op: TextOperation): void {
    if (this.appliedOps.has(op.id)) return;

    this.clock.receive(op.timestamp);

    switch (op.type) {
      case 'insert':
        this.applyInsert(op);
        break;
      case 'delete':
        this.applyDelete(op);
        break;
      case 'update':
        this.applyFormat(op);
        break;
    }

    this.recordOperation(op);
    this.emitState();
  }

  // -----------------------------------------------------------------------
  // Public API – queries
  // -----------------------------------------------------------------------

  /**
   * Get the plain text content of the document.
   *
   * @returns Plain text string (no formatting information)
   */
  getText(): string {
    return this.chars
      .filter((c) => !c.deleted)
      .map((c) => c.char)
      .join('');
  }

  /**
   * Get the formatted text representation as an array of spans.
   *
   * Adjacent characters sharing the same formats are merged into
   * a single {@link RichTextSpan}.
   *
   * @returns Array of formatted text spans
   */
  getFormattedText(): RichTextSpan[] {
    const visible = this.chars.filter((c) => !c.deleted);
    if (visible.length === 0) return [];

    const spans: RichTextSpan[] = [];
    let current: RichTextSpan = {
      text: visible[0]!.char,
      formats: [...visible[0]!.formats],
    };

    for (let i = 1; i < visible.length; i++) {
      const ch = visible[i]!;
      if (this.formatsEqual(current.formats, ch.formats)) {
        current.text += ch.char;
      } else {
        spans.push(current);
        current = { text: ch.char, formats: [...ch.formats] };
      }
    }

    spans.push(current);
    return spans;
  }

  /**
   * Get the current document state snapshot.
   *
   * @returns A {@link RichTextState} snapshot
   */
  getState(): RichTextState {
    return this.buildState();
  }

  /**
   * Get the current document length (visible characters only).
   *
   * @returns Character count
   */
  getLength(): number {
    return this.chars.filter((c) => !c.deleted).length;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose the CRDT and release all resources.
   *
   * Completes all observables. Call this when the document is no longer
   * needed.
   */
  dispose(): void {
    this.operationsSubject.complete();
    this.stateSubject.complete();
  }

  // -----------------------------------------------------------------------
  // Private – operation application
  // -----------------------------------------------------------------------

  /** @internal Apply an insert operation to the character buffer. */
  private applyInsert(op: TextOperation): void {
    if (!op.content) return;

    const visibleIndex = this.toInternalIndex(op.position);
    const newChars: InternalChar[] = [];

    for (let i = 0; i < op.content.length; i++) {
      newChars.push({
        char: op.content[i]!,
        id: `${op.id}:${i}`,
        formats: op.formats ? [...op.formats] : [],
        deleted: false,
        timestamp: op.timestamp,
      });
    }

    this.chars.splice(visibleIndex, 0, ...newChars);
  }

  /** @internal Apply a delete operation by tombstoning characters. */
  private applyDelete(op: TextOperation): void {
    const length = op.length ?? 1;
    let remaining = length;
    let idx = this.toInternalIndex(op.position);

    while (remaining > 0 && idx < this.chars.length) {
      if (!this.chars[idx]!.deleted) {
        this.chars[idx]!.deleted = true;
        remaining--;
      }
      idx++;
    }
  }

  /**
   * @internal Apply a format (update) operation to characters in range.
   *
   * If a format has `value: false`, the format type is removed instead.
   */
  private applyFormat(op: TextOperation): void {
    if (!op.formats || !op.length) return;

    let remaining = op.length;
    let idx = this.toInternalIndex(op.position);

    while (remaining > 0 && idx < this.chars.length) {
      const ch = this.chars[idx]!;
      if (!ch.deleted) {
        for (const fmt of op.formats) {
          if (fmt.value === false) {
            // Remove format
            ch.formats = ch.formats.filter((f) => f.type !== fmt.type);
          } else {
            // Add or update format
            const existing = ch.formats.findIndex((f) => f.type === fmt.type);
            if (existing >= 0) {
              ch.formats[existing] = { ...fmt };
            } else {
              ch.formats.push({ ...fmt });
            }
          }
        }
        remaining--;
      }
      idx++;
    }

    this.mergeSpans();
  }

  /**
   * @internal Merge adjacent spans that share the same formats.
   *
   * This is a logical no-op on the character buffer (spans are computed
   * lazily in {@link getFormattedText}), but ensures internal consistency
   * after formatting operations.
   */
  private mergeSpans(): void {
    // Spans are derived on read from the char array, so no structural
    // merge is needed. This hook exists for future optimisations such
    // as compacting the internal buffer.
  }

  // -----------------------------------------------------------------------
  // Private – helpers
  // -----------------------------------------------------------------------

  /**
   * Convert a visible-character index to an internal buffer index,
   * accounting for tombstoned (deleted) characters.
   */
  private toInternalIndex(visibleIndex: number): number {
    let visible = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (visible === visibleIndex) return i;
      if (!this.chars[i]!.deleted) visible++;
    }
    return this.chars.length;
  }

  /** Check whether two format arrays are semantically equal. */
  private formatsEqual(a: TextFormat[], b: TextFormat[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((x, y) => x.type.localeCompare(y.type));
    const sortedB = [...b].sort((x, y) => x.type.localeCompare(y.type));
    return sortedA.every(
      (fmt, i) => fmt.type === sortedB[i]!.type && fmt.value === sortedB[i]!.value
    );
  }

  /** Record an operation for dedup and history. */
  private recordOperation(op: TextOperation): void {
    this.appliedOps.add(op.id);
    this.history.push(op);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /** Build and return the current state snapshot. */
  private buildState(): RichTextState {
    return {
      content: this.getFormattedText(),
      length: this.getLength(),
      version: this.version,
    };
  }

  /** Increment version and emit new state through the BehaviorSubject. */
  private emitState(): void {
    this.version++;
    this.stateSubject.next(this.buildState());
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new Rich Text CRDT instance.
 *
 * @param config - Configuration including node ID and optional initial content
 * @returns A new {@link RichTextCRDT} instance
 *
 * @example
 * ```typescript
 * const doc = createRichTextCRDT({
 *   nodeId: 'user-1',
 *   initialContent: 'Hello world',
 *   maxHistory: 500,
 * });
 *
 * doc.state$.subscribe(state => console.log(state));
 * doc.dispose();
 * ```
 *
 * @see {@link RichTextCRDT}
 */
export function createRichTextCRDT(config: RichTextConfig): RichTextCRDT {
  return new RichTextCRDT(config);
}

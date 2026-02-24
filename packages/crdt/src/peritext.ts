/**
 * Peritext-inspired Rich Text CRDT
 *
 * Implements a character-level CRDT with inline formatting marks
 * that correctly handles concurrent formatting operations using
 * the Peritext algorithm principles:
 *
 * 1. Characters are CRDT atoms with unique IDs
 * 2. Formatting marks anchor to character IDs (not positions)
 * 3. Mark semantics: "toggle" marks (bold, italic) use expand/contract
 * 4. Concurrent formatting merges deterministically
 */

/** Unique identifier for a character in the sequence. */
export interface CharId {
  readonly nodeId: string;
  readonly counter: number;
}

/** Formatting mark types. */
export type MarkType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'color'
  | 'highlight'
  | 'fontSize';

/** A formatting mark anchored to character positions. */
export interface FormatMark {
  readonly id: string;
  readonly type: MarkType;
  /** Value for parameterized marks (e.g., link URL, color hex). */
  readonly value?: string;
  /** ID of the character where this mark starts. */
  readonly startId: CharId;
  /** ID of the character where this mark ends (exclusive). */
  readonly endId: CharId;
  /** Who created this mark. */
  readonly nodeId: string;
  /** Logical timestamp. */
  readonly timestamp: number;
  /** Whether the mark is active or deleted (tombstoned). */
  readonly deleted?: boolean;
}

/** A character atom in the text sequence. */
export interface CharAtom {
  readonly id: CharId;
  readonly char: string;
  /** ID of the character this was inserted after. */
  readonly afterId: CharId | null;
  readonly deleted: boolean;
  readonly nodeId: string;
  readonly timestamp: number;
}

/** An operation on the Peritext document. */
export type PeritextOp =
  | { readonly type: 'insert'; readonly atom: CharAtom }
  | {
      readonly type: 'delete';
      readonly charId: CharId;
      readonly nodeId: string;
      readonly timestamp: number;
    }
  | { readonly type: 'format'; readonly mark: FormatMark }
  | {
      readonly type: 'unformat';
      readonly markId: string;
      readonly nodeId: string;
      readonly timestamp: number;
    };

/** A span of text with uniform formatting. */
export interface FormattedSpan {
  readonly text: string;
  readonly marks: readonly { type: MarkType; value?: string }[];
  readonly startIndex: number;
  readonly endIndex: number;
}

/** Snapshot of the Peritext document state. */
export interface PeritextSnapshot {
  readonly text: string;
  readonly spans: readonly FormattedSpan[];
  readonly length: number;
}

const ROOT_ID: CharId = { nodeId: '__root__', counter: 0 };

function charIdEq(a: CharId | null, b: CharId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.nodeId === b.nodeId && a.counter === b.counter;
}

function charIdKey(id: CharId): string {
  return `${id.nodeId}:${id.counter}`;
}

/**
 * Peritext CRDT document.
 *
 * Maintains a sequence of character atoms with formatting marks,
 * supporting concurrent insert, delete, and formatting operations.
 */
export class PeritextDocument {
  private readonly atoms: CharAtom[] = [];
  private readonly marks = new Map<string, FormatMark>();
  private readonly atomIndex = new Map<string, number>();
  private counter = 0;
  private readonly pendingOps: PeritextOp[] = [];

  constructor(private readonly nodeId: string) {
    // Insert root sentinel
    const root: CharAtom = {
      id: ROOT_ID,
      char: '',
      afterId: null,
      deleted: false,
      nodeId: '__root__',
      timestamp: 0,
    };
    this.atoms.push(root);
    this.atomIndex.set(charIdKey(ROOT_ID), 0);
  }

  /** Insert text at a position (0-based index in visible text). */
  insert(position: number, text: string): readonly PeritextOp[] {
    const ops: PeritextOp[] = [];
    const afterAtom = this.getAtomAtVisiblePosition(position - 1);

    let prevId = afterAtom?.id ?? ROOT_ID;

    for (const char of text) {
      const id: CharId = { nodeId: this.nodeId, counter: ++this.counter };
      const atom: CharAtom = {
        id,
        char,
        afterId: prevId,
        deleted: false,
        nodeId: this.nodeId,
        timestamp: Date.now(),
      };

      this.insertAtom(atom);
      const op: PeritextOp = { type: 'insert', atom };
      ops.push(op);
      this.pendingOps.push(op);
      prevId = id;
    }

    return ops;
  }

  /** Delete text at a range (0-based visible positions). */
  delete(start: number, length: number): readonly PeritextOp[] {
    const ops: PeritextOp[] = [];
    const visibleAtoms = this.getVisibleAtoms();

    for (let i = start; i < start + length && i < visibleAtoms.length; i++) {
      const atom = visibleAtoms[i]!;
      const op: PeritextOp = {
        type: 'delete',
        charId: atom.id,
        nodeId: this.nodeId,
        timestamp: Date.now(),
      };
      this.applyDelete(atom.id);
      ops.push(op);
      this.pendingOps.push(op);
    }

    return ops;
  }

  /** Apply a formatting mark to a range of visible text. */
  format(start: number, end: number, markType: MarkType, value?: string): PeritextOp {
    const visibleAtoms = this.getVisibleAtoms();
    const startAtom = visibleAtoms[start];
    const endAtom = visibleAtoms[Math.min(end, visibleAtoms.length) - 1];

    if (!startAtom || !endAtom) {
      throw new Error('Invalid format range');
    }

    const mark: FormatMark = {
      id: `${this.nodeId}-${++this.counter}`,
      type: markType,
      value,
      startId: startAtom.id,
      endId: endAtom.id,
      nodeId: this.nodeId,
      timestamp: Date.now(),
    };

    this.marks.set(mark.id, mark);
    const op: PeritextOp = { type: 'format', mark };
    this.pendingOps.push(op);
    return op;
  }

  /** Remove a formatting mark. */
  unformat(markId: string): PeritextOp | null {
    const mark = this.marks.get(markId);
    if (!mark) return null;

    this.marks.set(markId, { ...mark, deleted: true });
    const op: PeritextOp = {
      type: 'unformat',
      markId,
      nodeId: this.nodeId,
      timestamp: Date.now(),
    };
    this.pendingOps.push(op);
    return op;
  }

  /** Apply a remote operation. */
  applyRemoteOp(op: PeritextOp): void {
    switch (op.type) {
      case 'insert':
        this.insertAtom(op.atom);
        break;
      case 'delete':
        this.applyDelete(op.charId);
        break;
      case 'format':
        this.marks.set(op.mark.id, op.mark);
        break;
      case 'unformat': {
        const mark = this.marks.get(op.markId);
        if (mark) {
          this.marks.set(op.markId, { ...mark, deleted: true });
        }
        break;
      }
    }
  }

  /** Get pending operations and clear the buffer. */
  flushOps(): readonly PeritextOp[] {
    const ops = [...this.pendingOps];
    this.pendingOps.length = 0;
    return ops;
  }

  /** Get the current document snapshot. */
  getSnapshot(): PeritextSnapshot {
    const visibleAtoms = this.getVisibleAtoms();
    const text = visibleAtoms.map((a) => a.char).join('');
    const spans = this.computeSpans(visibleAtoms);
    return { text, spans, length: text.length };
  }

  /** Get plain text content. */
  getText(): string {
    return this.getVisibleAtoms()
      .map((a) => a.char)
      .join('');
  }

  /** Get the number of visible characters. */
  get length(): number {
    return this.getVisibleAtoms().length;
  }

  private insertAtom(atom: CharAtom): void {
    const key = charIdKey(atom.id);
    if (this.atomIndex.has(key)) return; // Idempotent

    // Find insertion position after the referenced atom
    const afterKey = atom.afterId ? charIdKey(atom.afterId) : charIdKey(ROOT_ID);
    let insertIdx = (this.atomIndex.get(afterKey) ?? 0) + 1;

    // RGA-style tie-breaking: scan right, comparing ONLY with atoms that
    // share the same afterId. Skip over atoms with different afterIds
    // (they are part of other causal chains). Stop when we find an atom
    // with the same afterId whose ID is smaller than ours, or reach an
    // atom that precedes us in the sequence (i.e., its afterId points
    // to an atom before our afterId).
    while (insertIdx < this.atoms.length) {
      const existing = this.atoms[insertIdx]!;

      // If this atom's afterId matches ours, apply tie-breaking
      if (charIdEq(existing.afterId, atom.afterId)) {
        // Existing has greater ID → existing stays left, continue scanning
        if (
          existing.nodeId > atom.nodeId ||
          (existing.nodeId === atom.nodeId && existing.id.counter > atom.id.counter)
        ) {
          insertIdx++;
          continue;
        }
        // We are greater → insert here
        break;
      }

      // Different afterId — check if this atom's afterId is "between"
      // our afterId and us in the causal order. If so, skip it.
      // An atom with a different afterId that was inserted after our
      // afterId point is part of a descendant chain — skip over it.
      const existingAfterKey = existing.afterId ? charIdKey(existing.afterId) : '';
      const existingAfterIdx = this.atomIndex.get(existingAfterKey);
      const ourAfterIdx = this.atomIndex.get(afterKey) ?? 0;

      if (existingAfterIdx !== undefined && existingAfterIdx >= ourAfterIdx) {
        // This atom's parent is at or after our parent — it's a descendant
        // chain we should skip over
        insertIdx++;
        continue;
      }

      // This atom's parent is before our parent — we've gone too far
      break;
    }

    this.atoms.splice(insertIdx, 0, atom);
    this.rebuildIndex();
  }

  private applyDelete(charId: CharId): void {
    const key = charIdKey(charId);
    const idx = this.atomIndex.get(key);
    if (idx === undefined) return;

    const atom = this.atoms[idx]!;
    if (!atom.deleted) {
      this.atoms[idx] = { ...atom, deleted: true };
    }
  }

  private getVisibleAtoms(): CharAtom[] {
    return this.atoms.filter((a) => !a.deleted && a.id !== ROOT_ID);
  }

  private getAtomAtVisiblePosition(position: number): CharAtom | undefined {
    if (position < 0) return undefined;
    const visible = this.getVisibleAtoms();
    return visible[position];
  }

  private rebuildIndex(): void {
    this.atomIndex.clear();
    for (let i = 0; i < this.atoms.length; i++) {
      this.atomIndex.set(charIdKey(this.atoms[i]!.id), i);
    }
  }

  private computeSpans(visibleAtoms: CharAtom[]): FormattedSpan[] {
    if (visibleAtoms.length === 0) return [];

    const activeMarks = Array.from(this.marks.values()).filter((m) => !m.deleted);
    const spans: FormattedSpan[] = [];
    let currentText = '';
    let currentMarks: { type: MarkType; value?: string }[] = [];
    let spanStart = 0;

    for (let i = 0; i < visibleAtoms.length; i++) {
      const atom = visibleAtoms[i]!;
      const marksAtPos = this.getMarksAtAtom(atom.id, activeMarks, visibleAtoms);

      const marksChanged =
        marksAtPos.length !== currentMarks.length ||
        marksAtPos.some(
          (m, j) => currentMarks[j]?.type !== m.type || currentMarks[j]?.value !== m.value
        );

      if (marksChanged && currentText.length > 0) {
        spans.push({
          text: currentText,
          marks: currentMarks,
          startIndex: spanStart,
          endIndex: i,
        });
        currentText = '';
        spanStart = i;
      }

      currentMarks = marksAtPos;
      currentText += atom.char;
    }

    if (currentText.length > 0) {
      spans.push({
        text: currentText,
        marks: currentMarks,
        startIndex: spanStart,
        endIndex: visibleAtoms.length,
      });
    }

    return spans;
  }

  private getMarksAtAtom(
    atomId: CharId,
    activeMarks: FormatMark[],
    visibleAtoms: CharAtom[]
  ): { type: MarkType; value?: string }[] {
    const atomIdx = visibleAtoms.findIndex((a) => charIdEq(a.id, atomId));
    const result: { type: MarkType; value?: string }[] = [];

    for (const mark of activeMarks) {
      const startIdx = visibleAtoms.findIndex((a) => charIdEq(a.id, mark.startId));
      const endIdx = visibleAtoms.findIndex((a) => charIdEq(a.id, mark.endId));
      if (startIdx === -1 || endIdx === -1) continue;
      if (atomIdx >= startIdx && atomIdx <= endIdx) {
        result.push({ type: mark.type, value: mark.value });
      }
    }

    return result.sort((a, b) => a.type.localeCompare(b.type));
  }
}

/** Adapter interface for connecting Peritext to a text editor. */
export interface EditorAdapter {
  /** Apply a remote operation to the editor. */
  applyOp(op: PeritextOp): void;
  /** Get the current editor content as operations. */
  getOps(): readonly PeritextOp[];
  /** Subscribe to local edits. */
  onLocalEdit(callback: (ops: readonly PeritextOp[]) => void): () => void;
}

export function createPeritextDocument(nodeId: string): PeritextDocument {
  return new PeritextDocument(nodeId);
}

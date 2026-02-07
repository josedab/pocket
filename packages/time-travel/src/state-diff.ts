/**
 * State Diff Engine - Structural diffing, patch/unpatch, and human-readable summaries
 *
 * @module state-diff
 *
 * @example
 * ```typescript
 * import { createStateDiffEngine } from '@pocket/time-travel';
 *
 * const engine = createStateDiffEngine();
 *
 * const before = { id: 'u1', name: 'Alice', age: 30 };
 * const after  = { id: 'u1', name: 'Alice B.', role: 'admin' };
 *
 * const diff = engine.diff(before, after);
 * console.log(diff.summary);
 * // ["~ modified \"name\": \"Alice\" → \"Alice B.\"",
 * //  "- removed \"age\": 30",
 * //  "+ added \"role\": \"admin\""]
 *
 * // Apply the diff as a patch
 * const patched = engine.patch(before, diff);
 * // patched deep-equals after
 *
 * // Revert the diff
 * const unpatched = engine.unpatch(after, diff);
 * // unpatched deep-equals before
 *
 * engine.destroy();
 * ```
 */

import { Subject, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kind of change for a single field */
export type FieldChangeKind = 'added' | 'removed' | 'modified' | 'moved';

/** A single field-level change */
export interface FieldChange {
  /** Dot-delimited path to the field (e.g. "address.city") */
  path: string;
  /** Kind of change */
  kind: FieldChangeKind;
  /** Value before the change (undefined for 'added') */
  before?: unknown;
  /** Value after the change (undefined for 'removed') */
  after?: unknown;
  /** If kind is 'moved', the old path */
  fromPath?: string;
}

/** Complete diff result between two states */
export interface StateDiff {
  /** Individual field-level changes */
  changes: FieldChange[];
  /** Human-readable summary lines */
  summary: string[];
  /** Timestamp when the diff was computed */
  timestamp: number;
}

/** Diff strategy */
export type DiffStrategy = 'deep' | 'shallow' | 'custom';

/** Configuration for the state diff engine */
export interface StateDiffConfig {
  /** Diff strategy (default: 'deep') */
  strategy?: DiffStrategy;
  /** Maximum depth for deep comparison (default: 20) */
  maxDepth?: number;
  /** Custom comparator – return true if values are considered equal */
  customComparator?: (a: unknown, b: unknown, path: string) => boolean | undefined;
  /** Paths to ignore during diffing */
  ignorePaths?: string[];
}

/** Event types emitted by the diff engine */
export type StateDiffEventType = 'diff_computed' | 'patch_applied' | 'unpatch_applied';

/** Diff engine event */
export interface StateDiffEvent {
  type: StateDiffEventType;
  timestamp: number;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Check whether a value is a plain object (not an array, Date, etc.) */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/** Deep-clone a plain JSON-serialisable value */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Set a nested value by dot path (mutates obj) */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}

/** Delete a nested value by dot path (mutates obj) */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current === null || current === undefined || typeof current !== 'object') {
      return;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current !== null && current !== undefined && typeof current === 'object') {
    Reflect.deleteProperty(current as Record<string, unknown>, parts[parts.length - 1]!);
  }
}

/** Format a value for display in summaries */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// StateDiffEngine
// ---------------------------------------------------------------------------

/**
 * Computes structural diffs between two states, generates human-readable
 * summaries, and provides patch/unpatch for applying or reverting diffs.
 *
 * @example
 * ```typescript
 * const engine = new StateDiffEngine({ strategy: 'deep', maxDepth: 10 });
 *
 * const diff = engine.diff(
 *   { id: '1', nested: { x: 1 } },
 *   { id: '1', nested: { x: 2 }, extra: true },
 * );
 *
 * const patched = engine.patch({ id: '1', nested: { x: 1 } }, diff);
 * engine.destroy();
 * ```
 */
export class StateDiffEngine {
  private readonly config: Required<Omit<StateDiffConfig, 'customComparator' | 'ignorePaths'>> & {
    customComparator?: StateDiffConfig['customComparator'];
    ignorePaths: string[];
  };

  private readonly events$ = new Subject<StateDiffEvent>();

  constructor(config: StateDiffConfig = {}) {
    this.config = {
      strategy: config.strategy ?? 'deep',
      maxDepth: config.maxDepth ?? 20,
      customComparator: config.customComparator,
      ignorePaths: config.ignorePaths ?? [],
    };
  }

  // ---- Diff -------------------------------------------------------------

  /**
   * Compute a structural diff between two states.
   */
  diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): StateDiff {
    const changes: FieldChange[] = [];

    switch (this.config.strategy) {
      case 'shallow':
        this.shallowDiff(before, after, changes);
        break;
      case 'custom':
        this.deepDiff(before, after, '', changes, 0, true);
        break;
      case 'deep':
      default:
        this.deepDiff(before, after, '', changes, 0, false);
        break;
    }

    const summary = this.buildSummary(changes);
    const result: StateDiff = { changes, summary, timestamp: Date.now() };

    this.emitEvent('diff_computed', { changeCount: changes.length, id: generateId() });

    return result;
  }

  // ---- Patch / Unpatch --------------------------------------------------

  /**
   * Apply a diff as a forward patch on the given state.
   * Returns a new object — the input is not mutated.
   */
  patch(
    state: Record<string, unknown>,
    stateDiff: StateDiff
  ): Record<string, unknown> {
    const result = deepClone(state);

    for (const change of stateDiff.changes) {
      switch (change.kind) {
        case 'added':
          setByPath(result, change.path, deepClone(change.after));
          break;
        case 'removed':
          deleteByPath(result, change.path);
          break;
        case 'modified':
          setByPath(result, change.path, deepClone(change.after));
          break;
        case 'moved':
          if (change.fromPath) {
            deleteByPath(result, change.fromPath);
          }
          setByPath(result, change.path, deepClone(change.after));
          break;
      }
    }

    this.emitEvent('patch_applied', { changeCount: stateDiff.changes.length });

    return result;
  }

  /**
   * Revert a diff (un-patch). Returns a new object — the input is not mutated.
   */
  unpatch(
    state: Record<string, unknown>,
    stateDiff: StateDiff
  ): Record<string, unknown> {
    const result = deepClone(state);

    // Apply changes in reverse order
    for (let i = stateDiff.changes.length - 1; i >= 0; i--) {
      const change = stateDiff.changes[i]!;

      switch (change.kind) {
        case 'added':
          deleteByPath(result, change.path);
          break;
        case 'removed':
          setByPath(result, change.path, deepClone(change.before));
          break;
        case 'modified':
          setByPath(result, change.path, deepClone(change.before));
          break;
        case 'moved':
          deleteByPath(result, change.path);
          if (change.fromPath) {
            setByPath(result, change.fromPath, deepClone(change.before));
          }
          break;
      }
    }

    this.emitEvent('unpatch_applied', { changeCount: stateDiff.changes.length });

    return result;
  }

  // ---- Summary ----------------------------------------------------------

  /**
   * Build a human-readable summary of a set of changes.
   */
  buildSummary(changes: FieldChange[]): string[] {
    if (changes.length === 0) {
      return ['No changes'];
    }

    return changes.map((c) => {
      switch (c.kind) {
        case 'added':
          return `+ added "${c.path}": ${formatValue(c.after)}`;
        case 'removed':
          return `- removed "${c.path}": ${formatValue(c.before)}`;
        case 'modified':
          return `~ modified "${c.path}": ${formatValue(c.before)} → ${formatValue(c.after)}`;
        case 'moved':
          return `↔ moved "${c.fromPath}" → "${c.path}": ${formatValue(c.after)}`;
      }
    });
  }

  // ---- Collection-level diff --------------------------------------------

  /**
   * Diff two full collection maps (collection → docId → document).
   * Returns a map of collection names to per-document diffs.
   */
  diffCollections(
    before: Record<string, Record<string, Record<string, unknown>>>,
    after: Record<string, Record<string, Record<string, unknown>>>
  ): Record<string, Record<string, StateDiff>> {
    const result: Record<string, Record<string, StateDiff>> = {};
    const allCollections = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const col of allCollections) {
      const beforeCol = before[col] ?? {};
      const afterCol = after[col] ?? {};
      const allIds = new Set([...Object.keys(beforeCol), ...Object.keys(afterCol)]);

      for (const id of allIds) {
        const bDoc = beforeCol[id] ?? {};
        const aDoc = afterCol[id] ?? {};

        const docDiff = this.diff(bDoc, aDoc);
        if (docDiff.changes.length > 0) {
          result[col] ??= {};
          result[col]![id] = docDiff;
        }
      }
    }

    return result;
  }

  // ---- Observables ------------------------------------------------------

  /**
   * Get events observable.
   */
  get events(): Observable<StateDiffEvent> {
    return this.events$.asObservable();
  }

  // ---- Lifecycle --------------------------------------------------------

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.events$.complete();
  }

  // ---- Private diff implementations -------------------------------------

  /** Shallow (top-level keys only) diff */
  private shallowDiff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    changes: FieldChange[]
  ): void {
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      if (this.config.ignorePaths.includes(key)) continue;

      const bVal = before[key];
      const aVal = after[key];

      if (bVal === undefined && aVal !== undefined) {
        changes.push({ path: key, kind: 'added', after: aVal });
      } else if (bVal !== undefined && aVal === undefined) {
        changes.push({ path: key, kind: 'removed', before: bVal });
      } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.push({ path: key, kind: 'modified', before: bVal, after: aVal });
      }
    }
  }

  /** Deep recursive diff */
  private deepDiff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    prefix: string,
    changes: FieldChange[],
    depth: number,
    useCustom: boolean
  ): void {
    if (depth > this.config.maxDepth) return;

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (this.config.ignorePaths.includes(path)) continue;

      const bVal = before[key];
      const aVal = after[key];

      // Custom comparator short-circuit
      if (useCustom && this.config.customComparator) {
        const result = this.config.customComparator(bVal, aVal, path);
        if (result === true) continue; // treated as equal
        if (result === false) {
          // treated as different – record as modified
          if (bVal === undefined) {
            changes.push({ path, kind: 'added', after: aVal });
          } else if (aVal === undefined) {
            changes.push({ path, kind: 'removed', before: bVal });
          } else {
            changes.push({ path, kind: 'modified', before: bVal, after: aVal });
          }
          continue;
        }
        // undefined → fall through to default logic
      }

      if (bVal === undefined && aVal !== undefined) {
        changes.push({ path, kind: 'added', after: aVal });
      } else if (bVal !== undefined && aVal === undefined) {
        changes.push({ path, kind: 'removed', before: bVal });
      } else if (isPlainObject(bVal) && isPlainObject(aVal)) {
        this.deepDiff(bVal, aVal, path, changes, depth + 1, useCustom);
      } else if (Array.isArray(bVal) && Array.isArray(aVal)) {
        if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
          changes.push({ path, kind: 'modified', before: bVal, after: aVal });
        }
      } else if (bVal !== aVal && JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.push({ path, kind: 'modified', before: bVal, after: aVal });
      }
    }
  }

  private emitEvent(type: StateDiffEventType, data?: unknown): void {
    this.events$.next({ type, timestamp: Date.now(), data });
  }
}

/**
 * Create a state diff engine instance
 *
 * @example
 * ```typescript
 * const engine = createStateDiffEngine({ strategy: 'deep' });
 * const diff = engine.diff({ a: 1 }, { a: 2, b: 3 });
 * ```
 */
export function createStateDiffEngine(config?: StateDiffConfig): StateDiffEngine {
  return new StateDiffEngine(config);
}

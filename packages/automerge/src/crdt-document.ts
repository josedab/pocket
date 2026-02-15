/**
 * @module crdt-document
 *
 * Core CRDT document implementation providing conflict-free data structures
 * with automatic merge capabilities.
 */

import type {
  CrdtChange,
  CrdtDocument,
  CrdtDocumentState,
  CrdtOperation,
  CrdtSyncMessage,
  MergeConflict,
  MergeResult,
} from './types.js';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function hashChange(change: CrdtChange): string {
  const content = `${change.actorId}:${change.seq}:${change.timestamp}:${JSON.stringify(change.operations)}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function applyOperation<T>(obj: T, op: CrdtOperation): T {
  if (!op.path.length) return obj;

  const result = (Array.isArray(obj) ? [...obj] : { ...obj }) as Record<string | number, unknown>;
  const lastKey = op.path[op.path.length - 1]!;

  let current: Record<string | number, unknown> = result;
  for (let i = 0; i < op.path.length - 1; i++) {
    const key = op.path[i]!;
    const next = current[key];
    current[key] = Array.isArray(next) ? [...next] : { ...(next as Record<string, unknown>) };
    current = current[key] as Record<string | number, unknown>;
  }

  switch (op.type) {
    case 'set':
      current[lastKey] = op.value;
      break;
    case 'delete':
      delete current[lastKey];
      break;
    case 'increment':
      current[lastKey] = ((current[lastKey] as number) || 0) + ((op.value as number) || 1);
      break;
    case 'insert':
      if (Array.isArray(current)) {
        current.splice(lastKey as number, 0, op.value);
      }
      break;
    case 'splice':
      if (Array.isArray(current) && Array.isArray(op.value)) {
        current.splice(lastKey as number, 0, ...op.value);
      }
      break;
  }

  return result as T;
}

function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  path: (string | number)[] = [],
): CrdtOperation[] {
  const ops: CrdtOperation[] = [];

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const currentPath = [...path, key];
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!(key in newObj)) {
      ops.push({ type: 'delete', path: currentPath });
    } else if (!(key in oldObj)) {
      ops.push({ type: 'set', path: currentPath, value: newVal });
    } else if (
      typeof oldVal === 'object' &&
      typeof newVal === 'object' &&
      oldVal !== null &&
      newVal !== null &&
      !Array.isArray(oldVal) &&
      !Array.isArray(newVal)
    ) {
      ops.push(
        ...diffObjects(
          oldVal as Record<string, unknown>,
          newVal as Record<string, unknown>,
          currentPath,
        ),
      );
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      ops.push({ type: 'set', path: currentPath, value: newVal });
    }
  }

  return ops;
}

/**
 * Creates a new CRDT document with the given initial value.
 *
 * @param initialValue - The starting document state
 * @param actorId - Unique identifier for the local actor
 * @returns A CrdtDocument instance
 *
 * @example
 * ```typescript
 * const doc = createCrdtDocument(
 *   { title: 'My Document', content: '' },
 *   'user-123'
 * );
 * doc.change((draft) => { draft.title = 'Updated'; });
 * ```
 */
export function createCrdtDocument<T extends Record<string, unknown>>(
  initialValue: T,
  actorId: string = generateId(),
): CrdtDocument<T> {
  let currentValue: T = structuredClone(initialValue);
  let clock = 0;
  let seq = 0;
  const changes: CrdtChange[] = [];
  const changeIndex = new Map<string, CrdtChange>();
  let destroyed = false;

  function getCurrentHeads(): string[] {
    if (changes.length === 0) return [];
    const allDeps = new Set(changes.flatMap((c) => c.deps));
    return changes.filter((c) => !allDeps.has(c.hash)).map((c) => c.hash);
  }

  function getState(): CrdtDocumentState<T> {
    return {
      value: structuredClone(currentValue),
      changes: [...changes],
      actorId,
      clock,
      heads: getCurrentHeads(),
    };
  }

  function change(fn: (draft: T) => void, _message?: string): CrdtChange {
    if (destroyed) throw new Error('Document has been destroyed');

    const draft = structuredClone(currentValue);
    fn(draft);

    const operations = diffObjects(
      currentValue as Record<string, unknown>,
      draft as Record<string, unknown>,
    );

    clock++;
    seq++;

    const crdtChange: CrdtChange = {
      id: generateId(),
      actorId,
      timestamp: clock,
      seq,
      operations,
      hash: '',
      deps: getCurrentHeads(),
    };

    const hash = hashChange(crdtChange);
    const finalChange: CrdtChange = { ...crdtChange, hash };

    changes.push(finalChange);
    changeIndex.set(hash, finalChange);
    currentValue = draft;

    return finalChange;
  }

  function applyChanges(remoteChanges: readonly CrdtChange[]): MergeResult<T> {
    if (destroyed) {
      return { success: false, state: getState(), appliedCount: 0, conflicts: [] };
    }

    const conflicts: MergeConflict[] = [];
    let applied = 0;

    for (const rc of remoteChanges) {
      if (changeIndex.has(rc.hash)) continue;

      // Detect field-level conflicts
      const concurrentLocal = changes.filter(
        (lc) => lc.timestamp >= rc.timestamp && lc.actorId !== rc.actorId,
      );

      for (const op of rc.operations) {
        for (const lc of concurrentLocal) {
          const conflicting = lc.operations.find(
            (lo) => JSON.stringify(lo.path) === JSON.stringify(op.path),
          );
          if (conflicting) {
            // Last-writer-wins by actor ID comparison (deterministic)
            const winner = rc.actorId > actorId ? rc.actorId : actorId;
            conflicts.push({
              path: op.path,
              localValue: conflicting.value,
              remoteValue: op.value,
              resolvedValue: winner === rc.actorId ? op.value : conflicting.value,
              winner,
            });
          }
        }
      }

      // Apply remote operations
      for (const op of rc.operations) {
        const conflict = conflicts.find(
          (c) => JSON.stringify(c.path) === JSON.stringify(op.path),
        );
        if (conflict && conflict.winner !== rc.actorId) continue;
        currentValue = applyOperation(currentValue, op);
      }

      clock = Math.max(clock, rc.timestamp) + 1;
      changes.push(rc);
      changeIndex.set(rc.hash, rc);
      applied++;
    }

    return { success: true, state: getState(), appliedCount: applied, conflicts };
  }

  function generateSyncMessage(peerHeads: readonly string[]): CrdtSyncMessage | null {
    const peerHeadSet = new Set(peerHeads);
    const missingChanges = changes.filter((c) => !peerHeadSet.has(c.hash));

    if (missingChanges.length === 0) return null;

    return {
      senderId: actorId,
      targetId: '',
      changes: missingChanges,
      heads: getCurrentHeads(),
      needsResponse: true,
    };
  }

  function receiveSyncMessage(message: CrdtSyncMessage): MergeResult<T> {
    return applyChanges(message.changes);
  }

  function getChangesSince(heads: readonly string[]): readonly CrdtChange[] {
    if (heads.length === 0) return [...changes];

    const headSet = new Set(heads);
    const result: CrdtChange[] = [];
    const visited = new Set<string>();

    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i]!;
      if (headSet.has(c.hash)) break;
      if (!visited.has(c.hash)) {
        result.unshift(c);
        visited.add(c.hash);
      }
    }

    return result;
  }

  function fork(newActorId: string): CrdtDocument<T> {
    const forked = createCrdtDocument(structuredClone(currentValue), newActorId);
    forked.applyChanges(changes);
    return forked;
  }

  function destroy(): void {
    destroyed = true;
    changes.length = 0;
    changeIndex.clear();
  }

  return {
    getState,
    change,
    applyChanges,
    generateSyncMessage,
    receiveSyncMessage,
    getChangesSince,
    fork,
    destroy,
  };
}

/**
 * Applies a set of CRDT changes to an existing document.
 * Convenience wrapper for batch change application.
 *
 * @param document - The target CRDT document
 * @param changes - Changes to apply
 * @returns The merge result
 */
export function applyCrdtChanges<T extends Record<string, unknown>>(
  document: CrdtDocument<T>,
  changes: readonly CrdtChange[],
): MergeResult<T> {
  return document.applyChanges(changes);
}

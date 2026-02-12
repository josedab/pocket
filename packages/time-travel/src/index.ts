/**
 * @pocket/time-travel - Time-travel debugging for Pocket
 *
 * @example
 * ```typescript
 * import { createTimeTravel } from '@pocket/time-travel';
 *
 * // Create tracker and debugger
 * const { tracker, debugger: timeTravelDebugger } = createTimeTravel({
 *   maxHistorySize: 500,
 *   autoCheckpoint: true,
 *   checkpointInterval: 50,
 * });
 *
 * // Record changes
 * tracker.recordChange('create', 'todos', 'todo-1', null, { id: 'todo-1', title: 'Buy groceries' });
 * tracker.recordChange('update', 'todos', 'todo-1',
 *   { id: 'todo-1', title: 'Buy groceries' },
 *   { id: 'todo-1', title: 'Buy groceries', completed: true }
 * );
 *
 * // Create a checkpoint
 * tracker.createCheckpoint('After completing todo');
 *
 * // Time travel
 * timeTravelDebugger.enterTimeTravel();
 * timeTravelDebugger.stepBackward(); // Go back one step
 *
 * // Get document at current time travel position
 * const todo = timeTravelDebugger.getDocument('todos', 'todo-1');
 * console.log(todo); // { id: 'todo-1', title: 'Buy groceries' } - without completed: true
 *
 * // Replay operations
 * await timeTravelDebugger.replay({
 *   speed: 2,
 *   onOperation: (op) => console.log('Replaying:', op),
 * });
 *
 * // Exit time travel
 * timeTravelDebugger.exitTimeTravel();
 * ```
 */

// Types
export type {
  ChangeOperation,
  DocumentDiff,
  HistoryEntry,
  HistoryExport,
  HistoryFilterOptions,
  OperationType,
  ReplayOptions,
  Snapshot,
  TimeTravelConfig,
  TimeTravelEvent,
  TimeTravelEventType,
  TimeTravelState,
} from './types.js';

export { DEFAULT_TIME_TRAVEL_CONFIG } from './types.js';

// History Tracker
export { HistoryTracker, createHistoryTracker } from './history-tracker.js';

// Time Travel Debugger
export {
  TimeTravelDebugger,
  createTimeTravel,
  createTimeTravelDebugger,
} from './time-travel-debugger.js';

// Hooks
export type {
  ReactHooks,
  UseHistoryEntryReturn,
  UseTimeTravelReturn,
  UseTimeTravelState,
} from './hooks.js';

export { createUseHistoryHook, createUseTimeTravelHook } from './hooks.js';

// Persistent History
export type {
  HistoryFilter,
  HistorySnapshot,
  HistoryStorageAdapter,
  PersistentHistoryConfig,
  PersistentHistoryEntry,
} from './persistent-history.js';

export {
  MemoryHistoryStorage,
  PersistentHistory,
  createPersistentHistory,
} from './persistent-history.js';

// Audit Export
export type {
  AuditExportConfig,
  AuditReport,
  AuditSummary,
} from './audit-export.js';

export { AuditExporter, createAuditExporter } from './audit-export.js';

// Snapshot Engine
export type {
  EngineSnapshot,
  RetentionPolicy,
  SnapshotComparison,
  SnapshotDelta,
  SnapshotEngineConfig,
  SnapshotEngineEvent,
  SnapshotEngineEventType,
  SnapshotEngineState,
} from './snapshot-engine.js';

export { SnapshotEngine, createSnapshotEngine } from './snapshot-engine.js';

// Undo/Redo Manager
export type {
  UndoableOperation,
  UndoEntry,
  UndoRedoConfig,
  UndoRedoEvent,
  UndoRedoEventType,
  UndoRedoState,
} from './undo-redo.js';

export { UndoRedoManager, createUndoRedoManager } from './undo-redo.js';

// State Diff Engine
export type {
  FieldChange,
  FieldChangeKind,
  StateDiff,
  StateDiffConfig,
  StateDiffEvent,
  StateDiffEventType,
  DiffStrategy,
} from './state-diff.js';

export { StateDiffEngine, createStateDiffEngine } from './state-diff.js';

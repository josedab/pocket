/**
 * @pocket/conflict-resolution - Conflict resolution UI components and utilities
 *
 * @example
 * ```typescript
 * import {
 *   createConflictManager,
 *   createConflictAnalyzer,
 * } from '@pocket/conflict-resolution';
 *
 * // Create manager with auto-resolution rules
 * const manager = createConflictManager({
 *   autoResolve: true,
 *   autoResolutionRules: [
 *     {
 *       id: 'timestamp-wins',
 *       name: 'Latest Timestamp Wins',
 *       collections: ['todos'],
 *       conflictTypes: ['update_update'],
 *       strategy: 'timestamp',
 *       priority: 10,
 *       enabled: true,
 *     },
 *   ],
 *   onConflict: (conflict) => {
 *     console.log('New conflict detected:', conflict);
 *   },
 * });
 *
 * // Register a conflict from sync
 * const conflict = manager.registerConflict(
 *   'update_update',
 *   'todos',
 *   'todo-1',
 *   { id: 'todo-1', title: 'Local version', completed: true },
 *   { id: 'todo-1', title: 'Remote version', completed: false },
 *   { id: 'todo-1', title: 'Original', completed: false }
 * );
 *
 * // Analyze the conflict
 * const analysis = manager.analyzeConflict(conflict.id);
 * console.log('Can auto-merge:', analysis.canAutoMerge);
 * console.log('Conflicting fields:', analysis.conflictingFields);
 *
 * // Resolve manually
 * manager.resolve(conflict.id, 'keep_local', conflict.local);
 *
 * // Or resolve with custom merge
 * manager.resolveWithCustomMerge(conflict.id, {
 *   title: 'local',
 *   completed: 'remote',
 * });
 * ```
 */

// Types
export type {
  AutoResolutionRule,
  Conflict,
  ConflictAnalysis,
  ConflictEvent,
  ConflictEventType,
  ConflictResolution,
  ConflictResolutionConfig,
  ConflictSource,
  ConflictState,
  ConflictType,
  FieldChange,
  MergeResult,
  ResolutionStrategy,
} from './types.js';

export { DEFAULT_CONFLICT_CONFIG } from './types.js';

// Conflict Analyzer
export { ConflictAnalyzer, createConflictAnalyzer } from './conflict-analyzer.js';

// Conflict Manager
export { ConflictManager, createConflictManager } from './conflict-manager.js';

// Hooks
export type {
  ReactHooks,
  UseConflictNotificationsReturn,
  UseConflictsReturn,
  UseConflictsState,
} from './hooks.js';

export { createUseConflictNotificationsHook, createUseConflictsHook } from './hooks.js';

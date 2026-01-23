/**
 * React hooks for Conflict Resolution UI
 */

import type { Document } from '@pocket/core';
import type { ConflictManager } from './conflict-manager.js';
import type {
  Conflict,
  ConflictAnalysis,
  ConflictResolution,
  ConflictState,
  ResolutionStrategy,
} from './types.js';

/**
 * React hooks interface for dependency injection
 */
export interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useMemo<T>(fn: () => T, deps: unknown[]): T;
}

/**
 * State for useConflicts hook
 */
export interface UseConflictsState extends ConflictState {
  /** Current analysis (if a conflict is selected) */
  currentAnalysis: ConflictAnalysis | null;
}

/**
 * Return type for useConflicts hook
 */
export interface UseConflictsReturn extends UseConflictsState {
  /** Select a conflict for viewing/resolution */
  selectConflict: (conflictId: string | null) => void;
  /** Resolve with keep local */
  keepLocal: (conflictId: string) => void;
  /** Resolve with keep remote */
  keepRemote: (conflictId: string) => void;
  /** Resolve with merge */
  merge: (conflictId: string) => void;
  /** Resolve with custom selection */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  customResolve: <T extends Document>(
    conflictId: string,
    resolvedDocument: T | null,
    deleteDocument?: boolean
  ) => void;
  /** Resolve with field selections */
  fieldResolve: (
    conflictId: string,
    fieldSelections: Record<string, 'local' | 'remote' | 'base'>
  ) => void;
  /** Clear all conflicts */
  clearAll: () => void;
  /** Resolve all with a strategy */
  resolveAllWith: (strategy: ResolutionStrategy) => void;
  /** Get conflict by ID */
  getConflict: <T extends Document>(id: string) => Conflict<T> | undefined;
  /** Analyze a conflict */
  analyze: <T extends Document>(conflictId: string) => ConflictAnalysis<T>;
}

/**
 * Factory to create useConflicts hook
 */
export function createUseConflictsHook(React: ReactHooks) {
  return function useConflicts(manager: ConflictManager): UseConflictsReturn {
    const [state, setState] = React.useState<UseConflictsState>(() => ({
      ...manager.getCurrentState(),
      currentAnalysis: null,
    }));

    // Subscribe to state changes
    React.useEffect(() => {
      const subscription = manager.state.subscribe((newState) => {
        setState((prev) => ({
          ...prev,
          ...newState,
        }));
      });

      return () => subscription.unsubscribe();
    }, [manager]);

    const selectConflict = React.useCallback(
      (conflictId: string | null) => {
        if (conflictId) {
          const analysis = manager.analyzeConflict(conflictId);
          setState((prev) => ({
            ...prev,
            selectedConflictId: conflictId,
            currentAnalysis: analysis,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            selectedConflictId: null,
            currentAnalysis: null,
          }));
        }
      },
      [manager]
    ) as (conflictId: string | null) => void;

    const keepLocal = React.useCallback(
      (conflictId: string) => {
        manager.resolveWithStrategy(conflictId, 'keep_local');
        setState((prev) => ({
          ...prev,
          selectedConflictId:
            prev.selectedConflictId === conflictId ? null : prev.selectedConflictId,
          currentAnalysis: prev.selectedConflictId === conflictId ? null : prev.currentAnalysis,
        }));
      },
      [manager]
    ) as (conflictId: string) => void;

    const keepRemote = React.useCallback(
      (conflictId: string) => {
        manager.resolveWithStrategy(conflictId, 'keep_remote');
        setState((prev) => ({
          ...prev,
          selectedConflictId:
            prev.selectedConflictId === conflictId ? null : prev.selectedConflictId,
          currentAnalysis: prev.selectedConflictId === conflictId ? null : prev.currentAnalysis,
        }));
      },
      [manager]
    ) as (conflictId: string) => void;

    const merge = React.useCallback(
      (conflictId: string) => {
        manager.resolveWithStrategy(conflictId, 'merge');
        setState((prev) => ({
          ...prev,
          selectedConflictId:
            prev.selectedConflictId === conflictId ? null : prev.selectedConflictId,
          currentAnalysis: prev.selectedConflictId === conflictId ? null : prev.currentAnalysis,
        }));
      },
      [manager]
    ) as (conflictId: string) => void;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    const customResolve = React.useCallback(
      <T extends Document>(
        conflictId: string,
        resolvedDocument: T | null,
        deleteDocument = false
      ) => {
        manager.resolve(conflictId, 'custom', resolvedDocument, deleteDocument);
        setState((prev) => ({
          ...prev,
          selectedConflictId:
            prev.selectedConflictId === conflictId ? null : prev.selectedConflictId,
          currentAnalysis: prev.selectedConflictId === conflictId ? null : prev.currentAnalysis,
        }));
      },
      [manager]
    );

    const fieldResolve = React.useCallback(
      (conflictId: string, fieldSelections: Record<string, 'local' | 'remote' | 'base'>) => {
        manager.resolveWithCustomMerge(conflictId, fieldSelections);
        setState((prev) => ({
          ...prev,
          selectedConflictId:
            prev.selectedConflictId === conflictId ? null : prev.selectedConflictId,
          currentAnalysis: prev.selectedConflictId === conflictId ? null : prev.currentAnalysis,
        }));
      },
      [manager]
    ) as (conflictId: string, fieldSelections: Record<string, 'local' | 'remote' | 'base'>) => void;

    const clearAll = React.useCallback(() => {
      manager.clearConflicts();
      setState((prev) => ({
        ...prev,
        selectedConflictId: null,
        currentAnalysis: null,
      }));
    }, [manager]) as () => void;

    const resolveAllWith = React.useCallback(
      (strategy: ResolutionStrategy) => {
        const conflicts = manager.getConflicts();
        for (const conflict of conflicts) {
          try {
            manager.resolveWithStrategy(
              conflict.id,
              strategy as Exclude<ResolutionStrategy, 'custom' | 'manual'>
            );
          } catch {
            // Skip conflicts that can't be resolved with this strategy
          }
        }
        setState((prev) => ({
          ...prev,
          selectedConflictId: null,
          currentAnalysis: null,
        }));
      },
      [manager]
    ) as (strategy: ResolutionStrategy) => void;

    const getConflict = React.useCallback(
      <T extends Document>(id: string) => {
        return manager.getConflict<T>(id);
      },
      [manager]
    );

    const analyze = React.useCallback(
      <T extends Document>(conflictId: string) => {
        return manager.analyzeConflict<T>(conflictId);
      },
      [manager]
    );

    return {
      ...state,
      selectConflict,
      keepLocal,
      keepRemote,
      merge,
      customResolve,
      fieldResolve,
      clearAll,
      resolveAllWith,
      getConflict,
      analyze,
    };
  };
}

/**
 * Return type for useConflictNotifications hook
 */
export interface UseConflictNotificationsReturn {
  /** New conflicts since last check */
  newConflicts: Conflict[];
  /** Recently resolved conflicts */
  recentResolutions: ConflictResolution[];
  /** Mark conflicts as seen */
  markAsSeen: () => void;
  /** Total unseen count */
  unseenCount: number;
}

/**
 * Factory to create useConflictNotifications hook
 */
export function createUseConflictNotificationsHook(React: ReactHooks) {
  return function useConflictNotifications(
    manager: ConflictManager
  ): UseConflictNotificationsReturn {
    const [newConflicts, setNewConflicts] = React.useState<Conflict[]>([]);
    const [recentResolutions, setRecentResolutions] = React.useState<ConflictResolution[]>([]);
    const [seenIds] = React.useState(() => new Set<string>());

    React.useEffect(() => {
      const subscription = manager.events.subscribe((event) => {
        if (event.type === 'conflict_detected') {
          const data = event.data as { conflict: Conflict };
          if (!seenIds.has(data.conflict.id)) {
            setNewConflicts((prev) => [...prev, data.conflict]);
          }
        } else if (event.type === 'conflict_resolved' || event.type === 'conflict_auto_resolved') {
          const data = event.data as { resolution: ConflictResolution };
          setRecentResolutions((prev) => [...prev.slice(-9), data.resolution]);
        }
      });

      return () => subscription.unsubscribe();
    }, [manager, seenIds]);

    const markAsSeen = React.useCallback(() => {
      for (const conflict of newConflicts) {
        seenIds.add(conflict.id);
      }
      setNewConflicts([]);
    }, [newConflicts, seenIds]) as () => void;

    return {
      newConflicts,
      recentResolutions,
      markAsSeen,
      unseenCount: newConflicts.length,
    };
  };
}

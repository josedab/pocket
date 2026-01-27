/**
 * React hooks for Time Travel Debugging
 */

import type { Document } from '@pocket/core';
import type { HistoryTracker } from './history-tracker.js';
import type { TimeTravelDebugger } from './time-travel-debugger.js';
import type { ChangeOperation, HistoryEntry, Snapshot, TimeTravelState } from './types.js';

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
 * State for useTimeTravel hook
 */
export interface UseTimeTravelState extends TimeTravelState {
  /** Current document being inspected */
  inspectedDocument: Document | null;
  /** Document history for inspected document */
  documentHistory: ChangeOperation[];
}

/**
 * Return type for useTimeTravel hook
 */
export interface UseTimeTravelReturn extends UseTimeTravelState {
  /** Enter time travel mode */
  enterTimeTravel: () => void;
  /** Exit time travel mode */
  exitTimeTravel: () => void;
  /** Travel to specific index */
  travelTo: (index: number) => Snapshot;
  /** Travel to timestamp */
  travelToTime: (timestamp: number) => Snapshot | null;
  /** Travel to checkpoint */
  travelToCheckpoint: (checkpointId: string) => Snapshot | null;
  /** Step forward */
  stepForward: () => Snapshot | null;
  /** Step backward */
  stepBackward: () => Snapshot | null;
  /** Go to beginning */
  goToBeginning: () => Snapshot;
  /** Go to present */
  goToPresent: () => Snapshot;
  /** Create checkpoint */
  createCheckpoint: (label?: string) => Snapshot;
  /** Inspect a document */
  inspectDocument: (collection: string, documentId: string) => void;
  /** Clear inspection */
  clearInspection: () => void;
  /** Get document at current position */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  getDocument: <T extends Document>(collection: string, documentId: string) => T | null;
  /** Get collection at current position */
  getCollection: <T extends Document>(collection: string) => T[];
  /** Get history entries */
  getHistory: () => HistoryEntry[];
}

/**
 * Factory to create useTimeTravel hook
 */
export function createUseTimeTravelHook(React: ReactHooks) {
  return function useTimeTravel(
    debugger_: TimeTravelDebugger,
    tracker: HistoryTracker
  ): UseTimeTravelReturn {
    const [state, setState] = React.useState<UseTimeTravelState>(() => ({
      ...debugger_.getState(),
      inspectedDocument: null,
      documentHistory: [],
    }));

    const [inspectedRef] = React.useState<{
      collection: string | null;
      documentId: string | null;
    }>({ collection: null, documentId: null });

    // Subscribe to state changes
    React.useEffect(() => {
      const subscription = debugger_.state.subscribe((newState) => {
        setState((prev) => ({
          ...prev,
          ...newState,
        }));
      });

      return () => subscription.unsubscribe();
    }, [debugger_]);

    // Update inspected document when state changes
    React.useEffect(() => {
      if (inspectedRef.collection && inspectedRef.documentId) {
        const doc = debugger_.getDocument(inspectedRef.collection, inspectedRef.documentId);
        const history = tracker.getDocumentHistory(
          inspectedRef.collection,
          inspectedRef.documentId
        );
        setState((prev) => ({
          ...prev,
          inspectedDocument: doc,
          documentHistory: history,
        }));
      }
      return undefined;
    }, [state.currentIndex, inspectedRef, debugger_, tracker]);

    const enterTimeTravel = React.useCallback(() => {
      debugger_.enterTimeTravel();
    }, [debugger_]) as () => void;

    const exitTimeTravel = React.useCallback(() => {
      debugger_.exitTimeTravel();
    }, [debugger_]) as () => void;

    const travelTo = React.useCallback(
      (index: number) => {
        return debugger_.travelTo(index);
      },
      [debugger_]
    ) as (index: number) => Snapshot;

    const travelToTime = React.useCallback(
      (timestamp: number) => {
        return debugger_.travelToTime(timestamp);
      },
      [debugger_]
    ) as (timestamp: number) => Snapshot | null;

    const travelToCheckpoint = React.useCallback(
      (checkpointId: string) => {
        return debugger_.travelToCheckpoint(checkpointId);
      },
      [debugger_]
    ) as (checkpointId: string) => Snapshot | null;

    const stepForward = React.useCallback(() => {
      return debugger_.stepForward();
    }, [debugger_]) as () => Snapshot | null;

    const stepBackward = React.useCallback(() => {
      return debugger_.stepBackward();
    }, [debugger_]) as () => Snapshot | null;

    const goToBeginning = React.useCallback(() => {
      return debugger_.goToBeginning();
    }, [debugger_]) as () => Snapshot;

    const goToPresent = React.useCallback(() => {
      return debugger_.goToPresent();
    }, [debugger_]) as () => Snapshot;

    const createCheckpoint = React.useCallback(
      (label?: string) => {
        return tracker.createCheckpoint(label);
      },
      [tracker]
    ) as (label?: string) => Snapshot;

    const inspectDocument = React.useCallback(
      (collection: string, documentId: string) => {
        inspectedRef.collection = collection;
        inspectedRef.documentId = documentId;

        const doc = debugger_.getDocument(collection, documentId);
        const history = tracker.getDocumentHistory(collection, documentId);

        setState((prev) => ({
          ...prev,
          inspectedDocument: doc,
          documentHistory: history,
        }));
      },
      [debugger_, tracker, inspectedRef]
    ) as (collection: string, documentId: string) => void;

    const clearInspection = React.useCallback(() => {
      inspectedRef.collection = null;
      inspectedRef.documentId = null;
      setState((prev) => ({
        ...prev,
        inspectedDocument: null,
        documentHistory: [],
      }));
    }, [inspectedRef]) as () => void;

    const getDocument = React.useCallback(
      (collection: string, documentId: string): Document | null => {
        return debugger_.getDocument(collection, documentId);
      },
      [debugger_]
    );

    const getCollection = React.useCallback(
      (collection: string): Document[] => {
        return debugger_.getCollection(collection);
      },
      [debugger_]
    );

    const getHistory = React.useCallback(() => {
      return tracker.getHistory();
    }, [tracker]) as () => HistoryEntry[];

    return {
      ...state,
      enterTimeTravel,
      exitTimeTravel,
      travelTo,
      travelToTime,
      travelToCheckpoint,
      stepForward,
      stepBackward,
      goToBeginning,
      goToPresent,
      createCheckpoint,
      inspectDocument,
      clearInspection,
      getDocument,
      getCollection,
      getHistory,
    };
  };
}

/**
 * Return type for useHistoryEntry hook
 */
export interface UseHistoryEntryReturn {
  /** History entries */
  entries: HistoryEntry[];
  /** Total entry count */
  totalCount: number;
  /** Filter entries */
  filterByCollection: (collection: string) => HistoryEntry[];
  /** Filter by document */
  filterByDocument: (collection: string, documentId: string) => HistoryEntry[];
  /** Get entry by ID */
  getEntry: (id: string) => HistoryEntry | undefined;
}

/**
 * Factory to create useHistory hook
 */
export function createUseHistoryHook(React: ReactHooks) {
  return function useHistory(tracker: HistoryTracker): UseHistoryEntryReturn {
    const [entries, setEntries] = React.useState<HistoryEntry[]>([]);

    React.useEffect(() => {
      // Initial load
      setEntries(tracker.getHistory());

      // Subscribe to events
      const subscription = tracker.events.subscribe((event) => {
        if (event.type === 'operation_recorded' || event.type === 'history_cleared') {
          setEntries(tracker.getHistory());
        }
      });

      return () => subscription.unsubscribe();
    }, [tracker]);

    const filterByCollection = React.useCallback(
      (collection: string) => {
        return entries.filter((e) => e.operations.some((op) => op.collection === collection));
      },
      [entries]
    ) as (collection: string) => HistoryEntry[];

    const filterByDocument = React.useCallback(
      (collection: string, documentId: string) => {
        return entries.filter((e) =>
          e.operations.some((op) => op.collection === collection && op.documentId === documentId)
        );
      },
      [entries]
    ) as (collection: string, documentId: string) => HistoryEntry[];

    const getEntry = React.useCallback(
      (id: string) => {
        return entries.find((e) => e.id === id);
      },
      [entries]
    ) as (id: string) => HistoryEntry | undefined;

    return {
      entries,
      totalCount: entries.length,
      filterByCollection,
      filterByDocument,
      getEntry,
    };
  };
}

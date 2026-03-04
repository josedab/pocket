/**
 * React hooks for offline-first CRDT-backed forms
 */
import type { ReactHooks } from './hooks.js';
import type { OfflineFormManager } from './offline-form-manager.js';
import type {
  ConflictResolutionStrategy,
  FieldConflict,
  MergeUIState,
  OfflineFormSnapshot,
  OfflineFormState,
  UseOfflineFormReturn,
} from './offline-form-types.js';

/**
 * Factory to create useOfflineForm hook
 */
export function createUseOfflineFormHook(React: ReactHooks) {
  return function useOfflineForm<T extends Record<string, unknown>>(
    manager: OfflineFormManager
  ): UseOfflineFormReturn<T> {
    const [state, setState] = React.useState<OfflineFormState>(() => manager.getState());

    React.useEffect(() => {
      const subscription = manager.state.subscribe((newState: OfflineFormState) => {
        setState(newState);
      });
      return () => subscription.unsubscribe();
    }, [manager]);

    const mergeState: MergeUIState = React.useMemo(
      () => ({
        conflicts: state.conflicts,
        isResolving: false,
        resolvedCount: 0,
        totalConflicts: state.conflicts.length,
      }),
      [state.conflicts]
    );

    const setValue = React.useCallback(
      (name: keyof T & string, value: unknown) => {
        manager.setValue(name, value);
      },
      [manager]
    ) as (name: keyof T & string, value: unknown) => void;

    const setValues = React.useCallback(
      (values: Partial<T>) => {
        manager.setValues(values as Record<string, unknown>);
      },
      [manager]
    ) as (values: Partial<T>) => void;

    const increment = React.useCallback(
      (name: keyof T & string, amount?: number) => {
        manager.increment(name, amount);
      },
      [manager]
    ) as (name: keyof T & string, amount?: number) => void;

    const decrement = React.useCallback(
      (name: keyof T & string, amount?: number) => {
        manager.decrement(name, amount);
      },
      [manager]
    ) as (name: keyof T & string, amount?: number) => void;

    const applyRemote = React.useCallback(
      (snapshot: OfflineFormSnapshot) => {
        return manager.applyRemote(snapshot);
      },
      [manager]
    );

    const getSnapshot = React.useCallback(() => {
      return manager.getSnapshot();
    }, [manager]);

    const resolveConflict = React.useCallback(
      (fieldName: string, value: unknown) => {
        manager.resolveConflict(fieldName, value);
      },
      [manager]
    ) as (fieldName: string, value: unknown) => void;

    const resolveAllConflicts = React.useCallback(
      (strategy: ConflictResolutionStrategy) => {
        manager.resolveAllConflicts(strategy);
      },
      [manager]
    ) as (strategy: ConflictResolutionStrategy) => void;

    const reset = React.useCallback(() => {
      manager.reset();
    }, [manager]) as () => void;

    const destroy = React.useCallback(() => {
      manager.destroy();
    }, [manager]) as () => void;

    return {
      values: state.values as T,
      setValue,
      setValues,
      increment,
      decrement,
      applyRemote,
      getSnapshot,
      resolveConflict,
      resolveAllConflicts,
      state,
      mergeState,
      reset,
      destroy,
    };
  };
}

/**
 * Factory to create useConflictResolution hook for merge UI
 */
export function createUseConflictResolutionHook(React: ReactHooks) {
  return function useConflictResolution(manager: OfflineFormManager) {
    const [conflicts, setConflicts] = React.useState<FieldConflict[]>([]);
    const [resolving, setResolving] = React.useState<string | null>(null);

    React.useEffect(() => {
      const subscription = manager.state.subscribe((state: OfflineFormState) => {
        setConflicts(state.conflicts);
      });
      return () => subscription.unsubscribe();
    }, [manager]);

    const resolve = React.useCallback(
      (fieldName: string, value: unknown) => {
        setResolving(fieldName);
        manager.resolveConflict(fieldName, value);
        setResolving(null);
      },
      [manager]
    ) as (fieldName: string, value: unknown) => void;

    const resolveAll = React.useCallback(
      (strategy: ConflictResolutionStrategy) => {
        manager.resolveAllConflicts(strategy);
      },
      [manager]
    ) as (strategy: ConflictResolutionStrategy) => void;

    const acceptLocal = React.useCallback(
      (fieldName: string) => {
        const conflict = conflicts.find((c) => c.fieldName === fieldName);
        if (conflict) {
          manager.resolveConflict(fieldName, conflict.localValue);
        }
      },
      [manager, conflicts]
    ) as (fieldName: string) => void;

    const acceptRemote = React.useCallback(
      (fieldName: string) => {
        const conflict = conflicts.find((c) => c.fieldName === fieldName);
        if (conflict && conflict.remoteValues.length > 0) {
          manager.resolveConflict(
            fieldName,
            conflict.remoteValues[conflict.remoteValues.length - 1]
          );
        }
      },
      [manager, conflicts]
    ) as (fieldName: string) => void;

    return {
      conflicts,
      hasConflicts: conflicts.length > 0,
      resolvingField: resolving,
      resolve,
      resolveAll,
      acceptLocal,
      acceptRemote,
    };
  };
}

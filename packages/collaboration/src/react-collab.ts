/**
 * React integration for the Collaboration SDK.
 *
 * Provides hooks and component factories for building collaborative
 * UIs with minimal boilerplate. Works with any React 18+ app.
 *
 * @example
 * ```typescript
 * import { createCollabReactSDK } from '@pocket/collaboration';
 * import React from 'react';
 *
 * const { CollabProvider, useCollaborators, useCursors, usePresence } =
 *   createCollabReactSDK(React);
 *
 * function App() {
 *   return (
 *     <CollabProvider sdk={myCollabSDK}>
 *       <Editor />
 *       <PresenceBar />
 *     </CollabProvider>
 *   );
 * }
 * ```
 */

import type { AwarenessState } from './awareness.js';
import type { CollaborationSDK, RemoteEdit, SDKStatus } from './collaboration-sdk.js';

// ── Types ──────────────────────────────────────────────────

export interface CollabReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useEffect(effect: () => (() => void) | undefined, deps?: unknown[]): void;
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useContext<T>(context: ReactContext<T>): T;
  useRef<T>(initial: T): { current: T };
  useMemo<T>(factory: () => T, deps: unknown[]): T;
  createContext<T>(defaultValue: T): ReactContext<T>;
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown;
}

export interface ReactContext<T> {
  Provider: unknown;
  Consumer?: unknown;
  displayName?: string;
  _currentValue?: T;
  _setValue?: (value: T) => void;
}

export interface CollaboratorInfo {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: { start: number; end: number } | null;
  isOnline: boolean;
  lastSeen: number;
}

export interface CollabProviderProps {
  sdk: CollaborationSDK;
  children: unknown;
}

// ── React SDK Factory ──────────────────────────────────────

export interface CollabReactAPI {
  /** Context provider component */
  CollabProvider: (props: CollabProviderProps) => unknown;
  /** Get all active collaborators */
  useCollaborators: () => CollaboratorInfo[];
  /** Get remote cursor positions */
  useCursors: () => Map<string, { x: number; y: number; color: string; name: string }>;
  /** Get current connection status */
  useCollabStatus: () => SDKStatus;
  /** Get remote edits stream */
  useRemoteEdits: (callback: (edit: RemoteEdit) => void) => void;
  /** Get and update awareness state */
  useAwareness: () => {
    states: Map<string, AwarenessState>;
    setLocal: (state: Record<string, unknown>) => void;
  };
  /** Get presence avatar data */
  usePresenceAvatars: () => { id: string; name: string; color: string; initials: string }[];
}

/**
 * Create the React collaboration hooks and components.
 *
 * @param React - The React library (hooks API)
 * @returns An object with CollabProvider, hooks, and components
 */
export function createCollabReactSDK(React: CollabReactHooks): CollabReactAPI {
  const CollabContext = React.createContext<CollaborationSDK | null>(null);

  function useSDK(): CollaborationSDK {
    const sdk = React.useContext(CollabContext);
    if (!sdk) {
      throw new Error('useCollab* hooks must be used inside <CollabProvider>');
    }
    return sdk;
  }

  function CollabProvider(props: CollabProviderProps): unknown {
    return React.createElement(CollabContext.Provider, { value: props.sdk }, props.children);
  }

  function useCollaborators(): CollaboratorInfo[] {
    const sdk = useSDK();
    const [collaborators, setCollaborators] = React.useState<CollaboratorInfo[]>([]);

    React.useEffect(() => {
      const sub = sdk.awareness$.subscribe((states) => {
        const collabs: CollaboratorInfo[] = [];
        for (const [id, state] of states) {
          collabs.push({
            id,
            name: state.name ?? 'Anonymous',
            color: state.color ?? '#888',
            cursor: state.cursor ? { x: state.cursor.line, y: state.cursor.column } : null,
            selection: state.selection
              ? { start: state.selection.start.line, end: state.selection.end.line }
              : null,
            isOnline: Date.now() - state.lastActive < 30000,
            lastSeen: state.lastActive,
          });
        }
        setCollaborators(collabs);
      });

      return () => sub.unsubscribe();
    }, [sdk]);

    return collaborators;
  }

  function useCursors(): Map<string, { x: number; y: number; color: string; name: string }> {
    const sdk = useSDK();
    const [cursors, setCursors] = React.useState(
      new Map<string, { x: number; y: number; color: string; name: string }>()
    );

    React.useEffect(() => {
      const sub = sdk.awareness$.subscribe((states) => {
        const cursorMap = new Map<string, { x: number; y: number; color: string; name: string }>();
        for (const [id, state] of states) {
          if (state.cursor) {
            cursorMap.set(id, {
              x: state.cursor.line,
              y: state.cursor.column,
              color: state.color ?? '#888',
              name: state.name ?? 'Anonymous',
            });
          }
        }
        setCursors(cursorMap);
      });

      return () => sub.unsubscribe();
    }, [sdk]);

    return cursors;
  }

  function useCollabStatus(): SDKStatus {
    const sdk = useSDK();
    const [status, setStatus] = React.useState<SDKStatus>('disconnected');

    React.useEffect(() => {
      const sub = sdk.status$.subscribe(setStatus);
      return () => sub.unsubscribe();
    }, [sdk]);

    return status;
  }

  function useRemoteEdits(callback: (edit: RemoteEdit) => void): void {
    const sdk = useSDK();
    const callbackRef = React.useRef(callback);
    callbackRef.current = callback;

    React.useEffect(() => {
      const sub = sdk.remoteEdits$.subscribe((edit) => callbackRef.current(edit));
      return () => sub.unsubscribe();
    }, [sdk]);
  }

  function useAwareness(): {
    states: Map<string, AwarenessState>;
    setLocal: (state: Record<string, unknown>) => void;
  } {
    const sdk = useSDK();
    const [states, setStates] = React.useState(new Map<string, AwarenessState>());

    React.useEffect(() => {
      const sub = sdk.awareness$.subscribe(setStates);
      return () => sub.unsubscribe();
    }, [sdk]);

    const setLocal = React.useCallback(
      (state: Record<string, unknown>) => {
        sdk.setCursor({ line: (state.line as number) ?? 0, column: (state.column as number) ?? 0 });
      },
      [sdk]
    ) as (state: Record<string, unknown>) => void;

    return { states, setLocal };
  }

  function usePresenceAvatars(): { id: string; name: string; color: string; initials: string }[] {
    const collaborators = useCollaborators();

    return React.useMemo(
      () =>
        collaborators
          .filter((c) => c.isOnline)
          .map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            initials: c.name
              .split(' ')
              .map((part) => part[0] ?? '')
              .join('')
              .toUpperCase()
              .slice(0, 2),
          })),
      [collaborators]
    );
  }

  return {
    CollabProvider,
    useCollaborators,
    useCursors,
    useCollabStatus,
    useRemoteEdits,
    useAwareness,
    usePresenceAvatars,
  };
}

/**
 * React hook factories for collaboration features.
 *
 * Provides factory functions that create React hooks for integrating
 * collaboration session, presence, and cursor features into React components.
 * These factories avoid a direct React dependency by accepting hook primitives.
 *
 * @module react-hooks
 *
 * @example
 * ```typescript
 * import React from 'react';
 * import { createUseCollaboration, createCollaborationSession } from '@pocket/presence';
 *
 * const session = createCollaborationSession({
 *   roomId: 'doc-1',
 *   userId: 'user-1',
 *   userName: 'Alice',
 * });
 *
 * const useCollaboration = createUseCollaboration(session);
 *
 * function CollaborativeEditor() {
 *   const { participants, cursors, isConnected, join } = useCollaboration(React);
 *   // ...
 * }
 * ```
 */

import type { CollaborationSession, CursorUpdate, Participant, SelectionUpdate } from './collaboration-session.js';

/**
 * Return type for the useCollaboration hook.
 */
export interface UseCollaborationReturn {
  /** Current list of participants */
  participants: Participant[];
  /** Current cursor positions by user */
  cursors: Map<string, CursorUpdate>;
  /** Current selections by user */
  selections: Map<string, SelectionUpdate>;
  /** Whether the session is connected */
  isConnected: boolean;
  /** Join the collaboration room */
  join: () => void;
  /** Leave the collaboration room */
  leave: () => void;
  /** Update cursor position */
  updateCursor: (position: CursorUpdate) => void;
  /** Update selection range */
  updateSelection: (selection: SelectionUpdate) => void;
  /** Set typing state */
  setTyping: (isTyping: boolean) => void;
}

/**
 * Return type for the usePresence hook.
 */
export interface UsePresenceReturn {
  /** All users in the room */
  users: Participant[];
  /** The local user */
  localUser: Participant | null;
  /** Update the local user's status */
  updateStatus: (status: 'online' | 'away' | 'offline') => void;
  /** Whether presence is connected */
  isConnected: boolean;
}

/**
 * Return type for the useCursors hook.
 */
export interface UseCursorsReturn {
  /** All active cursors by user */
  cursors: Map<string, CursorUpdate>;
  /** Update the local cursor position */
  updatePosition: (position: CursorUpdate) => void;
}

/**
 * React hook primitives interface for dependency injection.
 */
interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useRef<T>(initial: T): { current: T };
}

/**
 * Create a useCollaboration hook factory bound to a CollaborationSession.
 *
 * @param session - The collaboration session to bind to
 * @returns A hook factory that accepts React hook primitives
 */
export function createUseCollaboration(session: CollaborationSession) {
  return function useCollaboration(React: ReactHooks): UseCollaborationReturn {
    const [participants, setParticipants] = React.useState<Participant[]>([]);
    const [cursors, setCursors] = React.useState<Map<string, CursorUpdate>>(new Map());
    const [selections, setSelections] = React.useState<Map<string, SelectionUpdate>>(new Map());
    const [isConnected, setIsConnected] = React.useState(false);

    React.useEffect(() => {
      const subs: { unsubscribe: () => void }[] = [];

      subs.push(
        (session.participants$).subscribe((p) => {
          setParticipants(p);
          setIsConnected(session.isConnected());
        })
      );

      subs.push(
        (session.cursors$).subscribe(setCursors)
      );

      subs.push(
        (session.selections$).subscribe(setSelections)
      );

      return () => {
        for (const sub of subs) {
          sub.unsubscribe();
        }
      };
    }, [session]);

    return {
      participants,
      cursors,
      selections,
      isConnected,
      join: () => session.join(),
      leave: () => session.leave(),
      updateCursor: (position) => session.updateCursorPosition(position),
      updateSelection: (selection) => session.updateSelection(selection),
      setTyping: (isTyping) => session.setTyping(isTyping),
    };
  };
}

/**
 * Create a usePresence hook factory.
 *
 * @returns A hook factory that accepts React hook primitives and a CollaborationSession
 */
export function createUsePresenceHook() {
  return function usePresence(React: ReactHooks, session: CollaborationSession): UsePresenceReturn {
    const [users, setUsers] = React.useState<Participant[]>([]);
    const [isConnected, setIsConnected] = React.useState(false);
    const sessionRef = React.useRef(session);

    React.useEffect(() => {
      const sub = (sessionRef.current.participants$).subscribe((p) => {
        setUsers(p);
        setIsConnected(sessionRef.current.isConnected());
      });

      return () => sub.unsubscribe();
    }, [sessionRef.current]);

    const localUser = users.find((u) => u.userId === (session as unknown as { config?: { userId?: string } }).config?.userId) ?? users[0] ?? null;

    return {
      users,
      localUser,
      updateStatus: (_status) => {
        // Status update is managed through the session
      },
      isConnected,
    };
  };
}

/**
 * Create a useCursors hook factory.
 *
 * @returns A hook factory that accepts React hook primitives and a CollaborationSession
 */
export function createUseCollaborationCursorsHook() {
  return function useCursors(React: ReactHooks, session: CollaborationSession): UseCursorsReturn {
    const [cursors, setCursors] = React.useState<Map<string, CursorUpdate>>(new Map());
    const sessionRef = React.useRef(session);

    React.useEffect(() => {
      const sub = (sessionRef.current.cursors$).subscribe(setCursors);

      return () => sub.unsubscribe();
    }, [sessionRef.current]);

    return {
      cursors,
      updatePosition: (position) => sessionRef.current.updateCursorPosition(position),
    };
  };
}

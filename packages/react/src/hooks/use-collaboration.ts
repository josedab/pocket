/**
 * React hooks for real-time collaboration features.
 *
 * These hooks provide integration with presence, cursors, typing indicators,
 * and undo/redo functionality. All hooks handle the case where collaboration
 * context is not available by returning empty/noop defaults.
 *
 * @module hooks/use-collaboration
 * @see {@link useCollaborators} - List active collaborators
 * @see {@link useCursors} - Track cursor positions
 * @see {@link useTypingIndicator} - Typing indicator for forms
 * @see {@link useUndoRedo} - Undo/redo stack for local operations
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------- Generic collaboration context types ----------

/**
 * Collaborator information.
 */
export interface Collaborator {
  /** Unique user identifier */
  id: string;
  /** Display name */
  name?: string;
  /** Avatar URL */
  avatar?: string;
  /** User color */
  color?: string;
  /** Current status */
  status: 'online' | 'away' | 'offline';
  /** Last activity timestamp */
  lastActive: number;
}

/**
 * Cursor position from a remote collaborator.
 */
export interface CollaboratorCursor {
  /** User identifier */
  userId: string;
  /** Display name */
  name?: string;
  /** User color */
  color?: string;
  /** X coordinate */
  x?: number;
  /** Y coordinate */
  y?: number;
  /** Line number (for text editors) */
  line?: number;
  /** Column number (for text editors) */
  column?: number;
  /** Element ID or path */
  elementId?: string;
  /** Last update timestamp */
  lastUpdate: number;
}

/**
 * A user currently typing.
 */
export interface TypingUser {
  /** User identifier */
  userId: string;
  /** Display name */
  name?: string;
  /** Timestamp when typing started */
  startedAt: number;
}

/**
 * Generic observable interface for collaboration subscriptions.
 */
export interface CollaborationObservable<T> {
  subscribe(callback: (value: T) => void): { unsubscribe: () => void };
}

/**
 * Collaboration context providing presence data.
 *
 * This is a generic interface that can be implemented by any presence system.
 */
export interface CollaborationContext {
  /** Get collaborators observable */
  getCollaborators?(): CollaborationObservable<Collaborator[]>;
  /** Whether the collaboration connection is active */
  isConnected?(): boolean;
  /** Get cursors observable for a collection */
  getCursors?(collection: string): CollaborationObservable<CollaboratorCursor[]>;
  /** Get typing users observable for a collection/field */
  getTypingUsers?(collection: string, field?: string): CollaborationObservable<TypingUser[]>;
  /** Mark current user as typing */
  setTyping?(collection: string, field: string): void;
  /** Clear current user typing status */
  clearTyping?(collection: string, field?: string): void;
}

// ---------- useCollaborators ----------

/**
 * Options for {@link useCollaborators}.
 */
export interface UseCollaboratorsOptions {
  /** Collaboration context to use */
  context?: CollaborationContext | null;
}

/**
 * Result returned by {@link useCollaborators}.
 */
export interface CollaboratorsResult {
  /** List of active collaborators */
  collaborators: Collaborator[];
  /** Whether the collaboration connection is active */
  isConnected: boolean;
}

/**
 * React hook to list active collaborators with their status.
 *
 * Subscribes to the collaboration context and provides a live list of
 * collaborators. Returns empty defaults if no context is available.
 *
 * @param options - Optional configuration with collaboration context
 * @returns A {@link CollaboratorsResult} with collaborators list and connection status
 *
 * @example
 * ```tsx
 * function CollaboratorList() {
 *   const { collaborators, isConnected } = useCollaborators({ context: collabCtx });
 *
 *   if (!isConnected) return <span>Disconnected</span>;
 *
 *   return (
 *     <ul>
 *       {collaborators.map(user => (
 *         <li key={user.id}>
 *           <span style={{ color: user.color }}>{user.name}</span>
 *           <span>{user.status}</span>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useCollaborators(options: UseCollaboratorsOptions = {}): CollaboratorsResult {
  const { context } = options;

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!context?.getCollaborators) {
      setCollaborators([]);
      setIsConnected(false);
      return;
    }

    setIsConnected(context.isConnected?.() ?? false);

    const observable = context.getCollaborators();
    const subscription = observable.subscribe((users) => {
      if (mountedRef.current) {
        setCollaborators(users);
        setIsConnected(context.isConnected?.() ?? true);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [context]);

  return { collaborators, isConnected };
}

// ---------- useCursors ----------

/**
 * Options for {@link useCursors}.
 */
export interface UseCursorsOptions {
  /** Collaboration context to use */
  context?: CollaborationContext | null;
}

/**
 * Result returned by {@link useCursors}.
 */
export interface CursorsResult {
  /** Cursor positions from other collaborators */
  cursors: CollaboratorCursor[];
}

/**
 * React hook to track cursor positions from other collaborators.
 *
 * Subscribes to cursor position updates for a specific collection.
 * Returns empty defaults if no context is available.
 *
 * @param collection - The collection to track cursors for
 * @param options - Optional configuration with collaboration context
 * @returns A {@link CursorsResult} with cursor positions
 *
 * @example
 * ```tsx
 * function CursorOverlay() {
 *   const { cursors } = useCursors('canvas', { context: collabCtx });
 *
 *   return (
 *     <div className="cursor-layer">
 *       {cursors.map(cursor => (
 *         <div
 *           key={cursor.userId}
 *           className="remote-cursor"
 *           style={{
 *             left: cursor.x,
 *             top: cursor.y,
 *             borderColor: cursor.color,
 *           }}
 *         >
 *           {cursor.name}
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCursors(
  collection: string,
  options: UseCursorsOptions = {}
): CursorsResult {
  const { context } = options;

  const [cursors, setCursors] = useState<CollaboratorCursor[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!context?.getCursors) {
      setCursors([]);
      return;
    }

    const observable = context.getCursors(collection);
    const subscription = observable.subscribe((positions) => {
      if (mountedRef.current) {
        setCursors(positions);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [context, collection]);

  return { cursors };
}

// ---------- useTypingIndicator ----------

/**
 * Options for {@link useTypingIndicator}.
 */
export interface UseTypingIndicatorOptions {
  /** Collaboration context to use */
  context?: CollaborationContext | null;
}

/**
 * Result returned by {@link useTypingIndicator}.
 */
export interface TypingIndicatorResult {
  /** Users currently typing */
  typingUsers: TypingUser[];
  /** Mark the current user as typing */
  setTyping: () => void;
}

/**
 * React hook for typing indicator in collaborative forms.
 *
 * Tracks which users are currently typing in a collection/field
 * and provides a function to mark the current user as typing.
 * Returns empty defaults if no context is available.
 *
 * @param collection - The collection name
 * @param field - Optional field name to track
 * @param options - Optional configuration with collaboration context
 * @returns A {@link TypingIndicatorResult} with typing users and setTyping function
 *
 * @example
 * ```tsx
 * function MessageInput() {
 *   const { typingUsers, setTyping } = useTypingIndicator(
 *     'messages',
 *     'body',
 *     { context: collabCtx }
 *   );
 *
 *   return (
 *     <div>
 *       <textarea onChange={() => setTyping()} />
 *       {typingUsers.length > 0 && (
 *         <span>
 *           {typingUsers.map(u => u.name).join(', ')} typing...
 *         </span>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTypingIndicator(
  collection: string,
  field?: string,
  options: UseTypingIndicatorOptions = {}
): TypingIndicatorResult {
  const { context } = options;

  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!context?.getTypingUsers) {
      setTypingUsers([]);
      return;
    }

    const observable = context.getTypingUsers(collection, field);
    const subscription = observable.subscribe((users) => {
      if (mountedRef.current) {
        setTypingUsers(users);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [context, collection, field]);

  const setTyping = useCallback(() => {
    if (!context?.setTyping || !field) return;
    context.setTyping(collection, field);
  }, [context, collection, field]);

  return { typingUsers, setTyping };
}

// ---------- useUndoRedo ----------

/**
 * An entry in the undo/redo history stack.
 */
export interface HistoryEntry<T = unknown> {
  /** The state snapshot */
  state: T;
  /** Timestamp of the operation */
  timestamp: number;
  /** Optional description */
  description?: string;
}

/**
 * Result returned by {@link useUndoRedo}.
 *
 * @typeParam T - The state type managed by the undo/redo stack
 */
export interface UndoRedoResult<T = unknown> {
  /** Undo the last operation */
  undo: () => T | undefined;
  /** Redo the last undone operation */
  redo: () => T | undefined;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** The history stack */
  history: HistoryEntry<T>[];
  /** Push a new state onto the history */
  push: (state: T, description?: string) => void;
  /** Clear all history */
  clear: () => void;
}

/**
 * Options for {@link useUndoRedo}.
 *
 * @typeParam T - The state type managed by the undo/redo stack
 */
export interface UseUndoRedoOptions<T = unknown> {
  /** Maximum number of history entries to retain */
  maxHistory?: number;
  /** Initial state to start with */
  initialState?: T;
}

/**
 * React hook for undo/redo stack for local operations.
 *
 * Provides a complete undo/redo system with configurable history depth.
 * Useful for collaborative editing where users need to revert local changes.
 *
 * @typeParam T - The state type managed by the undo/redo stack
 * @param options - Optional configuration
 * @returns An {@link UndoRedoResult} with undo, redo, push, and history
 *
 * @example
 * ```tsx
 * function TextEditor() {
 *   const { undo, redo, canUndo, canRedo, push } = useUndoRedo<string>({
 *     maxHistory: 50,
 *     initialState: '',
 *   });
 *
 *   const handleChange = (text: string) => {
 *     push(text, 'text change');
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={() => undo()} disabled={!canUndo}>Undo</button>
 *       <button onClick={() => redo()} disabled={!canRedo}>Redo</button>
 *       <textarea onChange={(e) => handleChange(e.target.value)} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useUndoRedo<T = unknown>(
  options: UseUndoRedoOptions<T> = {}
): UndoRedoResult<T> {
  const { maxHistory = 100, initialState } = options;

  const [, forceUpdate] = useState(0);

  const pastRef = useRef<HistoryEntry<T>[]>(
    initialState !== undefined
      ? [{ state: initialState, timestamp: Date.now() }]
      : []
  );
  const futureRef = useRef<HistoryEntry<T>[]>([]);

  const push = useCallback(
    (state: T, description?: string) => {
      const entry: HistoryEntry<T> = {
        state,
        timestamp: Date.now(),
        description,
      };

      pastRef.current = [...pastRef.current, entry];

      // Trim history if over max
      if (pastRef.current.length > maxHistory) {
        pastRef.current = pastRef.current.slice(pastRef.current.length - maxHistory);
      }

      // Clear future on new push
      futureRef.current = [];
      forceUpdate((n) => n + 1);
    },
    [maxHistory]
  );

  const undo = useCallback((): T | undefined => {
    if (pastRef.current.length <= 1) return undefined;

    const current = pastRef.current[pastRef.current.length - 1]!;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [current, ...futureRef.current];

    forceUpdate((n) => n + 1);

    const previous = pastRef.current[pastRef.current.length - 1];
    return previous?.state;
  }, []);

  const redo = useCallback((): T | undefined => {
    if (futureRef.current.length === 0) return undefined;

    const next = futureRef.current[0]!;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, next];

    forceUpdate((n) => n + 1);

    return next.state;
  }, []);

  const clear = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    forceUpdate((n) => n + 1);
  }, []);

  return {
    undo,
    redo,
    canUndo: pastRef.current.length > 1,
    canRedo: futureRef.current.length > 0,
    history: pastRef.current,
    push,
    clear,
  };
}

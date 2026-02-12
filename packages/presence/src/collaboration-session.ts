/**
 * Collaboration Session for managing real-time collaborative editing.
 *
 * Combines presence, cursor tracking, selection tracking, and typing indicators
 * into a unified session that can be used by collaborative applications.
 *
 * @module collaboration-session
 *
 * @example
 * ```typescript
 * import { createCollaborationSession } from '@pocket/presence';
 *
 * const session = createCollaborationSession({
 *   roomId: 'doc-123',
 *   userId: 'user-1',
 *   userName: 'Alice',
 *   userColor: '#E91E63',
 * });
 *
 * session.join();
 *
 * session.updateCursorPosition({ x: 100, y: 200, elementId: 'editor' });
 * session.updateSelection({ start: 10, end: 25, elementId: 'editor' });
 * session.setTyping(true);
 *
 * session.participants$.subscribe((participants) => {
 *   console.log('Participants:', participants);
 * });
 *
 * session.destroy();
 * ```
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { generateUserColor } from './types.js';

/**
 * Configuration for a collaboration session.
 */
export interface CollaborationSessionConfig {
  /** Room identifier */
  roomId: string;
  /** Local user identifier */
  userId: string;
  /** Local user display name */
  userName: string;
  /** Local user cursor/selection color */
  userColor?: string;
}

/**
 * Participant in a collaboration session.
 */
export interface Participant {
  /** User identifier */
  userId: string;
  /** User display name */
  userName: string;
  /** User color */
  color: string;
  /** User status */
  status: 'online' | 'away' | 'offline';
}

/**
 * Cursor position update.
 */
export interface CursorUpdate {
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
  /** Element the cursor is over */
  elementId?: string;
}

/**
 * Selection range update.
 */
export interface SelectionUpdate {
  /** Start offset */
  start: number;
  /** End offset */
  end: number;
  /** Element the selection belongs to */
  elementId?: string;
}

/**
 * Manages a collaboration session for a specific room.
 *
 * Tracks participants, cursors, selections, and typing state with
 * observable streams for reactive updates.
 *
 * @example
 * ```typescript
 * const session = new CollaborationSession({
 *   roomId: 'doc-1',
 *   userId: 'alice',
 *   userName: 'Alice',
 * });
 *
 * session.join();
 * session.updateCursorPosition({ x: 50, y: 100 });
 *
 * const participants = session.getParticipants();
 * const cursors = session.getActiveCursors();
 *
 * session.destroy();
 * ```
 */
export class CollaborationSession {
  private readonly config: Required<CollaborationSessionConfig>;
  private readonly participantsMap = new Map<string, Participant>();
  private readonly cursorsMap = new Map<string, CursorUpdate>();
  private readonly selectionsMap = new Map<string, SelectionUpdate>();

  private readonly participants$$ = new BehaviorSubject<Participant[]>([]);
  private readonly cursors$$ = new Subject<Map<string, CursorUpdate>>();
  private readonly selections$$ = new Subject<Map<string, SelectionUpdate>>();
  private readonly destroy$ = new Subject<void>();

  private connected = false;
  private destroyed = false;

  constructor(config: CollaborationSessionConfig) {
    this.config = {
      ...config,
      userColor: config.userColor ?? generateUserColor(config.userId),
    };
  }

  /**
   * Join the collaboration room.
   */
  join(): void {
    if (this.destroyed || this.connected) return;

    this.connected = true;

    // Add local user as participant
    const localParticipant: Participant = {
      userId: this.config.userId,
      userName: this.config.userName,
      color: this.config.userColor,
      status: 'online',
    };

    this.participantsMap.set(this.config.userId, localParticipant);
    this.emitParticipants();
  }

  /**
   * Leave the collaboration room.
   */
  leave(): void {
    if (this.destroyed || !this.connected) return;

    this.connected = false;

    // Remove local user
    this.participantsMap.delete(this.config.userId);
    this.cursorsMap.delete(this.config.userId);
    this.selectionsMap.delete(this.config.userId);

    this.emitParticipants();
  }

  /**
   * Get the current list of participants.
   *
   * @returns Array of participants in the room
   */
  getParticipants(): Participant[] {
    return Array.from(this.participantsMap.values());
  }

  /**
   * Observable of participant list changes.
   */
  get participants$(): Observable<Participant[]> {
    return this.participants$$.asObservable();
  }

  /**
   * Update the local user's cursor position and broadcast it.
   *
   * @param position - The cursor position
   */
  updateCursorPosition(position: CursorUpdate): void {
    if (this.destroyed || !this.connected) return;

    this.cursorsMap.set(this.config.userId, { ...position });
    this.cursors$$.next(new Map(this.cursorsMap));
  }

  /**
   * Update the local user's selection range and broadcast it.
   *
   * @param selection - The selection range
   */
  updateSelection(selection: SelectionUpdate): void {
    if (this.destroyed || !this.connected) return;

    this.selectionsMap.set(this.config.userId, { ...selection });
    this.selections$$.next(new Map(this.selectionsMap));
  }

  /**
   * Set the local user's typing state and broadcast it.
   *
   * @param isTyping - Whether the user is currently typing
   */
  setTyping(isTyping: boolean): void {
    if (this.destroyed || !this.connected) return;

    const participant = this.participantsMap.get(this.config.userId);
    if (participant) {
      // Update participant status to reflect typing activity
      participant.status = isTyping ? 'online' : participant.status;
      this.emitParticipants();
    }
  }

  /**
   * Get all active cursors.
   *
   * @returns Map of userId to cursor position
   */
  getActiveCursors(): Map<string, CursorUpdate> {
    return new Map(this.cursorsMap);
  }

  /**
   * Observable of cursor updates.
   */
  get cursors$(): Observable<Map<string, CursorUpdate>> {
    return this.cursors$$.asObservable();
  }

  /**
   * Observable of selection updates.
   */
  get selections$(): Observable<Map<string, SelectionUpdate>> {
    return this.selections$$.asObservable();
  }

  /**
   * Check if the session is connected.
   *
   * @returns Whether the session is connected to the room
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Destroy the session and clean up all resources.
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.connected = false;

    this.participantsMap.clear();
    this.cursorsMap.clear();
    this.selectionsMap.clear();

    this.destroy$.next();
    this.destroy$.complete();
    this.participants$$.complete();
    this.cursors$$.complete();
    this.selections$$.complete();
  }

  /**
   * Emit current participants list.
   */
  private emitParticipants(): void {
    if (this.destroyed) return;
    this.participants$$.next(this.getParticipants());
  }
}

/**
 * Create a collaboration session instance.
 *
 * @param config - Session configuration
 * @returns A new CollaborationSession instance
 */
export function createCollaborationSession(
  config: CollaborationSessionConfig
): CollaborationSession {
  return new CollaborationSession(config);
}

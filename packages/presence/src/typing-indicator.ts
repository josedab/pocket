/**
 * Typing Indicator for tracking which users are currently typing.
 *
 * Provides real-time tracking of typing activity across collections and fields,
 * with automatic expiry of stale typing status.
 *
 * @module typing-indicator
 *
 * @example
 * ```typescript
 * import { createTypingIndicator } from '@pocket/presence';
 *
 * const typing = createTypingIndicator({ timeoutMs: 3000 });
 *
 * // Mark user as typing
 * typing.setTyping('user-1', 'messages', 'body');
 *
 * // Get who's typing
 * const users = typing.getTypingUsers('messages', 'body');
 *
 * // Subscribe to changes
 * typing.typing$.subscribe((allTyping) => {
 *   console.log('Typing state changed:', allTyping);
 * });
 *
 * // Cleanup
 * typing.destroy();
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

/**
 * Represents a user who is currently typing.
 */
export interface TypingUser {
  /** Unique user identifier */
  userId: string;
  /** Collection the user is typing in */
  collection: string;
  /** Field the user is typing in */
  field: string;
  /** Timestamp when typing started */
  startedAt: number;
}

/**
 * Configuration for the typing indicator.
 */
export interface TypingIndicatorConfig {
  /** Timeout in ms before typing status auto-expires (default: 3000) */
  timeoutMs?: number;
}

/**
 * Internal typing entry with expiry timer.
 */
interface TypingEntry {
  /** The typing user data */
  user: TypingUser;
  /** Timer handle for auto-expiry */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Default typing indicator configuration.
 */
const DEFAULT_TYPING_CONFIG: Required<TypingIndicatorConfig> = {
  timeoutMs: 3000,
};

/**
 * Tracks which users are currently typing in which collection/field.
 *
 * Automatically expires typing status after a configurable timeout
 * and emits changes through an observable stream.
 *
 * @example
 * ```typescript
 * const indicator = new TypingIndicator({ timeoutMs: 2000 });
 *
 * indicator.setTyping('alice', 'todos', 'title');
 * indicator.setTyping('bob', 'todos', 'title');
 *
 * const typingUsers = indicator.getTypingUsers('todos', 'title');
 * // => [{ userId: 'alice', ... }, { userId: 'bob', ... }]
 *
 * indicator.clearTyping('alice');
 * indicator.destroy();
 * ```
 */
export class TypingIndicator {
  private readonly config: Required<TypingIndicatorConfig>;
  private readonly entries = new Map<string, TypingEntry>();
  private readonly typing$$ = new BehaviorSubject<TypingUser[]>([]);
  private destroyed = false;

  constructor(config: TypingIndicatorConfig = {}) {
    this.config = { ...DEFAULT_TYPING_CONFIG, ...config };
  }

  /**
   * Mark a user as typing in a specific collection/field.
   *
   * If the user is already marked as typing for the same collection/field,
   * the expiry timer is reset. A user can be typing in multiple
   * collection/field combinations simultaneously.
   *
   * @param userId - The unique user identifier
   * @param collection - The collection name
   * @param field - The field name
   *
   * @example
   * ```typescript
   * indicator.setTyping('user-1', 'messages', 'body');
   * ```
   */
  setTyping(userId: string, collection: string, field: string): void {
    if (this.destroyed) return;

    const key = this.buildKey(userId, collection, field);

    // Clear existing timer if present
    const existing = this.entries.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const user: TypingUser = {
      userId,
      collection,
      field,
      startedAt: existing?.user.startedAt ?? Date.now(),
    };

    const timer = setTimeout(() => {
      this.entries.delete(key);
      this.emit();
    }, this.config.timeoutMs);

    this.entries.set(key, { user, timer });
    this.emit();
  }

  /**
   * Clear typing status for a user.
   *
   * If collection and field are provided, clears only that specific entry.
   * If only collection is provided, clears all entries for that user in the collection.
   * If neither is provided, clears all entries for the user.
   *
   * @param userId - The unique user identifier
   * @param collection - Optional collection to clear
   * @param field - Optional field to clear (requires collection)
   *
   * @example
   * ```typescript
   * // Clear specific field
   * indicator.clearTyping('user-1', 'messages', 'body');
   *
   * // Clear all fields in collection
   * indicator.clearTyping('user-1', 'messages');
   *
   * // Clear all typing for user
   * indicator.clearTyping('user-1');
   * ```
   */
  clearTyping(userId: string, collection?: string, field?: string): void {
    if (this.destroyed) return;

    let changed = false;

    if (collection && field) {
      const key = this.buildKey(userId, collection, field);
      const entry = this.entries.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        this.entries.delete(key);
        changed = true;
      }
    } else {
      for (const [key, entry] of this.entries) {
        const matchesUser = entry.user.userId === userId;
        const matchesCollection = !collection || entry.user.collection === collection;

        if (matchesUser && matchesCollection) {
          clearTimeout(entry.timer);
          this.entries.delete(key);
          changed = true;
        }
      }
    }

    if (changed) {
      this.emit();
    }
  }

  /**
   * Get all users currently typing in a collection, optionally filtered by field.
   *
   * @param collection - The collection to check
   * @param field - Optional field to filter by
   * @returns Array of typing users
   *
   * @example
   * ```typescript
   * // Get all typing in 'messages' collection
   * const users = indicator.getTypingUsers('messages');
   *
   * // Get typing in specific field
   * const bodyTypers = indicator.getTypingUsers('messages', 'body');
   * ```
   */
  getTypingUsers(collection: string, field?: string): TypingUser[] {
    const result: TypingUser[] = [];

    for (const entry of this.entries.values()) {
      const matchesCollection = entry.user.collection === collection;
      const matchesField = !field || entry.user.field === field;

      if (matchesCollection && matchesField) {
        result.push({ ...entry.user });
      }
    }

    return result;
  }

  /**
   * Observable that emits on any typing state change.
   *
   * Emits the complete list of all currently typing users whenever
   * typing status is set, cleared, or expires.
   *
   * @example
   * ```typescript
   * indicator.typing$.subscribe((typingUsers) => {
   *   console.log('Currently typing:', typingUsers);
   * });
   * ```
   */
  get typing$(): Observable<TypingUser[]> {
    return this.typing$$.asObservable();
  }

  /**
   * Destroy the typing indicator and clean up all timers.
   *
   * @example
   * ```typescript
   * indicator.destroy();
   * ```
   */
  destroy(): void {
    this.destroyed = true;

    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();

    this.typing$$.complete();
  }

  /**
   * Build a unique key for a user/collection/field combination.
   */
  private buildKey(userId: string, collection: string, field: string): string {
    return `${userId}:${collection}:${field}`;
  }

  /**
   * Emit current typing state.
   */
  private emit(): void {
    if (this.destroyed) return;

    const users: TypingUser[] = [];
    for (const entry of this.entries.values()) {
      users.push({ ...entry.user });
    }
    this.typing$$.next(users);
  }
}

/**
 * Create a typing indicator instance.
 *
 * @param config - Optional configuration
 * @returns A new TypingIndicator instance
 *
 * @example
 * ```typescript
 * const typing = createTypingIndicator({ timeoutMs: 5000 });
 * typing.setTyping('user-1', 'todos', 'title');
 * ```
 */
export function createTypingIndicator(config?: TypingIndicatorConfig): TypingIndicator {
  return new TypingIndicator(config);
}

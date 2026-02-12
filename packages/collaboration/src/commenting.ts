/**
 * Thread-based commenting system for collaborative documents.
 *
 * Supports nested replies, @mentions, emoji reactions, and real-time
 * comment updates via RxJS observables.
 *
 * @example
 * ```typescript
 * import { createCommentingSystem } from '@pocket/collaboration';
 *
 * const comments = createCommentingSystem({ userId: 'user-1' });
 *
 * const thread = comments.createThread({
 *   documentId: 'doc-123',
 *   body: 'Great paragraph!',
 *   fieldPath: 'content.body',
 * });
 *
 * comments.reply(thread.id, { body: 'Thanks @user-2!' });
 * comments.addReaction(thread.id, '👍');
 * comments.resolveThread(thread.id);
 *
 * comments.threads$.subscribe(threads => console.log(threads));
 * ```
 *
 * @module @pocket/collaboration/commenting
 */

import { BehaviorSubject, Observable, Subject } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export type CommentStatus = 'open' | 'resolved' | 'archived';

export interface Mention {
  userId: string;
  displayName?: string;
}

export interface CommentReaction {
  emoji: string;
  userIds: string[];
}

export interface Comment {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  mentions: Mention[];
  reactions: CommentReaction[];
  createdAt: number;
  updatedAt: number;
}

export interface CommentThread {
  id: string;
  documentId: string;
  fieldPath?: string;
  status: CommentStatus;
  comments: Comment[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateThreadInput {
  documentId: string;
  body: string;
  fieldPath?: string;
  mentions?: Mention[];
}

export interface ReplyInput {
  body: string;
  mentions?: Mention[];
}

export type CommentEventType =
  | 'thread-created'
  | 'thread-resolved'
  | 'thread-reopened'
  | 'thread-archived'
  | 'comment-added'
  | 'comment-updated'
  | 'comment-deleted'
  | 'reaction-added'
  | 'reaction-removed';

export interface CommentEvent {
  type: CommentEventType;
  threadId: string;
  commentId?: string;
  userId: string;
  timestamp: number;
  data?: unknown;
}

export interface CommentingConfig {
  /** Current user's identifier. */
  userId: string;
}

// ── Helpers ────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Extract @mention references from comment body text.
 * Matches patterns like `@user-id` or `@some_name`.
 */
function parseMentions(body: string, explicit: Mention[] = []): Mention[] {
  const mentionRegex = /@([\w-]+)/g;
  const parsed = new Map<string, Mention>();

  for (const m of explicit) {
    parsed.set(m.userId, m);
  }

  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(body)) !== null) {
    const userId = match[1]!;
    if (!parsed.has(userId)) {
      parsed.set(userId, { userId });
    }
  }

  return Array.from(parsed.values());
}

// ── CommentingSystem ───────────────────────────────────────

/**
 * CommentingSystem — thread-based commenting with real-time updates.
 *
 * All threads are stored in-memory and exposed via reactive streams.
 * Consumers can subscribe to `threads$` for the full thread list or
 * `events$` for granular change notifications.
 */
export class CommentingSystem {
  private readonly userId: string;
  private readonly threadsSubject: BehaviorSubject<Map<string, CommentThread>>;
  private readonly eventsSubject: Subject<CommentEvent>;
  private destroyed = false;

  constructor(config: CommentingConfig) {
    this.userId = config.userId;
    this.threadsSubject = new BehaviorSubject<Map<string, CommentThread>>(new Map());
    this.eventsSubject = new Subject<CommentEvent>();
  }

  // ── Observables ────────────────────────────────────────

  /** Reactive stream of all comment threads. */
  get threads$(): Observable<CommentThread[]> {
    return new Observable<CommentThread[]>((subscriber) => {
      const sub = this.threadsSubject.subscribe((map) => {
        subscriber.next(Array.from(map.values()));
      });
      return () => sub.unsubscribe();
    });
  }

  /** Reactive stream of comment events. */
  get events$(): Observable<CommentEvent> {
    return this.eventsSubject.asObservable();
  }

  // ── Thread operations ──────────────────────────────────

  /** Create a new comment thread on a document or field. */
  createThread(input: CreateThreadInput): CommentThread {
    this.assertNotDestroyed();

    const threadId = generateId();
    const now = Date.now();
    const mentions = parseMentions(input.body, input.mentions);

    const comment: Comment = {
      id: generateId(),
      threadId,
      authorId: this.userId,
      body: input.body,
      mentions,
      reactions: [],
      createdAt: now,
      updatedAt: now,
    };

    const thread: CommentThread = {
      id: threadId,
      documentId: input.documentId,
      fieldPath: input.fieldPath,
      status: 'open',
      comments: [comment],
      createdAt: now,
      updatedAt: now,
    };

    this.updateThread(thread);
    this.emitEvent('thread-created', threadId, comment.id);

    return thread;
  }

  /** Reply to an existing thread. */
  reply(threadId: string, input: ReplyInput): Comment {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    const now = Date.now();
    const mentions = parseMentions(input.body, input.mentions);

    const comment: Comment = {
      id: generateId(),
      threadId,
      authorId: this.userId,
      body: input.body,
      mentions,
      reactions: [],
      createdAt: now,
      updatedAt: now,
    };

    thread.comments.push(comment);
    thread.updatedAt = now;
    this.updateThread(thread);
    this.emitEvent('comment-added', threadId, comment.id);

    return comment;
  }

  /** Update a comment's body text. */
  updateComment(threadId: string, commentId: string, body: string): void {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) {
      throw new Error(`Comment "${commentId}" not found in thread "${threadId}"`);
    }

    comment.body = body;
    comment.mentions = parseMentions(body);
    comment.updatedAt = Date.now();
    thread.updatedAt = comment.updatedAt;

    this.updateThread(thread);
    this.emitEvent('comment-updated', threadId, commentId);
  }

  /** Delete a comment from a thread. */
  deleteComment(threadId: string, commentId: string): void {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    const index = thread.comments.findIndex((c) => c.id === commentId);
    if (index === -1) {
      throw new Error(`Comment "${commentId}" not found in thread "${threadId}"`);
    }

    thread.comments.splice(index, 1);
    thread.updatedAt = Date.now();

    this.updateThread(thread);
    this.emitEvent('comment-deleted', threadId, commentId);
  }

  // ── Thread status ──────────────────────────────────────

  /** Mark a thread as resolved. */
  resolveThread(threadId: string): void {
    this.setThreadStatus(threadId, 'resolved', 'thread-resolved');
  }

  /** Reopen a resolved or archived thread. */
  reopenThread(threadId: string): void {
    this.setThreadStatus(threadId, 'open', 'thread-reopened');
  }

  /** Archive a thread. */
  archiveThread(threadId: string): void {
    this.setThreadStatus(threadId, 'archived', 'thread-archived');
  }

  // ── Reactions ──────────────────────────────────────────

  /** Add an emoji reaction to a comment. */
  addReaction(threadId: string, commentId: string, emoji: string): void {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) {
      throw new Error(`Comment "${commentId}" not found in thread "${threadId}"`);
    }

    let reaction = comment.reactions.find((r) => r.emoji === emoji);
    if (!reaction) {
      reaction = { emoji, userIds: [] };
      comment.reactions.push(reaction);
    }

    if (!reaction.userIds.includes(this.userId)) {
      reaction.userIds.push(this.userId);
      comment.updatedAt = Date.now();
      thread.updatedAt = comment.updatedAt;
      this.updateThread(thread);
      this.emitEvent('reaction-added', threadId, commentId, { emoji });
    }
  }

  /** Remove an emoji reaction from a comment. */
  removeReaction(threadId: string, commentId: string, emoji: string): void {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) {
      throw new Error(`Comment "${commentId}" not found in thread "${threadId}"`);
    }

    const reaction = comment.reactions.find((r) => r.emoji === emoji);
    if (!reaction) return;

    const idx = reaction.userIds.indexOf(this.userId);
    if (idx !== -1) {
      reaction.userIds.splice(idx, 1);
      if (reaction.userIds.length === 0) {
        comment.reactions = comment.reactions.filter((r) => r.emoji !== emoji);
      }
      comment.updatedAt = Date.now();
      thread.updatedAt = comment.updatedAt;
      this.updateThread(thread);
      this.emitEvent('reaction-removed', threadId, commentId, { emoji });
    }
  }

  // ── Queries ────────────────────────────────────────────

  /** Get a thread by ID. */
  getThread(threadId: string): CommentThread | undefined {
    return this.threadsSubject.getValue().get(threadId);
  }

  /** Get all threads for a document. */
  getThreadsForDocument(documentId: string): CommentThread[] {
    const threads: CommentThread[] = [];
    for (const thread of this.threadsSubject.getValue().values()) {
      if (thread.documentId === documentId) {
        threads.push(thread);
      }
    }
    return threads;
  }

  /** Get all threads matching a status filter. */
  getThreadsByStatus(status: CommentStatus): CommentThread[] {
    const threads: CommentThread[] = [];
    for (const thread of this.threadsSubject.getValue().values()) {
      if (thread.status === status) {
        threads.push(thread);
      }
    }
    return threads;
  }

  // ── Lifecycle ──────────────────────────────────────────

  /** Tear down streams and release resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventsSubject.complete();
    this.threadsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private updateThread(thread: CommentThread): void {
    const threads = new Map(this.threadsSubject.getValue());
    threads.set(thread.id, thread);
    this.threadsSubject.next(threads);
  }

  private getThreadOrThrow(threadId: string): CommentThread {
    const thread = this.threadsSubject.getValue().get(threadId);
    if (!thread) {
      throw new Error(`Thread "${threadId}" not found`);
    }
    return thread;
  }

  private setThreadStatus(threadId: string, status: CommentStatus, eventType: CommentEventType): void {
    this.assertNotDestroyed();

    const thread = this.getThreadOrThrow(threadId);
    thread.status = status;
    thread.updatedAt = Date.now();
    this.updateThread(thread);
    this.emitEvent(eventType, threadId);
  }

  private emitEvent(type: CommentEventType, threadId: string, commentId?: string, data?: unknown): void {
    this.eventsSubject.next({
      type,
      threadId,
      commentId,
      userId: this.userId,
      timestamp: Date.now(),
      data,
    });
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('CommentingSystem has been destroyed');
    }
  }
}

/**
 * Create a new CommentingSystem instance.
 */
export function createCommentingSystem(config: CommentingConfig): CommentingSystem {
  return new CommentingSystem(config);
}

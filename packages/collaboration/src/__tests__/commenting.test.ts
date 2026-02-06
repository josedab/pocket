import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take } from 'rxjs';
import {
  createCommentingSystem,
  CommentingSystem,
  type CommentThread,
  type CommentEvent,
} from '../commenting.js';

describe('CommentingSystem', () => {
  let system: CommentingSystem;

  beforeEach(() => {
    system = createCommentingSystem({ userId: 'user-1' });
  });

  afterEach(() => {
    system.destroy();
  });

  describe('createCommentingSystem', () => {
    it('should return a CommentingSystem instance', () => {
      expect(system).toBeInstanceOf(CommentingSystem);
    });
  });

  describe('createThread', () => {
    it('should create a new thread on a document', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Hello world',
      });

      expect(thread.id).toBeDefined();
      expect(thread.documentId).toBe('doc-1');
      expect(thread.status).toBe('open');
      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0]!.body).toBe('Hello world');
      expect(thread.comments[0]!.authorId).toBe('user-1');
    });

    it('should support an optional fieldPath', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Field comment',
        fieldPath: 'content.body',
      });

      expect(thread.fieldPath).toBe('content.body');
    });

    it('should parse mentions from body text', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Hey @alice and @bob',
      });

      const mentions = thread.comments[0]!.mentions;
      expect(mentions).toHaveLength(2);
      expect(mentions.map((m) => m.userId)).toContain('alice');
      expect(mentions.map((m) => m.userId)).toContain('bob');
    });

    it('should merge explicit mentions with parsed mentions', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Hey @alice',
        mentions: [{ userId: 'bob', displayName: 'Bob' }],
      });

      const mentions = thread.comments[0]!.mentions;
      expect(mentions).toHaveLength(2);
      expect(mentions.find((m) => m.userId === 'bob')?.displayName).toBe('Bob');
    });
  });

  describe('reply', () => {
    it('should add a reply to a thread', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Initial comment',
      });

      const reply = system.reply(thread.id, { body: 'Reply text' });

      expect(reply.threadId).toBe(thread.id);
      expect(reply.body).toBe('Reply text');
      expect(reply.authorId).toBe('user-1');

      const updated = system.getThread(thread.id);
      expect(updated!.comments).toHaveLength(2);
    });

    it('should throw when replying to non-existent thread', () => {
      expect(() => system.reply('non-existent', { body: 'test' })).toThrow(
        'Thread "non-existent" not found',
      );
    });
  });

  describe('updateComment', () => {
    it('should modify comment body', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Original body',
      });
      const commentId = thread.comments[0]!.id;

      system.updateComment(thread.id, commentId, 'Updated body');

      const updated = system.getThread(thread.id);
      expect(updated!.comments[0]!.body).toBe('Updated body');
    });

    it('should re-parse mentions on update', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'Hey @alice',
      });
      const commentId = thread.comments[0]!.id;

      system.updateComment(thread.id, commentId, 'Hey @bob');

      const updated = system.getThread(thread.id);
      const mentions = updated!.comments[0]!.mentions;
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.userId).toBe('bob');
    });

    it('should throw for non-existent comment', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      expect(() =>
        system.updateComment(thread.id, 'bad-id', 'new body'),
      ).toThrow('Comment "bad-id" not found');
    });
  });

  describe('deleteComment', () => {
    it('should remove a comment from the thread', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'first',
      });
      const reply = system.reply(thread.id, { body: 'second' });

      system.deleteComment(thread.id, reply.id);

      const updated = system.getThread(thread.id);
      expect(updated!.comments).toHaveLength(1);
      expect(updated!.comments[0]!.body).toBe('first');
    });

    it('should throw for non-existent comment', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      expect(() => system.deleteComment(thread.id, 'bad-id')).toThrow(
        'Comment "bad-id" not found',
      );
    });
  });

  describe('resolveThread', () => {
    it('should mark thread as resolved', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      system.resolveThread(thread.id);

      const updated = system.getThread(thread.id);
      expect(updated!.status).toBe('resolved');
    });

    it('should allow resolving an already resolved thread', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      system.resolveThread(thread.id);
      system.resolveThread(thread.id);

      expect(system.getThread(thread.id)!.status).toBe('resolved');
    });
  });

  describe('reopenThread', () => {
    it('should reopen a resolved thread', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      system.resolveThread(thread.id);

      system.reopenThread(thread.id);

      expect(system.getThread(thread.id)!.status).toBe('open');
    });
  });

  describe('addReaction', () => {
    it('should add an emoji reaction to a comment', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      const commentId = thread.comments[0]!.id;

      system.addReaction(thread.id, commentId, '👍');

      const updated = system.getThread(thread.id);
      const reactions = updated!.comments[0]!.reactions;
      expect(reactions).toHaveLength(1);
      expect(reactions[0]!.emoji).toBe('👍');
      expect(reactions[0]!.userIds).toContain('user-1');
    });

    it('should not duplicate reaction from same user', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      const commentId = thread.comments[0]!.id;

      system.addReaction(thread.id, commentId, '👍');
      system.addReaction(thread.id, commentId, '👍');

      const updated = system.getThread(thread.id);
      const reaction = updated!.comments[0]!.reactions.find(
        (r) => r.emoji === '👍',
      );
      expect(reaction!.userIds).toHaveLength(1);
    });
  });

  describe('removeReaction', () => {
    it('should remove an emoji reaction from a comment', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      const commentId = thread.comments[0]!.id;

      system.addReaction(thread.id, commentId, '👍');
      system.removeReaction(thread.id, commentId, '👍');

      const updated = system.getThread(thread.id);
      expect(updated!.comments[0]!.reactions).toHaveLength(0);
    });

    it('should be a no-op if reaction does not exist', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      const commentId = thread.comments[0]!.id;

      expect(() =>
        system.removeReaction(thread.id, commentId, '🎉'),
      ).not.toThrow();
    });
  });

  describe('getThread', () => {
    it('should return a thread by ID', () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      const result = system.getThread(thread.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(thread.id);
    });

    it('should return undefined for non-existent thread', () => {
      expect(system.getThread('non-existent')).toBeUndefined();
    });
  });

  describe('getThreadsForDocument', () => {
    it('should return all threads for a document', () => {
      system.createThread({ documentId: 'doc-1', body: 'thread 1' });
      system.createThread({ documentId: 'doc-1', body: 'thread 2' });
      system.createThread({ documentId: 'doc-2', body: 'thread 3' });

      const threads = system.getThreadsForDocument('doc-1');
      expect(threads).toHaveLength(2);
      threads.forEach((t) => expect(t.documentId).toBe('doc-1'));
    });

    it('should return empty array when no threads exist', () => {
      expect(system.getThreadsForDocument('doc-none')).toHaveLength(0);
    });
  });

  describe('threads$', () => {
    it('should emit updates when threads change', async () => {
      const threadsPromise = firstValueFrom(system.threads$.pipe(take(1)));
      const threads = await threadsPromise;
      expect(threads).toEqual([]);
    });

    it('should emit after creating a thread', async () => {
      system.createThread({ documentId: 'doc-1', body: 'test' });

      const threads = await firstValueFrom(system.threads$.pipe(take(1)));
      expect(threads).toHaveLength(1);
    });
  });

  describe('events$', () => {
    it('should emit thread-created event', async () => {
      const eventPromise = firstValueFrom(system.events$.pipe(take(1)));

      system.createThread({ documentId: 'doc-1', body: 'test' });

      const event = await eventPromise;
      expect(event.type).toBe('thread-created');
      expect(event.userId).toBe('user-1');
    });

    it('should emit comment-added event on reply', async () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      const eventPromise = firstValueFrom(system.events$.pipe(take(1)));
      system.reply(thread.id, { body: 'reply' });

      const event = await eventPromise;
      expect(event.type).toBe('comment-added');
    });

    it('should emit thread-resolved event', async () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });

      const eventPromise = firstValueFrom(system.events$.pipe(take(1)));
      system.resolveThread(thread.id);

      const event = await eventPromise;
      expect(event.type).toBe('thread-resolved');
    });

    it('should emit reaction-added event', async () => {
      const thread = system.createThread({
        documentId: 'doc-1',
        body: 'test',
      });
      const commentId = thread.comments[0]!.id;

      const eventPromise = firstValueFrom(system.events$.pipe(take(1)));
      system.addReaction(thread.id, commentId, '👍');

      const event = await eventPromise;
      expect(event.type).toBe('reaction-added');
      expect(event.data).toEqual({ emoji: '👍' });
    });
  });

  describe('destroy', () => {
    it('should throw on operations after destroy', () => {
      system.destroy();

      expect(() =>
        system.createThread({ documentId: 'doc-1', body: 'test' }),
      ).toThrow('CommentingSystem has been destroyed');
    });

    it('should be idempotent', () => {
      system.destroy();
      expect(() => system.destroy()).not.toThrow();
    });
  });
});

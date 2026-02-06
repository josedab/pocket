import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CollaborationSession,
  createCollaborationSession,
  type CursorUpdate,
  type Participant,
  type SelectionUpdate,
} from '../collaboration-session.js';

describe('CollaborationSession', () => {
  let session: CollaborationSession;

  beforeEach(() => {
    session = createCollaborationSession({
      roomId: 'room-1',
      userId: 'user-1',
      userName: 'Alice',
      userColor: '#E91E63',
    });
  });

  afterEach(() => {
    session.destroy();
  });

  describe('join and leave', () => {
    it('should join the room and add local user as participant', () => {
      session.join();

      expect(session.isConnected()).toBe(true);

      const participants = session.getParticipants();
      expect(participants).toHaveLength(1);
      expect(participants[0].userId).toBe('user-1');
      expect(participants[0].userName).toBe('Alice');
      expect(participants[0].color).toBe('#E91E63');
      expect(participants[0].status).toBe('online');
    });

    it('should leave the room and remove local user', () => {
      session.join();
      session.leave();

      expect(session.isConnected()).toBe(false);
      expect(session.getParticipants()).toHaveLength(0);
    });

    it('should not join if already connected', () => {
      session.join();
      session.join();

      expect(session.getParticipants()).toHaveLength(1);
    });

    it('should not leave if not connected', () => {
      session.leave();
      expect(session.isConnected()).toBe(false);
    });
  });

  describe('track participants', () => {
    it('should emit participants on join', () => {
      const emissions: Participant[][] = [];

      session.participants$.subscribe((p) => {
        emissions.push(p);
      });

      session.join();

      // BehaviorSubject initial + join
      expect(emissions).toHaveLength(2);
      expect(emissions[0]).toHaveLength(0);
      expect(emissions[1]).toHaveLength(1);
      expect(emissions[1][0].userId).toBe('user-1');
    });

    it('should emit participants on leave', () => {
      session.join();

      const emissions: Participant[][] = [];
      session.participants$.subscribe((p) => {
        emissions.push(p);
      });

      session.leave();

      // BehaviorSubject current (1 user) + leave (0 users)
      expect(emissions).toHaveLength(2);
      expect(emissions[1]).toHaveLength(0);
    });
  });

  describe('cursor positions', () => {
    it('should update and get cursor positions', () => {
      session.join();

      session.updateCursorPosition({ x: 100, y: 200, elementId: 'editor' });

      const cursors = session.getActiveCursors();
      expect(cursors.size).toBe(1);
      expect(cursors.get('user-1')).toEqual({ x: 100, y: 200, elementId: 'editor' });
    });

    it('should emit cursor updates via observable', () => {
      session.join();

      const emissions: Map<string, CursorUpdate>[] = [];
      session.cursors$.subscribe((c) => {
        emissions.push(c);
      });

      session.updateCursorPosition({ x: 10, y: 20 });
      session.updateCursorPosition({ x: 30, y: 40 });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].get('user-1')).toEqual({ x: 30, y: 40 });
    });

    it('should not update cursor when not connected', () => {
      session.updateCursorPosition({ x: 100, y: 200 });

      expect(session.getActiveCursors().size).toBe(0);
    });
  });

  describe('selections', () => {
    it('should update and emit selections', () => {
      session.join();

      const emissions: Map<string, SelectionUpdate>[] = [];
      session.selections$.subscribe((s) => {
        emissions.push(s);
      });

      session.updateSelection({ start: 10, end: 25, elementId: 'editor' });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].get('user-1')).toEqual({
        start: 10,
        end: 25,
        elementId: 'editor',
      });
    });

    it('should not update selection when not connected', () => {
      const emissions: Map<string, SelectionUpdate>[] = [];
      session.selections$.subscribe((s) => {
        emissions.push(s);
      });

      session.updateSelection({ start: 0, end: 5 });

      expect(emissions).toHaveLength(0);
    });
  });

  describe('typing state', () => {
    it('should broadcast typing state', () => {
      session.join();

      const emissions: Participant[][] = [];
      session.participants$.subscribe((p) => {
        emissions.push(p);
      });

      session.setTyping(true);

      // BehaviorSubject current value + typing update
      expect(emissions.length).toBeGreaterThanOrEqual(2);
      expect(emissions[emissions.length - 1][0].status).toBe('online');
    });

    it('should not set typing when not connected', () => {
      const emissions: Participant[][] = [];
      session.participants$.subscribe((p) => {
        emissions.push(p);
      });

      session.setTyping(true);

      // Only BehaviorSubject initial emission
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('should clean up all resources on destroy', () => {
      session.join();
      session.updateCursorPosition({ x: 10, y: 20 });
      session.updateSelection({ start: 0, end: 5 });

      session.destroy();

      expect(session.isConnected()).toBe(false);
      expect(session.getParticipants()).toHaveLength(0);
      expect(session.getActiveCursors().size).toBe(0);
    });

    it('should complete observables on destroy', () => {
      let participantsCompleted = false;
      let cursorsCompleted = false;
      let selectionsCompleted = false;

      session.participants$.subscribe({
        complete: () => {
          participantsCompleted = true;
        },
      });
      session.cursors$.subscribe({
        complete: () => {
          cursorsCompleted = true;
        },
      });
      session.selections$.subscribe({
        complete: () => {
          selectionsCompleted = true;
        },
      });

      session.destroy();

      expect(participantsCompleted).toBe(true);
      expect(cursorsCompleted).toBe(true);
      expect(selectionsCompleted).toBe(true);
    });

    it('should prevent operations after destroy', () => {
      session.destroy();

      session.join();
      expect(session.isConnected()).toBe(false);
      expect(session.getParticipants()).toHaveLength(0);
    });

    it('should generate a default color when userColor is not provided', () => {
      const s = createCollaborationSession({
        roomId: 'room-2',
        userId: 'user-2',
        userName: 'Bob',
      });

      s.join();

      const participants = s.getParticipants();
      expect(participants[0].color).toBeTruthy();
      expect(typeof participants[0].color).toBe('string');

      s.destroy();
    });
  });

  describe('createCollaborationSession factory', () => {
    it('should create a session instance', () => {
      const s = createCollaborationSession({
        roomId: 'room-test',
        userId: 'user-test',
        userName: 'Test',
      });

      expect(s).toBeInstanceOf(CollaborationSession);
      s.destroy();
    });
  });
});

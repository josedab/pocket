import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SessionRecorder,
  createSessionRecorder,
  type InteractionEvent,
} from '../session-recorder.js';

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;

  beforeEach(() => {
    recorder = createSessionRecorder();
  });

  afterEach(() => {
    recorder.destroy();
  });

  describe('session lifecycle', () => {
    it('should start a session and return ID', () => {
      const sessionId = recorder.startSession();
      expect(sessionId).toMatch(/^session_/);
      expect(recorder.getStatus().isRecording).toBe(true);
    });

    it('should stop a session and return recorded data', () => {
      recorder.startSession();
      recorder.recordClick('button.submit', { x: 100, y: 200 }, '/home');
      const session = recorder.stopSession();
      expect(session).not.toBeNull();
      expect(session!.eventCount).toBe(1);
      expect(session!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return null when stopping with no active session', () => {
      expect(recorder.stopSession()).toBeNull();
    });
  });

  describe('event recording', () => {
    it('should record click events', () => {
      recorder.startSession();
      recorder.recordClick('button.save', { x: 50, y: 100 }, '/form');
      const session = recorder.getCurrentSession()!;
      expect(session.eventCount).toBe(1);
      expect(session.events[0]!.type).toBe('click');
    });

    it('should record navigation events', () => {
      recorder.startSession();
      recorder.recordNavigation('/dashboard');
      recorder.recordNavigation('/settings');
      const session = recorder.getCurrentSession()!;
      expect(session.pagesVisited).toContain('/dashboard');
      expect(session.pagesVisited).toContain('/settings');
    });

    it('should record custom events', () => {
      recorder.startSession();
      recorder.recordCustom('purchase', { amount: 49.99 });
      const session = recorder.getCurrentSession()!;
      expect(session.events[0]!.type).toBe('custom');
    });

    it('should record error events', () => {
      recorder.startSession();
      recorder.recordError('Network failed', { statusCode: 500 });
      const session = recorder.getCurrentSession()!;
      expect(session.events[0]!.type).toBe('error');
    });

    it('should not record scroll events by default', () => {
      recorder.startSession();
      recorder.recordScroll({ x: 0, y: 500 });
      expect(recorder.getCurrentSession()!.eventCount).toBe(0);
    });

    it('should record scroll events when enabled', () => {
      const r = createSessionRecorder({ recordScroll: true });
      r.startSession();
      r.recordScroll({ x: 0, y: 500 }, '/page');
      expect(r.getCurrentSession()!.eventCount).toBe(1);
      r.destroy();
    });
  });

  describe('privacy masking', () => {
    it('should mask events matching configured selectors', () => {
      const r = createSessionRecorder({ maskSelectors: ['input[type="password"]'] });
      r.startSession();
      r.recordClick('input[type="password"]', { x: 10, y: 10 });
      expect(r.getCurrentSession()!.eventCount).toBe(0);
      r.destroy();
    });
  });

  describe('heatmap data', () => {
    it('should generate heatmap data from click events', () => {
      recorder.startSession();
      recorder.recordClick('btn', { x: 100, y: 200 }, '/page');
      recorder.recordClick('btn', { x: 102, y: 198 }, '/page');
      recorder.recordClick('btn', { x: 300, y: 400 }, '/page');

      const heatmap = recorder.getHeatmapData('/page');
      expect(heatmap.length).toBeGreaterThan(0);
      // Two clicks near each other should bucket together (10px grid)
      const bucket100 = heatmap.find((h) => h.x === 100 && h.y === 200);
      expect(bucket100?.count).toBe(2);
    });

    it('should return empty heatmap for unknown path', () => {
      recorder.startSession();
      expect(recorder.getHeatmapData('/unknown')).toHaveLength(0);
    });
  });

  describe('event limit', () => {
    it('should stop recording when max events reached', () => {
      const r = createSessionRecorder({ maxEventsPerSession: 3 });
      r.startSession();
      for (let i = 0; i < 10; i++) {
        r.recordCustom(`event-${i}`);
      }
      expect(r.getCurrentSession()!.eventCount).toBe(3);
      r.destroy();
    });
  });

  describe('session management', () => {
    it('should list session IDs', () => {
      recorder.startSession();
      recorder.stopSession();
      recorder.startSession();
      expect(recorder.getSessionIds()).toHaveLength(2);
    });

    it('should retrieve session by ID', () => {
      const id = recorder.startSession();
      recorder.recordCustom('test');
      const session = recorder.getSession(id);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(id);
    });
  });

  describe('live event stream', () => {
    it('should emit events through observable', () => {
      const events: InteractionEvent[] = [];
      recorder.interactionEvents$.subscribe((e) => events.push(e));
      recorder.startSession();
      recorder.recordClick('btn', { x: 10, y: 20 });
      expect(events).toHaveLength(1);
    });
  });

  describe('status', () => {
    it('should report accurate status', () => {
      expect(recorder.getStatus().isRecording).toBe(false);
      recorder.startSession();
      expect(recorder.getStatus().isRecording).toBe(true);
      expect(recorder.getStatus().sessionsStored).toBe(1);
    });
  });
});

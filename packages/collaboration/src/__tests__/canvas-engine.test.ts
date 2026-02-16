import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasEngine, createCanvasEngine } from '../canvas-engine.js';
import type { CollabTransport, CollabMessage } from '../types.js';

function createMockTransport(): CollabTransport & { handlers: ((msg: CollabMessage) => void)[] } {
  const handlers: ((msg: CollabMessage) => void)[] = [];
  return {
    handlers,
    send: vi.fn(),
    onMessage(handler) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
}

describe('CanvasEngine', () => {
  let engine: CanvasEngine;
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(async () => {
    transport = createMockTransport();
    engine = createCanvasEngine({
      sessionId: 'test-session',
      user: { id: 'user-1', name: 'Alice', color: '#FF0000' },
      transport,
    });
    await engine.connect();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('shape operations', () => {
    it('should add a shape', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 10, y: 20, width: 100, height: 50,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      expect(shape.id).toBeDefined();
      expect(shape.createdBy).toBe('user-1');
      expect(shape.locked).toBe(false);
      expect(shape.x).toBe(10);
      expect(transport.send).toHaveBeenCalled();
    });

    it('should update a shape', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.updateShape(shape.id, { x: 50, y: 50 });

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      const updated = current?.get(shape.id) as { x: number; y: number } | undefined;
      expect(updated?.x).toBe(50);
      expect(updated?.y).toBe(50);
    });

    it('should delete a shape', () => {
      const shape = engine.addShape({
        type: 'ellipse',
        x: 0, y: 0, width: 50, height: 50,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.deleteShape(shape.id);

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect(current?.has(shape.id)).toBe(false);
    });

    it('should move a shape', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.moveShape(shape.id, 200, 300);

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      const moved = current?.get(shape.id) as { x: number; y: number } | undefined;
      expect(moved?.x).toBe(200);
      expect(moved?.y).toBe(300);
    });

    it('should throw on max shapes exceeded', () => {
      const smallEngine = createCanvasEngine({
        sessionId: 's',
        user: { id: 'u', name: 'U' },
        transport,
        maxShapes: 2,
      });

      const baseShape = {
        type: 'rectangle' as const,
        x: 0, y: 0, width: 10, height: 10,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      };

      smallEngine.addShape(baseShape);
      smallEngine.addShape(baseShape);
      expect(() => smallEngine.addShape(baseShape)).toThrow('Maximum shape limit');
      smallEngine.dispose();
    });
  });

  describe('lock/unlock', () => {
    it('should lock and unlock shapes', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.lockShape(shape.id);
      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect((current?.get(shape.id) as { locked: boolean } | undefined)?.locked).toBe(true);

      engine.unlockShape(shape.id);
      engine.shapes$.subscribe((s) => { current = s; });
      expect((current?.get(shape.id) as { locked: boolean } | undefined)?.locked).toBe(false);
    });
  });

  describe('selection', () => {
    it('should select and clear shapes', () => {
      const shape1 = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.select([shape1.id]);
      let sel: Set<string> | undefined;
      engine.selection$.subscribe((s) => { sel = s; });
      expect(sel?.has(shape1.id)).toBe(true);

      engine.clearSelection();
      engine.selection$.subscribe((s) => { sel = s; });
      expect(sel?.size).toBe(0);
    });
  });

  describe('undo/redo', () => {
    it('should undo shape addition', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      expect(engine.canUndo).toBe(true);
      engine.undo();

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect(current?.has(shape.id)).toBe(false);
      expect(engine.canRedo).toBe(true);
    });

    it('should redo after undo', () => {
      const shape = engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      engine.undo();
      engine.redo();

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect(current?.size).toBe(1);
    });
  });

  describe('snapshot', () => {
    it('should export and restore snapshots', () => {
      engine.addShape({
        type: 'rectangle',
        x: 10, y: 20, width: 100, height: 50,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      const snapshot = engine.toSnapshot();
      expect(snapshot.shapes).toHaveLength(1);
      expect(snapshot.zOrder).toHaveLength(1);

      // Restore on new engine
      const engine2 = createCanvasEngine({
        sessionId: 'test-2',
        user: { id: 'user-2', name: 'Bob' },
        transport: createMockTransport(),
      });
      engine2.fromSnapshot(snapshot);

      let current: Map<string, unknown> | undefined;
      engine2.shapes$.subscribe((s) => { current = s; });
      expect(current?.size).toBe(1);
      engine2.dispose();
    });
  });

  describe('remote operations', () => {
    it('should apply remote shape operations', () => {
      // Simulate a remote user adding a shape
      const handler = transport.handlers[0]!;
      handler({
        type: 'operation',
        sessionId: 'test-session',
        userId: 'remote-user',
        payload: {
          id: 'op-1',
          type: 'shape-add',
          shapeId: 'remote-shape-1',
          userId: 'remote-user',
          lamport: 5,
          timestamp: Date.now(),
          data: {
            id: 'remote-shape-1',
            type: 'ellipse',
            x: 100, y: 200, width: 50, height: 50,
            rotation: 0,
            style: { fill: '#00F', stroke: '#000', strokeWidth: 1, opacity: 1 },
            createdBy: 'remote-user',
            lamport: 5,
            locked: false,
          },
        },
        timestamp: Date.now(),
      });

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect(current?.has('remote-shape-1')).toBe(true);
    });

    it('should ignore messages from self', () => {
      const handler = transport.handlers[0]!;
      handler({
        type: 'operation',
        sessionId: 'test-session',
        userId: 'user-1', // same as local user
        payload: {
          id: 'op-1',
          type: 'shape-add',
          shapeId: 'self-shape',
          userId: 'user-1',
          lamport: 1,
          timestamp: Date.now(),
          data: {
            id: 'self-shape',
            type: 'rectangle',
            x: 0, y: 0, width: 10, height: 10,
            rotation: 0,
            style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
            createdBy: 'user-1',
            lamport: 1,
            locked: false,
          },
        },
        timestamp: Date.now(),
      });

      let current: Map<string, unknown> | undefined;
      engine.shapes$.subscribe((s) => { current = s; });
      expect(current?.has('self-shape')).toBe(false);
    });
  });

  describe('region selection', () => {
    it('should find shapes in region', () => {
      engine.addShape({
        type: 'rectangle',
        x: 10, y: 10, width: 20, height: 20,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });
      engine.addShape({
        type: 'rectangle',
        x: 500, y: 500, width: 20, height: 20,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      });

      const inRegion = engine.getShapesInRegion({ x: 0, y: 0 }, { x: 100, y: 100 });
      expect(inRegion).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should throw after dispose', () => {
      engine.dispose();
      expect(() => engine.addShape({
        type: 'rectangle',
        x: 0, y: 0, width: 10, height: 10,
        rotation: 0,
        style: { fill: '#FFF', stroke: '#000', strokeWidth: 1, opacity: 1 },
      })).toThrow('disposed');
    });
  });
});

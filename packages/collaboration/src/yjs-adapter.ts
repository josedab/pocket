/**
 * Yjs Adapter - Bridges Pocket collaboration with Yjs CRDT documents.
 *
 * Provides a lightweight adapter layer that maps Pocket document operations
 * to Yjs shared types (YDoc, YMap, YText, YArray), enabling integration
 * with the Yjs ecosystem (y-webrtc, y-websocket, y-indexeddb).
 *
 * @module yjs-adapter
 */

import type { CollabTransport, CollabMessage, DocumentOperation } from './types.js';

/** Yjs document-like interface (avoids hard dependency on yjs) */
export interface YDocLike {
  getMap(name: string): YMapLike;
  getText(name: string): YTextLike;
  getArray(name: string): YArrayLike;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  transact(fn: () => void): void;
}

export interface YMapLike {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  delete(key: string): void;
  has(key: string): boolean;
  toJSON(): Record<string, unknown>;
}

export interface YTextLike {
  insert(index: number, content: string): void;
  delete(index: number, length: number): void;
  toString(): string;
  readonly length: number;
}

export interface YArrayLike {
  insert(index: number, content: unknown[]): void;
  delete(index: number, length: number): void;
  toArray(): unknown[];
  readonly length: number;
}

/** Configuration for the Yjs adapter */
export interface YjsAdapterConfig {
  /** Yjs document instance */
  readonly doc: YDocLike;
  /** Pocket transport for syncing operations */
  readonly transport?: CollabTransport;
  /** Map name for document state (default: 'pocket') */
  readonly mapName?: string;
}

/** Event from the Yjs adapter */
export interface YjsAdapterEvent {
  readonly type: 'local-update' | 'remote-update' | 'synced';
  readonly timestamp: number;
  readonly field?: string;
}

/**
 * Bridges Pocket collaboration with Yjs CRDT documents.
 *
 * @example
 * ```typescript
 * import { createYjsAdapter } from '@pocket/collaboration';
 * import * as Y from 'yjs';
 *
 * const ydoc = new Y.Doc();
 * const adapter = createYjsAdapter({ doc: ydoc });
 *
 * // Apply Pocket operations to Yjs
 * adapter.applyOperations([
 *   { type: 'set', path: 'title', value: 'Hello World' },
 *   { type: 'set', path: 'count', value: 42 },
 * ]);
 *
 * // Read back from Yjs
 * const state = adapter.getState();
 * console.log(state.title); // 'Hello World'
 *
 * // Listen for remote changes
 * adapter.onChange((event) => {
 *   console.log('Yjs updated:', event.field);
 * });
 * ```
 */
export class YjsAdapter {
  private readonly doc: YDocLike;
  private readonly mapName: string;
  private readonly listeners: Array<(event: YjsAdapterEvent) => void> = [];
  private readonly transport?: CollabTransport;
  private unsubTransport?: () => void;

  constructor(config: YjsAdapterConfig) {
    this.doc = config.doc;
    this.mapName = config.mapName ?? 'pocket';
    this.transport = config.transport;

    if (this.transport) {
      this.unsubTransport = this.transport.onMessage((msg) => {
        this.handleTransportMessage(msg);
      });
    }
  }

  /** Get the Yjs map for this adapter */
  getMap(): YMapLike {
    return this.doc.getMap(this.mapName);
  }

  /** Get the current state as a plain object */
  getState(): Record<string, unknown> {
    return this.getMap().toJSON();
  }

  /** Apply Pocket document operations to the Yjs document */
  applyOperations(operations: DocumentOperation[]): void {
    this.doc.transact(() => {
      const map = this.getMap();
      for (const op of operations) {
        switch (op.type) {
          case 'set':
            map.set(op.path, op.value);
            break;
          case 'delete':
            map.delete(op.path);
            break;
          case 'insert-text': {
            const text = this.doc.getText(`${this.mapName}:${op.path}`);
            if (typeof op.value === 'string') {
              text.insert(0, op.value);
            }
            break;
          }
          case 'delete-text': {
            const text = this.doc.getText(`${this.mapName}:${op.path}`);
            if (typeof op.value === 'number') {
              text.delete(0, op.value);
            }
            break;
          }
        }
      }
    });

    this.emitEvent({ type: 'local-update', timestamp: Date.now() });
  }

  /** Register a change listener */
  onChange(handler: (event: YjsAdapterEvent) => void): () => void {
    this.listeners.push(handler);
    return () => {
      const idx = this.listeners.indexOf(handler);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Convert a Yjs state diff to Pocket operations */
  stateToOperations(state: Record<string, unknown>): DocumentOperation[] {
    const ops: DocumentOperation[] = [];
    for (const [key, value] of Object.entries(state)) {
      ops.push({ type: 'set', path: key, value });
    }
    return ops;
  }

  /** Destroy the adapter and clean up */
  destroy(): void {
    this.listeners.length = 0;
    if (this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = undefined;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  private handleTransportMessage(msg: CollabMessage): void {
    if (msg.type !== 'operation' || !msg.payload) return;
    const payload = msg.payload as { operations?: DocumentOperation[] };
    if (payload.operations) {
      this.applyOperations(payload.operations);
      this.emitEvent({ type: 'remote-update', timestamp: Date.now() });
    }
  }

  private emitEvent(event: YjsAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Factory function to create a YjsAdapter */
export function createYjsAdapter(config: YjsAdapterConfig): YjsAdapter {
  return new YjsAdapter(config);
}

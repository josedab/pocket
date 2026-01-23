/**
 * @pocket/presence - Real-time presence and multiplayer cursors
 *
 * @example
 * ```typescript
 * import {
 *   createPresenceManager,
 *   createCursorTracker,
 *   createWebSocketTransport,
 * } from '@pocket/presence';
 *
 * // Create transport
 * const transport = createWebSocketTransport({
 *   url: 'wss://your-server.com/presence',
 * });
 *
 * // Create presence manager
 * const presence = createPresenceManager(transport, {
 *   user: {
 *     id: 'user-123',
 *     name: 'Alice',
 *   },
 * });
 *
 * // Connect and join room
 * await presence.connect();
 * await presence.joinRoom('document-456');
 *
 * // Track cursor movements
 * const cursorStream = presence.createCursorStream();
 * document.addEventListener('mousemove', (e) => {
 *   cursorStream.next({ x: e.clientX, y: e.clientY });
 * });
 *
 * // Render other users' cursors
 * const tracker = createCursorTracker();
 * presence.events.subscribe((event) => {
 *   if (event.type === 'cursor_move' && event.presence?.cursor) {
 *     const user = presence.getRoomUsers(event.roomId)
 *       .find(u => u.user.id === event.userId);
 *     if (user) {
 *       tracker.updateFromPresence(user);
 *     }
 *   }
 * });
 * ```
 */

// Types
export type {
  AwarenessState,
  CursorPosition,
  CursorRenderOptions,
  PresenceConfig,
  PresenceEvent,
  PresenceEventType,
  PresenceMessage,
  PresenceRoom,
  PresenceStatus,
  PresenceTransport,
  PresenceUser,
  UserPresence,
} from './types.js';

export { CURSOR_COLORS, DEFAULT_PRESENCE_CONFIG, generateUserColor } from './types.js';

// Presence Manager
export { PresenceManager, createPresenceManager } from './presence-manager.js';

// Cursor Tracker
export type { CursorHooks, TrackedCursor } from './cursor-tracker.js';

export { CursorTracker, createCursorTracker, createUseCursorsHook } from './cursor-tracker.js';

// Transports
export {
  BroadcastChannelTransport,
  WebSocketTransport,
  createBroadcastChannelTransport,
  createWebSocketTransport,
} from './transports/index.js';

export type { WebSocketTransportConfig } from './transports/index.js';

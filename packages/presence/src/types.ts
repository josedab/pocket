/**
 * Types for real-time presence and multiplayer cursors
 */

/**
 * User presence status
 */
export type PresenceStatus = 'online' | 'away' | 'offline';

/**
 * User information for presence
 */
export interface PresenceUser {
  /** Unique user identifier */
  id: string;
  /** Display name */
  name?: string;
  /** Avatar URL */
  avatar?: string;
  /** User color for cursors/selections */
  color?: string;
  /** Additional user metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cursor position in a document
 */
export interface CursorPosition {
  /** X coordinate (for canvas/2D) */
  x?: number;
  /** Y coordinate (for canvas/2D) */
  y?: number;
  /** Character offset in text */
  offset?: number;
  /** Line number (for text editors) */
  line?: number;
  /** Column number (for text editors) */
  column?: number;
  /** Element ID or path (for structured documents) */
  elementId?: string;
  /** Selection start (for text selection) */
  selectionStart?: number;
  /** Selection end (for text selection) */
  selectionEnd?: number;
}

/**
 * User presence state
 */
export interface UserPresence {
  /** User information */
  user: PresenceUser;
  /** Current status */
  status: PresenceStatus;
  /** Current cursor position */
  cursor?: CursorPosition;
  /** Last activity timestamp */
  lastActive: number;
  /** Document/room the user is in */
  documentId?: string;
  /** Custom presence data */
  data?: Record<string, unknown>;
}

/**
 * Presence room/channel
 */
export interface PresenceRoom {
  /** Room identifier */
  id: string;
  /** Room name */
  name?: string;
  /** Users currently in the room */
  users: Map<string, UserPresence>;
  /** Room metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Presence event types
 */
export type PresenceEventType = 'join' | 'leave' | 'update' | 'cursor_move' | 'status_change';

/**
 * Presence event
 */
export interface PresenceEvent {
  /** Event type */
  type: PresenceEventType;
  /** User who triggered the event */
  userId: string;
  /** Room where event occurred */
  roomId: string;
  /** Updated presence data */
  presence?: Partial<UserPresence>;
  /** Event timestamp */
  timestamp: number;
}

/**
 * Presence message for transport
 */
export interface PresenceMessage {
  /** Message type */
  type: 'presence' | 'cursor' | 'sync' | 'heartbeat';
  /** Sender user ID */
  userId: string;
  /** Target room */
  roomId: string;
  /** Message payload */
  payload: unknown;
  /** Message timestamp */
  timestamp: number;
}

/**
 * Configuration for presence manager
 */
export interface PresenceConfig {
  /** Current user */
  user: PresenceUser;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
  /** Away timeout in ms (time before marking user as away) */
  awayTimeout?: number;
  /** Offline timeout in ms (time before marking user as offline) */
  offlineTimeout?: number;
  /** Cursor throttle interval in ms */
  cursorThrottleMs?: number;
  /** Whether to track cursor position */
  trackCursor?: boolean;
  /** Maximum users to track per room */
  maxUsersPerRoom?: number;
}

/**
 * Transport layer interface for presence
 */
export interface PresenceTransport {
  /** Connect to transport */
  connect(): Promise<void>;
  /** Disconnect from transport */
  disconnect(): Promise<void>;
  /** Send a presence message */
  send(message: PresenceMessage): Promise<void>;
  /** Subscribe to messages for a room */
  subscribe(roomId: string, callback: (message: PresenceMessage) => void): () => void;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Cursor renderer options
 */
export interface CursorRenderOptions {
  /** Show user name label */
  showLabel?: boolean;
  /** Label font size */
  labelFontSize?: number;
  /** Cursor size */
  cursorSize?: number;
  /** Animation duration in ms */
  animationDuration?: number;
  /** Z-index for cursor elements */
  zIndex?: number;
}

/**
 * Awareness state (compatible with y-protocols awareness)
 */
export interface AwarenessState {
  /** User info */
  user: PresenceUser;
  /** Cursor position */
  cursor?: CursorPosition;
  /** Selection range */
  selection?: {
    start: CursorPosition;
    end: CursorPosition;
  };
  /** Custom state data */
  [key: string]: unknown;
}

/**
 * Default presence configuration
 */
export const DEFAULT_PRESENCE_CONFIG: Required<Omit<PresenceConfig, 'user'>> = {
  heartbeatInterval: 30000,
  awayTimeout: 60000,
  offlineTimeout: 120000,
  cursorThrottleMs: 50,
  trackCursor: true,
  maxUsersPerRoom: 50,
};

/**
 * Generate a random color for a user
 */
export function generateUserColor(userId: string): string {
  // Generate a hash from the user ID
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Generate HSL color with good saturation and lightness for visibility
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Default cursor colors palette
 */
export const CURSOR_COLORS = [
  '#E91E63', // Pink
  '#9C27B0', // Purple
  '#673AB7', // Deep Purple
  '#3F51B5', // Indigo
  '#2196F3', // Blue
  '#00BCD4', // Cyan
  '#009688', // Teal
  '#4CAF50', // Green
  '#FF9800', // Orange
  '#FF5722', // Deep Orange
];

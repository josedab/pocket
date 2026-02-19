/**
 * React collaboration components — pre-built UI for real-time collaboration.
 *
 * Drop-in components for showing remote cursors, user avatars, presence
 * indicators, and collaborative editing status in React applications.
 *
 * @module react-components
 */

import type { CollabCursor, CollabSelection, CollabSessionStatus, CollabUser } from './types.js';

// ─── Component Props ─────────────────────────────────────────────────────────

/** Props for the collaborative cursors overlay */
export interface CollabCursorsProps {
  /** Active remote cursors */
  readonly cursors: readonly CollabCursor[];
  /** User info lookup map */
  readonly users: ReadonlyMap<string, CollabUser>;
  /** Whether to show cursor labels */
  readonly showLabels?: boolean;
  /** Cursor fade-out timeout in ms (0 = never) */
  readonly fadeTimeoutMs?: number;
  /** Custom CSS class name */
  readonly className?: string;
}

/** Props for the user presence bar */
export interface PresenceBarProps {
  /** Currently connected users */
  readonly users: readonly CollabUser[];
  /** Maximum avatars to show before "+N" */
  readonly maxVisible?: number;
  /** Current user ID (to exclude from display) */
  readonly currentUserId?: string;
  /** Avatar size in pixels */
  readonly avatarSize?: number;
  /** Custom CSS class name */
  readonly className?: string;
}

/** Props for the connection status indicator */
export interface ConnectionStatusProps {
  /** Current session status */
  readonly status: CollabSessionStatus;
  /** Whether to show detailed text */
  readonly showText?: boolean;
  /** Custom CSS class name */
  readonly className?: string;
}

/** Props for the collaborative selection highlight */
export interface SelectionHighlightProps {
  /** Active selections from remote users */
  readonly selections: readonly CollabSelection[];
  /** User info lookup map */
  readonly users: ReadonlyMap<string, CollabUser>;
  /** Custom CSS class name */
  readonly className?: string;
}

// ─── Render Descriptors ──────────────────────────────────────────────────────
// Framework-agnostic render descriptors that can be consumed by any renderer.
// This avoids a hard dependency on React while providing the component data model.

/** Rendered cursor position descriptor */
export interface CursorRenderDescriptor {
  readonly userId: string;
  readonly userName: string;
  readonly color: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly label: string;
  readonly isStale: boolean;
}

/** Rendered avatar descriptor */
export interface AvatarRenderDescriptor {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly avatar?: string;
  readonly initials: string;
}

/** Status indicator descriptor */
export interface StatusRenderDescriptor {
  readonly status: CollabSessionStatus;
  readonly color: string;
  readonly label: string;
  readonly isConnected: boolean;
}

// ─── Default Colors ──────────────────────────────────────────────────────────

const COLLABORATION_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#85929E', '#73C6B6',
] as const;

// ─── Component Logic (framework-agnostic) ────────────────────────────────────

/**
 * Generates render descriptors for remote cursors.
 * Can be consumed by React, Vue, or any other renderer.
 */
export function buildCursorDescriptors(
  props: CollabCursorsProps,
): CursorRenderDescriptor[] {
  const now = Date.now();
  const fadeTimeout = props.fadeTimeoutMs ?? 5000;

  return props.cursors
    .filter((cursor) => {
      if (fadeTimeout === 0) return true;
      return now - cursor.timestamp < fadeTimeout;
    })
    .map((cursor) => {
      const user = props.users.get(cursor.userId);
      return {
        userId: cursor.userId,
        userName: user?.name ?? 'Unknown',
        color: user?.color ?? assignColor(cursor.userId),
        position: {
          x: cursor.column ?? cursor.offset ?? 0,
          y: cursor.line ?? 0,
        },
        label: props.showLabels !== false ? (user?.name ?? 'Unknown') : '',
        isStale: fadeTimeout > 0 && now - cursor.timestamp > fadeTimeout * 0.7,
      };
    });
}

/**
 * Generates render descriptors for the presence bar.
 */
export function buildPresenceDescriptors(
  props: PresenceBarProps,
): { visible: AvatarRenderDescriptor[]; overflowCount: number } {
  const maxVisible = props.maxVisible ?? 5;
  const filtered = props.users.filter((u) => u.id !== props.currentUserId);

  const visible = filtered.slice(0, maxVisible).map((user) => ({
    userId: user.id,
    name: user.name,
    color: user.color ?? assignColor(user.id),
    avatar: user.avatar,
    initials: getInitials(user.name),
  }));

  return {
    visible,
    overflowCount: Math.max(0, filtered.length - maxVisible),
  };
}

/**
 * Generates a status indicator descriptor.
 */
export function buildStatusDescriptor(
  props: ConnectionStatusProps,
): StatusRenderDescriptor {
  const statusMap: Record<CollabSessionStatus, { color: string; label: string }> = {
    idle: { color: '#95A5A6', label: 'Idle' },
    connecting: { color: '#F39C12', label: 'Connecting…' },
    connected: { color: '#27AE60', label: 'Connected' },
    reconnecting: { color: '#E67E22', label: 'Reconnecting…' },
    disconnected: { color: '#E74C3C', label: 'Disconnected' },
  };

  const info = statusMap[props.status];
  return {
    status: props.status,
    color: info.color,
    label: props.showText !== false ? info.label : '',
    isConnected: props.status === 'connected',
  };
}

// ─── Collaboration CSS Theme ─────────────────────────────────────────────────

/** Default CSS custom properties for collaboration components */
export const COLLAB_CSS_VARS = {
  '--collab-cursor-width': '2px',
  '--collab-cursor-height': '1.2em',
  '--collab-avatar-size': '32px',
  '--collab-label-font-size': '12px',
  '--collab-label-padding': '2px 6px',
  '--collab-label-border-radius': '3px',
  '--collab-transition-duration': '150ms',
  '--collab-fade-opacity': '0.4',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % COLLABORATION_COLORS.length;
  return COLLABORATION_COLORS[idx]!;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

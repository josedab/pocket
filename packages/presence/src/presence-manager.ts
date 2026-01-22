/**
 * Presence Manager for real-time user presence tracking
 */

import { BehaviorSubject, Observable, Subject, interval } from 'rxjs';
import { filter, takeUntil, throttleTime } from 'rxjs/operators';
import type {
  CursorPosition,
  PresenceConfig,
  PresenceEvent,
  PresenceMessage,
  PresenceRoom,
  PresenceStatus,
  PresenceTransport,
  UserPresence,
} from './types.js';
import { DEFAULT_PRESENCE_CONFIG, generateUserColor } from './types.js';

/**
 * Manages real-time presence for multiple rooms
 */
export class PresenceManager {
  private readonly config: Required<PresenceConfig>;
  private readonly transport: PresenceTransport;
  private readonly rooms = new Map<string, PresenceRoom>();
  private readonly subscriptions = new Map<string, () => void>();

  private readonly events$ = new Subject<PresenceEvent>();
  private readonly destroy$ = new Subject<void>();
  private readonly localPresence$ = new BehaviorSubject<UserPresence | null>(null);

  private currentRoomId: string | null = null;
  private heartbeatSubscription: { unsubscribe: () => void } | null = null;
  private activityTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: PresenceTransport, config: PresenceConfig) {
    this.config = {
      ...DEFAULT_PRESENCE_CONFIG,
      ...config,
      user: {
        ...config.user,
        color: config.user.color ?? generateUserColor(config.user.id),
      },
    };
    this.transport = transport;
  }

  /**
   * Connect to presence service and start tracking
   */
  async connect(): Promise<void> {
    await this.transport.connect();
    this.startHeartbeat();
    this.setupActivityTracking();
  }

  /**
   * Disconnect from presence service
   */
  async disconnect(): Promise<void> {
    if (this.currentRoomId) {
      await this.leaveRoom(this.currentRoomId);
    }

    this.stopHeartbeat();
    this.clearActivityTimeout();
    this.destroy$.next();

    // Unsubscribe from all rooms
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();
    this.rooms.clear();

    await this.transport.disconnect();
  }

  /**
   * Join a presence room
   */
  async joinRoom(roomId: string): Promise<PresenceRoom> {
    // Leave current room if different
    if (this.currentRoomId && this.currentRoomId !== roomId) {
      await this.leaveRoom(this.currentRoomId);
    }

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        users: new Map(),
      });
    }

    const room = this.rooms.get(roomId)!;
    this.currentRoomId = roomId;

    // Set up local presence
    const localPresence: UserPresence = {
      user: this.config.user,
      status: 'online',
      lastActive: Date.now(),
      documentId: roomId,
    };

    room.users.set(this.config.user.id, localPresence);
    this.localPresence$.next(localPresence);

    // Subscribe to room messages
    if (!this.subscriptions.has(roomId)) {
      const unsubscribe = this.transport.subscribe(roomId, (message) => {
        this.handleMessage(message);
      });
      this.subscriptions.set(roomId, unsubscribe);
    }

    // Announce join
    await this.sendPresenceUpdate('join', localPresence);

    // Emit join event
    this.emitEvent('join', this.config.user.id, roomId, localPresence);

    return room;
  }

  /**
   * Leave a presence room
   */
  async leaveRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Announce leave
    await this.sendPresenceUpdate('leave');

    // Remove local user from room
    room.users.delete(this.config.user.id);

    // Emit leave event
    this.emitEvent('leave', this.config.user.id, roomId);

    // Unsubscribe from room
    const unsubscribe = this.subscriptions.get(roomId);
    if (unsubscribe) {
      unsubscribe();
      this.subscriptions.delete(roomId);
    }

    // Clean up room if empty
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    if (this.currentRoomId === roomId) {
      this.currentRoomId = null;
      this.localPresence$.next(null);
    }
  }

  /**
   * Update cursor position
   */
  async updateCursor(cursor: CursorPosition): Promise<void> {
    if (!this.currentRoomId || !this.config.trackCursor) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;

    const localPresence = room.users.get(this.config.user.id);
    if (!localPresence) return;

    // Update local presence
    localPresence.cursor = cursor;
    localPresence.lastActive = Date.now();
    this.localPresence$.next({ ...localPresence });

    // Send cursor update (throttled)
    await this.transport.send({
      type: 'cursor',
      userId: this.config.user.id,
      roomId: this.currentRoomId,
      payload: cursor,
      timestamp: Date.now(),
    });

    this.resetActivityTimeout();
  }

  /**
   * Update user status
   */
  async updateStatus(status: PresenceStatus): Promise<void> {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;

    const localPresence = room.users.get(this.config.user.id);
    if (!localPresence) return;

    localPresence.status = status;
    localPresence.lastActive = Date.now();
    this.localPresence$.next({ ...localPresence });

    await this.sendPresenceUpdate('update', localPresence);
    this.emitEvent('status_change', this.config.user.id, this.currentRoomId, localPresence);
  }

  /**
   * Update custom presence data
   */
  async updateData(data: Record<string, unknown>): Promise<void> {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;

    const localPresence = room.users.get(this.config.user.id);
    if (!localPresence) return;

    localPresence.data = { ...localPresence.data, ...data };
    localPresence.lastActive = Date.now();
    this.localPresence$.next({ ...localPresence });

    await this.sendPresenceUpdate('update', localPresence);
    this.emitEvent('update', this.config.user.id, this.currentRoomId, localPresence);
  }

  /**
   * Get all users in a room
   */
  getRoomUsers(roomId: string): UserPresence[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.users.values());
  }

  /**
   * Get other users in current room (excludes local user)
   */
  getOtherUsers(): UserPresence[] {
    if (!this.currentRoomId) return [];
    return this.getRoomUsers(this.currentRoomId).filter((p) => p.user.id !== this.config.user.id);
  }

  /**
   * Get local user presence
   */
  getLocalPresence(): UserPresence | null {
    return this.localPresence$.value;
  }

  /**
   * Observable of presence events
   */
  get events(): Observable<PresenceEvent> {
    return this.events$.asObservable();
  }

  /**
   * Observable of local presence
   */
  get localPresence(): Observable<UserPresence | null> {
    return this.localPresence$.asObservable();
  }

  /**
   * Observable of users in current room
   */
  get roomUsers(): Observable<UserPresence[]> {
    return new Observable((subscriber) => {
      const emit = () => {
        subscriber.next(this.currentRoomId ? this.getRoomUsers(this.currentRoomId) : []);
      };

      emit();

      const subscription = this.events$.subscribe(() => emit());

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Create a throttled cursor update stream
   */
  createCursorStream(): Subject<CursorPosition> {
    const cursor$ = new Subject<CursorPosition>();

    cursor$
      .pipe(
        throttleTime(this.config.cursorThrottleMs),
        filter(() => this.currentRoomId !== null),
        takeUntil(this.destroy$)
      )
      .subscribe((cursor) => {
        void this.updateCursor(cursor);
      });

    return cursor$;
  }

  /**
   * Handle incoming presence message
   */
  private handleMessage(message: PresenceMessage): void {
    // Ignore own messages
    if (message.userId === this.config.user.id) return;

    const room = this.rooms.get(message.roomId);
    if (!room) return;

    switch (message.type) {
      case 'presence':
        this.handlePresenceMessage(room, message);
        break;
      case 'cursor':
        this.handleCursorMessage(room, message);
        break;
      case 'sync':
        this.handleSyncMessage(room, message);
        break;
      case 'heartbeat':
        this.handleHeartbeatMessage(room, message);
        break;
    }
  }

  /**
   * Handle presence update message
   */
  private handlePresenceMessage(room: PresenceRoom, message: PresenceMessage): void {
    const payload = message.payload as { type: string; presence?: UserPresence };

    if (payload.type === 'leave') {
      room.users.delete(message.userId);
      this.emitEvent('leave', message.userId, room.id);
    } else if (payload.presence) {
      const existingUser = room.users.get(message.userId);
      const isJoin = !existingUser;

      room.users.set(message.userId, payload.presence);

      this.emitEvent(isJoin ? 'join' : 'update', message.userId, room.id, payload.presence);
    }
  }

  /**
   * Handle cursor update message
   */
  private handleCursorMessage(room: PresenceRoom, message: PresenceMessage): void {
    const cursor = message.payload as CursorPosition;
    const userPresence = room.users.get(message.userId);

    if (userPresence) {
      userPresence.cursor = cursor;
      userPresence.lastActive = message.timestamp;

      this.emitEvent('cursor_move', message.userId, room.id, { cursor });
    }
  }

  /**
   * Handle sync message (full state sync)
   */
  private handleSyncMessage(room: PresenceRoom, message: PresenceMessage): void {
    const users = message.payload as UserPresence[];

    for (const presence of users) {
      if (presence.user.id !== this.config.user.id) {
        room.users.set(presence.user.id, presence);
      }
    }
  }

  /**
   * Handle heartbeat message
   */
  private handleHeartbeatMessage(room: PresenceRoom, message: PresenceMessage): void {
    const userPresence = room.users.get(message.userId);
    if (userPresence) {
      userPresence.lastActive = message.timestamp;
    }
  }

  /**
   * Send presence update to room
   */
  private async sendPresenceUpdate(
    type: 'join' | 'leave' | 'update',
    presence?: UserPresence
  ): Promise<void> {
    if (!this.currentRoomId) return;

    await this.transport.send({
      type: 'presence',
      userId: this.config.user.id,
      roomId: this.currentRoomId,
      payload: { type, presence },
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a presence event
   */
  private emitEvent(
    type: PresenceEvent['type'],
    userId: string,
    roomId: string,
    presence?: Partial<UserPresence>
  ): void {
    this.events$.next({
      type,
      userId,
      roomId,
      presence,
      timestamp: Date.now(),
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatSubscription = interval(this.config.heartbeatInterval)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.currentRoomId && this.transport.isConnected()) {
          void this.transport.send({
            type: 'heartbeat',
            userId: this.config.user.id,
            roomId: this.currentRoomId,
            payload: null,
            timestamp: Date.now(),
          });

          // Clean up stale users
          this.cleanupStaleUsers();
        }
      });
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    this.heartbeatSubscription?.unsubscribe();
    this.heartbeatSubscription = null;
  }

  /**
   * Set up activity tracking for away status
   */
  private setupActivityTracking(): void {
    this.resetActivityTimeout();
  }

  /**
   * Reset activity timeout
   */
  private resetActivityTimeout(): void {
    this.clearActivityTimeout();

    this.activityTimeout = setTimeout(() => {
      // Mark as away after timeout
      const localPresence = this.localPresence$.value;
      if (localPresence?.status === 'online') {
        void this.updateStatus('away');
      }
    }, this.config.awayTimeout);
  }

  /**
   * Clear activity timeout
   */
  private clearActivityTimeout(): void {
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }
  }

  /**
   * Clean up users who haven't sent heartbeat
   */
  private cleanupStaleUsers(): void {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;

    const now = Date.now();

    for (const [userId, presence] of room.users) {
      if (userId === this.config.user.id) continue;

      const timeSinceActive = now - presence.lastActive;

      if (timeSinceActive > this.config.offlineTimeout) {
        // Remove offline users
        room.users.delete(userId);
        this.emitEvent('leave', userId, room.id);
      } else if (timeSinceActive > this.config.awayTimeout && presence.status === 'online') {
        // Mark as away
        presence.status = 'away';
        this.emitEvent('status_change', userId, room.id, presence);
      }
    }
  }
}

/**
 * Create a presence manager
 */
export function createPresenceManager(
  transport: PresenceTransport,
  config: PresenceConfig
): PresenceManager {
  return new PresenceManager(transport, config);
}

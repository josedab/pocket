/**
 * Event Store - Stores analytics events locally
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AnalyticsConfig, AnalyticsEvent, SyncStatus } from './types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Pick<AnalyticsConfig, 'maxStoredEvents' | 'storagePrefix' | 'debug'>
> = {
  maxStoredEvents: 10000,
  storagePrefix: 'pocket_analytics',
  debug: false,
};

/**
 * Stores and manages analytics events locally
 */
export class EventStore {
  private readonly config: typeof DEFAULT_CONFIG;
  private events: AnalyticsEvent[] = [];
  private readonly syncStatus$ = new BehaviorSubject<SyncStatus>({
    lastSyncAt: null,
    pendingCount: 0,
    syncing: false,
    lastError: null,
    totalSynced: 0,
  });
  private storage: Storage | null = null;

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize storage
    if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
      this.loadFromStorage();
    }
  }

  /**
   * Add an event to the store
   */
  addEvent(event: AnalyticsEvent): void {
    this.events.push(event);

    // Enforce max stored events
    if (this.events.length > this.config.maxStoredEvents) {
      // Remove oldest synced events first
      const syncedEvents = this.events.filter((e) => e.synced);
      const unsyncedEvents = this.events.filter((e) => !e.synced);

      if (syncedEvents.length > 0) {
        // Remove old synced events
        const keepCount = this.config.maxStoredEvents - unsyncedEvents.length;
        this.events = [...syncedEvents.slice(-keepCount), ...unsyncedEvents];
      } else {
        // No synced events, trim from beginning
        this.events = this.events.slice(-this.config.maxStoredEvents);
      }
    }

    this.updateSyncStatus();
    this.saveToStorage();
    this.log('Event added', event.name);
  }

  /**
   * Get all events
   */
  getEvents(): AnalyticsEvent[] {
    return [...this.events];
  }

  /**
   * Get unsynced events
   */
  getUnsyncedEvents(): AnalyticsEvent[] {
    return this.events.filter((e) => !e.synced);
  }

  /**
   * Get events by date range
   */
  getEventsByDateRange(startDate: number, endDate: number): AnalyticsEvent[] {
    return this.events.filter((e) => e.timestamp >= startDate && e.timestamp <= endDate);
  }

  /**
   * Get events by name
   */
  getEventsByName(name: string): AnalyticsEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  /**
   * Get events by category
   */
  getEventsByCategory(category: string): AnalyticsEvent[] {
    return this.events.filter((e) => e.category === category);
  }

  /**
   * Get events by user ID
   */
  getEventsByUserId(userId: string): AnalyticsEvent[] {
    return this.events.filter((e) => e.userId === userId);
  }

  /**
   * Get events by session ID
   */
  getEventsBySessionId(sessionId: string): AnalyticsEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  /**
   * Mark events as synced
   */
  markAsSynced(eventIds: string[]): void {
    const now = Date.now();
    const idsSet = new Set(eventIds);

    for (const event of this.events) {
      if (idsSet.has(event.id)) {
        event.synced = true;
        event.syncedAt = now;
      }
    }

    const status = this.syncStatus$.value;
    this.syncStatus$.next({
      ...status,
      lastSyncAt: now,
      pendingCount: this.getUnsyncedEvents().length,
      totalSynced: status.totalSynced + eventIds.length,
    });

    this.saveToStorage();
    this.log('Marked events as synced', eventIds.length);
  }

  /**
   * Clear synced events
   */
  clearSyncedEvents(): void {
    this.events = this.events.filter((e) => !e.synced);
    this.saveToStorage();
    this.updateSyncStatus();
    this.log('Cleared synced events');
  }

  /**
   * Clear all events
   */
  clearAllEvents(): void {
    this.events = [];
    this.saveToStorage();
    this.updateSyncStatus();
    this.log('Cleared all events');
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get sync status observable
   */
  get syncStatus(): Observable<SyncStatus> {
    return this.syncStatus$.asObservable();
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus {
    return this.syncStatus$.value;
  }

  /**
   * Set syncing state
   */
  setSyncing(syncing: boolean): void {
    this.syncStatus$.next({
      ...this.syncStatus$.value,
      syncing,
    });
  }

  /**
   * Set sync error
   */
  setSyncError(error: string | null): void {
    this.syncStatus$.next({
      ...this.syncStatus$.value,
      lastError: error,
    });
  }

  /**
   * Update sync status
   */
  private updateSyncStatus(): void {
    this.syncStatus$.next({
      ...this.syncStatus$.value,
      pendingCount: this.getUnsyncedEvents().length,
    });
  }

  /**
   * Load events from storage
   */
  private loadFromStorage(): void {
    if (!this.storage) return;

    try {
      const key = `${this.config.storagePrefix}_events`;
      const data = this.storage.getItem(key);
      if (data) {
        this.events = JSON.parse(data) as AnalyticsEvent[];
        this.updateSyncStatus();
        this.log('Loaded events from storage', this.events.length);
      }
    } catch (error) {
      this.log('Failed to load events from storage', error);
    }
  }

  /**
   * Save events to storage
   */
  private saveToStorage(): void {
    if (!this.storage) return;

    try {
      const key = `${this.config.storagePrefix}_events`;
      this.storage.setItem(key, JSON.stringify(this.events));
    } catch (error) {
      this.log('Failed to save events to storage', error);
    }
  }

  /**
   * Log debug message
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[EventStore]', ...args);
    }
  }

  /** Release resources held by this event store */
  destroy(): void {
    this.syncStatus$.complete();
  }
}

/**
 * Create an event store
 */
export function createEventStore(config?: Partial<AnalyticsConfig>): EventStore {
  return new EventStore(config);
}

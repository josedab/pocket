/**
 * Analytics Tracker - Main analytics tracking API
 */

import { Subject, type Observable } from 'rxjs';
import { EventStore } from './event-store.js';
import type {
  AnalyticsConfig,
  AnalyticsEvent,
  EventContext,
  InternalAnalyticsEvent,
  Metric,
  MetricAggregation,
  Session,
  UserTraits,
} from './types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<AnalyticsConfig> = {
  appName: 'app',
  appVersion: '1.0.0',
  debug: false,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  maxStoredEvents: 10000,
  batchSize: 100,
  syncInterval: 60000, // 1 minute
  trackPages: true,
  trackClicks: false,
  trackForms: false,
  trackErrors: true,
  defaultProperties: {},
  storagePrefix: 'pocket_analytics',
  syncEndpoint: '',
  syncEnabled: false,
};

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Get or create anonymous ID
 */
function getAnonymousId(storage: Storage | null, prefix: string): string {
  if (storage) {
    const key = `${prefix}_anonymous_id`;
    let id = storage.getItem(key);
    if (!id) {
      id = `anon_${generateId()}`;
      storage.setItem(key, id);
    }
    return id;
  }
  return `anon_${generateId()}`;
}

/**
 * Get browser context
 */
function getBrowserContext(): Partial<EventContext> {
  if (typeof window === 'undefined') return {};

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const screen = typeof window.screen !== 'undefined' ? window.screen : null;

  return {
    platform: 'web',
    browser: nav?.userAgent?.split(' ').pop()?.split('/')[0] ?? 'unknown',
    browserVersion: nav?.userAgent?.split(' ').pop()?.split('/')[1] ?? 'unknown',
    screenWidth: screen?.width,
    screenHeight: screen?.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    timezone: Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone,
    locale: nav?.language,
    pageUrl: window.location?.href,
    pageTitle: document?.title,
    referrer: document?.referrer,
    online: nav?.onLine,
  };
}

/**
 * Main analytics tracking class
 */
export class AnalyticsTracker {
  private readonly config: Required<AnalyticsConfig>;
  private readonly store: EventStore;
  private readonly events$ = new Subject<InternalAnalyticsEvent>();
  private userId: string | null = null;
  private userTraits: UserTraits = {};
  private anonymousId: string;
  private currentSession: Session;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private storage: Storage | null = null;
  private metrics: Metric[] = [];
  private destroyed = false;

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new EventStore(this.config);

    // Initialize storage
    if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    }

    // Get or create anonymous ID
    this.anonymousId = getAnonymousId(this.storage, this.config.storagePrefix);

    // Initialize session
    this.currentSession = this.createSession();

    // Load user from storage
    this.loadUser();

    // Start sync timer if enabled
    if (this.config.syncEnabled && this.config.syncEndpoint) {
      this.startSyncTimer();
    }

    // Setup automatic tracking
    this.setupAutoTracking();

    this.log('Analytics tracker initialized');
  }

  /**
   * Track an event
   */
  track(name: string, properties: Record<string, unknown> = {}): void {
    if (this.destroyed) return;

    this.touchSession();

    const event: AnalyticsEvent = {
      id: generateId(),
      name,
      properties: { ...this.config.defaultProperties, ...properties },
      userId: this.userId ?? undefined,
      anonymousId: this.anonymousId,
      sessionId: this.currentSession.id,
      timestamp: Date.now(),
      synced: false,
      context: this.getContext(),
    };

    this.store.addEvent(event);
    this.currentSession.eventCount++;

    this.events$.next({
      type: 'track',
      event,
      timestamp: Date.now(),
    });

    this.log('Track', name, properties);
  }

  /**
   * Identify a user
   */
  identify(userId: string, traits: UserTraits = {}): void {
    if (this.destroyed) return;

    this.userId = userId;
    this.userTraits = { ...this.userTraits, ...traits };
    this.saveUser();

    const event: AnalyticsEvent = {
      id: generateId(),
      name: '$identify',
      properties: traits,
      userId,
      anonymousId: this.anonymousId,
      sessionId: this.currentSession.id,
      timestamp: Date.now(),
      synced: false,
      context: this.getContext(),
    };

    this.store.addEvent(event);

    this.events$.next({
      type: 'identify',
      event,
      timestamp: Date.now(),
    });

    this.log('Identify', userId, traits);
  }

  /**
   * Track a page view
   */
  page(name?: string, properties: Record<string, unknown> = {}): void {
    if (this.destroyed) return;

    this.touchSession();
    this.currentSession.pageViews++;

    const context = this.getContext();
    const pageName = name ?? context.pageTitle ?? 'Unknown Page';

    const event: AnalyticsEvent = {
      id: generateId(),
      name: '$pageview',
      category: 'navigation',
      properties: {
        ...this.config.defaultProperties,
        ...properties,
        name: pageName,
        url: context.pageUrl,
        title: context.pageTitle,
        referrer: context.referrer,
      },
      userId: this.userId ?? undefined,
      anonymousId: this.anonymousId,
      sessionId: this.currentSession.id,
      timestamp: Date.now(),
      synced: false,
      context,
    };

    this.store.addEvent(event);

    this.events$.next({
      type: 'page',
      event,
      timestamp: Date.now(),
    });

    this.log('Page', pageName);
  }

  /**
   * Track a screen view (mobile)
   */
  screen(name: string, properties: Record<string, unknown> = {}): void {
    if (this.destroyed) return;

    this.touchSession();
    this.currentSession.pageViews++;

    const event: AnalyticsEvent = {
      id: generateId(),
      name: '$screenview',
      category: 'navigation',
      properties: {
        ...this.config.defaultProperties,
        ...properties,
        name,
      },
      userId: this.userId ?? undefined,
      anonymousId: this.anonymousId,
      sessionId: this.currentSession.id,
      timestamp: Date.now(),
      synced: false,
      context: this.getContext(),
    };

    this.store.addEvent(event);

    this.events$.next({
      type: 'screen',
      event,
      timestamp: Date.now(),
    });

    this.log('Screen', name);
  }

  /**
   * Track an error
   */
  trackError(error: Error, properties: Record<string, unknown> = {}): void {
    this.track('$error', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...properties,
    });
  }

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, unit?: string, tags?: Record<string, string>): void {
    if (this.destroyed) return;

    const metric: Metric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags,
    };

    this.metrics.push(metric);

    // Also track as event
    this.track('$metric', {
      metricName: name,
      value,
      unit,
      tags,
    });

    this.log('Metric', name, value);
  }

  /**
   * Get metric aggregations
   */
  getMetricAggregations(
    name: string,
    startTime?: number,
    endTime?: number
  ): MetricAggregation | null {
    const now = Date.now();
    const start = startTime ?? now - 24 * 60 * 60 * 1000; // Last 24 hours
    const end = endTime ?? now;

    const metrics = this.metrics.filter(
      (m) => m.name === name && m.timestamp >= start && m.timestamp <= end
    );

    if (metrics.length === 0) return null;

    const values = metrics.map((m) => m.value);

    return {
      name,
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      periodStart: start,
      periodEnd: end,
    };
  }

  /**
   * Reset user (logout)
   */
  reset(): void {
    this.userId = null;
    this.userTraits = {};
    this.clearUserFromStorage();
    this.currentSession = this.createSession();
    this.log('Reset');
  }

  /**
   * Get current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Get anonymous ID
   */
  getAnonymousId(): string {
    return this.anonymousId;
  }

  /**
   * Get current session
   */
  getSession(): Session {
    return { ...this.currentSession };
  }

  /**
   * Get event store
   */
  getStore(): EventStore {
    return this.store;
  }

  /**
   * Get events observable
   */
  get events(): Observable<InternalAnalyticsEvent> {
    return this.events$.asObservable();
  }

  /**
   * Flush events (force sync)
   */
  async flush(): Promise<void> {
    if (!this.config.syncEnabled || !this.config.syncEndpoint) {
      this.log('Sync not enabled');
      return;
    }

    await this.syncEvents();
  }

  /**
   * Destroy tracker
   */
  destroy(): void {
    this.destroyed = true;

    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.events$.complete();
    this.log('Destroyed');
  }

  /**
   * Create a new session
   */
  private createSession(): Session {
    const now = Date.now();
    return {
      id: `sess_${generateId()}`,
      startedAt: now,
      lastActivityAt: now,
      duration: 0,
      eventCount: 0,
      pageViews: 0,
      isActive: true,
    };
  }

  /**
   * Touch session (update activity)
   */
  private touchSession(): void {
    const now = Date.now();

    // Check if session timed out
    if (now - this.currentSession.lastActivityAt > this.config.sessionTimeout) {
      // End old session
      this.currentSession.isActive = false;
      this.currentSession.duration =
        this.currentSession.lastActivityAt - this.currentSession.startedAt;

      // Track session end
      this.track('$session_end', {
        sessionId: this.currentSession.id,
        duration: this.currentSession.duration,
        eventCount: this.currentSession.eventCount,
        pageViews: this.currentSession.pageViews,
      });

      // Start new session
      this.currentSession = this.createSession();

      // Track session start
      this.track('$session_start', {
        sessionId: this.currentSession.id,
      });
    } else {
      // Update session
      this.currentSession.lastActivityAt = now;
      this.currentSession.duration = now - this.currentSession.startedAt;
    }

    // Reset session timeout
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
    }
    this.sessionTimer = setTimeout(() => {
      this.touchSession();
    }, this.config.sessionTimeout);
  }

  /**
   * Get current context
   */
  private getContext(): EventContext {
    return {
      app: this.config.appName,
      appVersion: this.config.appVersion,
      ...getBrowserContext(),
    };
  }

  /**
   * Setup automatic tracking
   */
  private setupAutoTracking(): void {
    if (typeof window === 'undefined') return;

    // Track page views
    if (this.config.trackPages) {
      // Initial page view
      this.page();

      // Listen for navigation
      window.addEventListener('popstate', () => {
        this.page();
      });
    }

    // Track errors
    if (this.config.trackErrors) {
      window.addEventListener('error', (event) => {
        this.trackError(event.error ?? new Error(event.message), {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.trackError(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
          { type: 'unhandledrejection' }
        );
      });
    }

    // Track clicks
    if (this.config.trackClicks) {
      document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'A' || target.tagName === 'BUTTON') {
          this.track('$click', {
            element: target.tagName.toLowerCase(),
            text: target.textContent?.trim().substring(0, 100),
            href: (target as HTMLAnchorElement).href,
            id: target.id,
            className: target.className,
          });
        }
      });
    }

    // Track form submissions
    if (this.config.trackForms) {
      document.addEventListener('submit', (event) => {
        const form = event.target as HTMLFormElement;
        this.track('$form_submit', {
          formId: form.id,
          formName: form.name,
          formAction: form.action,
          formMethod: form.method,
        });
      });
    }
  }

  /**
   * Start sync timer
   */
  private startSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      void this.syncEvents();
    }, this.config.syncInterval);
  }

  /**
   * Sync events to endpoint
   */
  private async syncEvents(): Promise<void> {
    if (!this.config.syncEndpoint) return;

    const events = this.store.getUnsyncedEvents();
    if (events.length === 0) return;

    this.store.setSyncing(true);
    this.log('Syncing events', events.length);

    try {
      // Batch events
      const batches: AnalyticsEvent[][] = [];
      for (let i = 0; i < events.length; i += this.config.batchSize) {
        batches.push(events.slice(i, i + this.config.batchSize));
      }

      for (const batch of batches) {
        const response = await fetch(this.config.syncEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
        });

        if (response.ok) {
          this.store.markAsSynced(batch.map((e) => e.id));
        } else {
          throw new Error(`Sync failed: ${response.status}`);
        }
      }

      this.store.setSyncError(null);
      this.log('Sync complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.store.setSyncError(message);
      this.log('Sync failed', message);
    } finally {
      this.store.setSyncing(false);
    }
  }

  /**
   * Load user from storage
   */
  private loadUser(): void {
    if (!this.storage) return;

    try {
      const userKey = `${this.config.storagePrefix}_user`;
      const userData = this.storage.getItem(userKey);
      if (userData) {
        const { userId, traits } = JSON.parse(userData) as {
          userId: string;
          traits: UserTraits;
        };
        this.userId = userId;
        this.userTraits = traits;
        this.log('Loaded user from storage', userId);
      }
    } catch (error) {
      this.log('Failed to load user from storage', error);
    }
  }

  /**
   * Save user to storage
   */
  private saveUser(): void {
    if (!this.storage || !this.userId) return;

    try {
      const userKey = `${this.config.storagePrefix}_user`;
      this.storage.setItem(
        userKey,
        JSON.stringify({
          userId: this.userId,
          traits: this.userTraits,
        })
      );
    } catch (error) {
      this.log('Failed to save user to storage', error);
    }
  }

  /**
   * Clear user from storage
   */
  private clearUserFromStorage(): void {
    if (!this.storage) return;

    try {
      const userKey = `${this.config.storagePrefix}_user`;
      this.storage.removeItem(userKey);
    } catch (error) {
      this.log('Failed to clear user from storage', error);
    }
  }

  /**
   * Log debug message
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[Analytics]', ...args);
    }
  }
}

/**
 * Create an analytics tracker
 */
export function createAnalyticsTracker(config?: Partial<AnalyticsConfig>): AnalyticsTracker {
  return new AnalyticsTracker(config);
}

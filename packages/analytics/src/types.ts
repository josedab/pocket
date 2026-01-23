/**
 * Types for Offline-First Analytics
 */

/**
 * Analytics event
 */
export interface AnalyticsEvent {
  /** Unique event ID */
  id: string;
  /** Event name */
  name: string;
  /** Event category */
  category?: string;
  /** Event properties */
  properties: Record<string, unknown>;
  /** User ID (if available) */
  userId?: string;
  /** Anonymous/device ID */
  anonymousId: string;
  /** Session ID */
  sessionId: string;
  /** Event timestamp */
  timestamp: number;
  /** Whether event has been synced */
  synced: boolean;
  /** Sync timestamp (if synced) */
  syncedAt?: number;
  /** Context data */
  context: EventContext;
}

/**
 * Event context
 */
export interface EventContext {
  /** App name */
  app?: string;
  /** App version */
  appVersion?: string;
  /** Platform (web, ios, android) */
  platform?: string;
  /** OS name */
  os?: string;
  /** OS version */
  osVersion?: string;
  /** Device type */
  deviceType?: string;
  /** Browser name */
  browser?: string;
  /** Browser version */
  browserVersion?: string;
  /** Screen width */
  screenWidth?: number;
  /** Screen height */
  screenHeight?: number;
  /** Viewport width */
  viewportWidth?: number;
  /** Viewport height */
  viewportHeight?: number;
  /** Timezone */
  timezone?: string;
  /** Locale */
  locale?: string;
  /** Page URL */
  pageUrl?: string;
  /** Page title */
  pageTitle?: string;
  /** Referrer URL */
  referrer?: string;
  /** UTM parameters */
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  /** Network status */
  online?: boolean;
  /** Custom context */
  custom?: Record<string, unknown>;
}

/**
 * User traits for identify
 */
export interface UserTraits {
  /** User email */
  email?: string;
  /** User name */
  name?: string;
  /** First name */
  firstName?: string;
  /** Last name */
  lastName?: string;
  /** Phone number */
  phone?: string;
  /** Created at timestamp */
  createdAt?: number;
  /** Custom traits */
  [key: string]: unknown;
}

/**
 * Session data
 */
export interface Session {
  /** Session ID */
  id: string;
  /** Start timestamp */
  startedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Duration in ms */
  duration: number;
  /** Number of events */
  eventCount: number;
  /** Page views */
  pageViews: number;
  /** Whether session is active */
  isActive: boolean;
}

/**
 * Analytics metric
 */
export interface Metric {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Unit of measurement */
  unit?: string;
  /** Timestamp */
  timestamp: number;
  /** Tags for grouping */
  tags?: Record<string, string>;
}

/**
 * Aggregated metrics
 */
export interface MetricAggregation {
  /** Metric name */
  name: string;
  /** Count of data points */
  count: number;
  /** Sum of values */
  sum: number;
  /** Average value */
  avg: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Time period start */
  periodStart: number;
  /** Time period end */
  periodEnd: number;
}

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  /** App name */
  appName?: string;
  /** App version */
  appVersion?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Session timeout in ms */
  sessionTimeout?: number;
  /** Maximum events to store locally */
  maxStoredEvents?: number;
  /** Batch size for syncing */
  batchSize?: number;
  /** Sync interval in ms */
  syncInterval?: number;
  /** Enable automatic page tracking */
  trackPages?: boolean;
  /** Enable automatic click tracking */
  trackClicks?: boolean;
  /** Enable automatic form tracking */
  trackForms?: boolean;
  /** Enable automatic error tracking */
  trackErrors?: boolean;
  /** Default event properties */
  defaultProperties?: Record<string, unknown>;
  /** Storage key prefix */
  storagePrefix?: string;
  /** Sync endpoint URL */
  syncEndpoint?: string;
  /** Sync enabled */
  syncEnabled?: boolean;
}

/**
 * Analytics sync status
 */
export interface SyncStatus {
  /** Last sync timestamp */
  lastSyncAt: number | null;
  /** Number of pending events */
  pendingCount: number;
  /** Whether sync is in progress */
  syncing: boolean;
  /** Last sync error */
  lastError: string | null;
  /** Total events synced */
  totalSynced: number;
}

/**
 * Funnel step
 */
export interface FunnelStep {
  /** Step name */
  name: string;
  /** Event name to match */
  eventName: string;
  /** Optional event properties to match */
  properties?: Record<string, unknown>;
}

/**
 * Funnel analysis result
 */
export interface FunnelResult {
  /** Funnel name */
  name: string;
  /** Steps with conversion data */
  steps: {
    name: string;
    count: number;
    conversionRate: number;
    dropoffRate: number;
  }[];
  /** Overall conversion rate */
  overallConversion: number;
  /** Time period */
  period: {
    start: number;
    end: number;
  };
}

/**
 * Analytics event types for internal use
 */
export type AnalyticsEventType = 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias';

/**
 * Internal analytics event
 */
export interface InternalAnalyticsEvent {
  /** Event type */
  type: AnalyticsEventType;
  /** Event data */
  event: AnalyticsEvent;
  /** Timestamp */
  timestamp: number;
}

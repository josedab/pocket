/**
 * Health Monitor for Pocket Sync Server
 *
 * Tracks server health, performance metrics, and provides monitoring endpoints.
 * Runs periodic health checks and emits alerts when thresholds are exceeded.
 *
 * @module @pocket/sync-server
 */

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Overall server health status
 */
export interface HealthStatus {
  /** Aggregate health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Server uptime in milliseconds */
  uptime: number;
  /** Current timestamp */
  timestamp: number;
  /** Server version string */
  version: string;
  /** Individual health check results */
  checks: HealthCheck[];
}

/**
 * Result of a single health check
 */
export interface HealthCheck {
  /** Check name */
  name: string;
  /** Check result status */
  status: 'pass' | 'warn' | 'fail';
  /** Human-readable status message */
  message?: string;
  /** Time taken to run the check in milliseconds */
  duration?: number;
  /** Additional check metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated server performance metrics
 */
export interface ServerMetrics {
  /** Connection statistics */
  connections: {
    active: number;
    total: number;
    peak: number;
  };
  /** Message throughput statistics */
  messages: {
    received: number;
    sent: number;
    errors: number;
    perSecond: number;
  };
  /** Sync operation statistics */
  sync: {
    pushes: number;
    pulls: number;
    conflicts: number;
    avgLatencyMs: number;
  };
  /** Storage statistics */
  storage: {
    documents: number;
    collections: number;
    sizeBytes: number;
  };
  /** Process memory usage */
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  /** Server uptime in milliseconds */
  uptime: number;
}

/**
 * Health monitor configuration
 */
export interface MonitorConfig {
  /** Interval between health checks in milliseconds */
  checkInterval?: number;
  /** Time window for rate calculations in milliseconds */
  metricsWindow?: number;
  /** Thresholds that trigger alerts */
  alertThresholds?: {
    maxConnections?: number;
    maxLatencyMs?: number;
    maxErrorRate?: number;
    maxMemoryPercent?: number;
  };
  /** Callback invoked when an alert threshold is exceeded */
  onAlert?: (alert: { type: string; message: string; severity: 'warning' | 'critical' }) => void;
}

/**
 * Default monitor configuration values
 */
const DEFAULT_MONITOR_CONFIG = {
  checkInterval: 30000,
  metricsWindow: 60000,
  alertThresholds: {
    maxConnections: 10000,
    maxLatencyMs: 5000,
    maxErrorRate: 0.05,
    maxMemoryPercent: 90,
  },
};

/**
 * Server version reported in health checks
 */
const SERVER_VERSION = '1.0.0';

/**
 * Health monitor for the Pocket sync server
 *
 * Collects metrics, runs periodic health checks, and emits alerts when
 * configured thresholds are exceeded.
 *
 * @example
 * ```typescript
 * import { createHealthMonitor } from '@pocket/sync-server';
 *
 * const monitor = createHealthMonitor({
 *   checkInterval: 15000,
 *   alertThresholds: { maxConnections: 500 },
 *   onAlert: (alert) => console.warn(alert.message),
 * });
 *
 * // Record activity
 * monitor.recordMessage('in');
 * monitor.recordSync('push', 42);
 * monitor.recordConnection(1);
 *
 * // Query health
 * const health = monitor.getHealth();
 * const metrics = monitor.getMetrics();
 *
 * // Clean up
 * monitor.dispose();
 * ```
 */
export class HealthMonitor {
  private readonly config: {
    checkInterval: number;
    metricsWindow: number;
    alertThresholds: Required<NonNullable<MonitorConfig['alertThresholds']>>;
    onAlert?: MonitorConfig['onAlert'];
  };

  private readonly startTime = Date.now();
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;

  // Connection tracking
  private activeConnections = 0;
  private totalConnections = 0;
  private peakConnections = 0;

  // Message tracking
  private messagesReceived = 0;
  private messagesSent = 0;
  private messageErrors = 0;
  private readonly recentMessages: number[] = [];

  // Sync tracking
  private syncPushes = 0;
  private syncPulls = 0;
  private syncConflicts = 0;
  private readonly syncLatencies: number[] = [];

  // Storage tracking (updated externally or via hooks)
  private documentCount = 0;
  private collectionCount = 0;
  private storageSizeBytes = 0;

  /** Unique monitor instance ID */
  readonly id = generateId();

  constructor(config?: MonitorConfig) {
    this.config = {
      checkInterval: config?.checkInterval ?? DEFAULT_MONITOR_CONFIG.checkInterval,
      metricsWindow: config?.metricsWindow ?? DEFAULT_MONITOR_CONFIG.metricsWindow,
      alertThresholds: {
        ...DEFAULT_MONITOR_CONFIG.alertThresholds,
        ...config?.alertThresholds,
      },
      onAlert: config?.onAlert,
    };

    this.startHealthChecks();
  }

  /**
   * Get the current server health status
   *
   * Runs all health checks and returns an aggregate status.
   */
  getHealth(): HealthStatus {
    const checks = this.runHealthChecks();
    const hasFailure = checks.some((c) => c.status === 'fail');
    const hasWarning = checks.some((c) => c.status === 'warn');

    let status: HealthStatus['status'] = 'healthy';
    if (hasFailure) {
      status = 'unhealthy';
    } else if (hasWarning) {
      status = 'degraded';
    }

    return {
      status,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now(),
      version: SERVER_VERSION,
      checks,
    };
  }

  /**
   * Get current server metrics
   *
   * Returns a snapshot of all tracked performance counters.
   */
  getMetrics(): ServerMetrics {
    const now = Date.now();
    const windowStart = now - this.config.metricsWindow;

    // Calculate messages per second over the metrics window
    const recentCount = this.recentMessages.filter((t) => t >= windowStart).length;
    const windowSeconds = this.config.metricsWindow / 1000;
    const perSecond = windowSeconds > 0 ? recentCount / windowSeconds : 0;

    // Calculate average sync latency
    const avgLatencyMs =
      this.syncLatencies.length > 0
        ? this.syncLatencies.reduce((sum, l) => sum + l, 0) / this.syncLatencies.length
        : 0;

    // Gather memory info (safe for non-Node runtimes)
    let memory = { heapUsed: 0, heapTotal: 0, rss: 0 };
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mem = process.memoryUsage();
      memory = { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss };
    }

    return {
      connections: {
        active: this.activeConnections,
        total: this.totalConnections,
        peak: this.peakConnections,
      },
      messages: {
        received: this.messagesReceived,
        sent: this.messagesSent,
        errors: this.messageErrors,
        perSecond: Math.round(perSecond * 100) / 100,
      },
      sync: {
        pushes: this.syncPushes,
        pulls: this.syncPulls,
        conflicts: this.syncConflicts,
        avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      },
      storage: {
        documents: this.documentCount,
        collections: this.collectionCount,
        sizeBytes: this.storageSizeBytes,
      },
      memory,
      uptime: now - this.startTime,
    };
  }

  /**
   * Record an incoming or outgoing message
   */
  recordMessage(direction: 'in' | 'out'): void {
    if (direction === 'in') {
      this.messagesReceived++;
    } else {
      this.messagesSent++;
    }
    this.recentMessages.push(Date.now());
    this.trimRecentMessages();
  }

  /**
   * Record a sync operation with its latency
   */
  recordSync(type: 'push' | 'pull', latencyMs: number): void {
    if (type === 'push') {
      this.syncPushes++;
    } else {
      this.syncPulls++;
    }
    this.syncLatencies.push(latencyMs);

    // Keep latency window bounded
    if (this.syncLatencies.length > 1000) {
      this.syncLatencies.splice(0, this.syncLatencies.length - 1000);
    }
  }

  /**
   * Record a sync error
   */
  recordError(): void {
    this.messageErrors++;
  }

  /**
   * Record a connection change
   *
   * @param delta - `1` for a new connection, `-1` for a disconnection
   */
  recordConnection(delta: 1 | -1): void {
    this.activeConnections = Math.max(0, this.activeConnections + delta);

    if (delta === 1) {
      this.totalConnections++;
      if (this.activeConnections > this.peakConnections) {
        this.peakConnections = this.activeConnections;
      }
    }
  }

  /**
   * Record a sync conflict
   */
  recordConflict(): void {
    this.syncConflicts++;
  }

  /**
   * Update storage statistics
   *
   * Call this periodically or after storage operations to keep metrics accurate.
   */
  updateStorageMetrics(stats: {
    documents?: number;
    collections?: number;
    sizeBytes?: number;
  }): void {
    if (stats.documents !== undefined) this.documentCount = stats.documents;
    if (stats.collections !== undefined) this.collectionCount = stats.collections;
    if (stats.sizeBytes !== undefined) this.storageSizeBytes = stats.sizeBytes;
  }

  /**
   * Run all health checks
   */
  private runHealthChecks(): HealthCheck[] {
    return [
      this.checkMemory(),
      this.checkConnections(),
      this.checkLatency(),
      this.checkErrorRate(),
    ];
  }

  /**
   * Check memory usage
   */
  private checkMemory(): HealthCheck {
    const start = Date.now();

    if (typeof process === 'undefined' || !process.memoryUsage) {
      return {
        name: 'memory',
        status: 'pass',
        message: 'Memory check not available in this runtime',
        duration: Date.now() - start,
      };
    }

    const mem = process.memoryUsage();
    const usedPercent = mem.heapTotal > 0 ? (mem.heapUsed / mem.heapTotal) * 100 : 0;
    const threshold = this.config.alertThresholds.maxMemoryPercent;

    let status: HealthCheck['status'] = 'pass';
    let message = `Heap usage: ${Math.round(usedPercent)}%`;

    if (usedPercent >= threshold) {
      status = 'fail';
      message = `Heap usage ${Math.round(usedPercent)}% exceeds threshold ${threshold}%`;
      this.emitAlert('memory', message, 'critical');
    } else if (usedPercent >= threshold * 0.8) {
      status = 'warn';
      message = `Heap usage ${Math.round(usedPercent)}% approaching threshold ${threshold}%`;
      this.emitAlert('memory', message, 'warning');
    }

    return {
      name: 'memory',
      status,
      message,
      duration: Date.now() - start,
      metadata: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        usedPercent: Math.round(usedPercent * 100) / 100,
      },
    };
  }

  /**
   * Check active connection count
   */
  private checkConnections(): HealthCheck {
    const start = Date.now();
    const threshold = this.config.alertThresholds.maxConnections;

    let status: HealthCheck['status'] = 'pass';
    let message = `Active connections: ${this.activeConnections}`;

    if (this.activeConnections >= threshold) {
      status = 'fail';
      message = `Active connections ${this.activeConnections} exceeds threshold ${threshold}`;
      this.emitAlert('connections', message, 'critical');
    } else if (this.activeConnections >= threshold * 0.8) {
      status = 'warn';
      message = `Active connections ${this.activeConnections} approaching threshold ${threshold}`;
      this.emitAlert('connections', message, 'warning');
    }

    return {
      name: 'connections',
      status,
      message,
      duration: Date.now() - start,
      metadata: {
        active: this.activeConnections,
        total: this.totalConnections,
        peak: this.peakConnections,
      },
    };
  }

  /**
   * Check average sync latency
   */
  private checkLatency(): HealthCheck {
    const start = Date.now();
    const threshold = this.config.alertThresholds.maxLatencyMs;

    if (this.syncLatencies.length === 0) {
      return {
        name: 'latency',
        status: 'pass',
        message: 'No sync operations recorded yet',
        duration: Date.now() - start,
      };
    }

    const avg = this.syncLatencies.reduce((sum, l) => sum + l, 0) / this.syncLatencies.length;

    let status: HealthCheck['status'] = 'pass';
    let message = `Average sync latency: ${Math.round(avg)}ms`;

    if (avg >= threshold) {
      status = 'fail';
      message = `Average sync latency ${Math.round(avg)}ms exceeds threshold ${threshold}ms`;
      this.emitAlert('latency', message, 'critical');
    } else if (avg >= threshold * 0.8) {
      status = 'warn';
      message = `Average sync latency ${Math.round(avg)}ms approaching threshold ${threshold}ms`;
      this.emitAlert('latency', message, 'warning');
    }

    return {
      name: 'latency',
      status,
      message,
      duration: Date.now() - start,
      metadata: { avgLatencyMs: Math.round(avg * 100) / 100 },
    };
  }

  /**
   * Check error rate
   */
  private checkErrorRate(): HealthCheck {
    const start = Date.now();
    const totalMessages = this.messagesReceived + this.messagesSent;
    const threshold = this.config.alertThresholds.maxErrorRate;

    if (totalMessages === 0) {
      return {
        name: 'errorRate',
        status: 'pass',
        message: 'No messages processed yet',
        duration: Date.now() - start,
      };
    }

    const errorRate = this.messageErrors / totalMessages;

    let status: HealthCheck['status'] = 'pass';
    let message = `Error rate: ${(errorRate * 100).toFixed(2)}%`;

    if (errorRate >= threshold) {
      status = 'fail';
      message = `Error rate ${(errorRate * 100).toFixed(2)}% exceeds threshold ${(threshold * 100).toFixed(2)}%`;
      this.emitAlert('errorRate', message, 'critical');
    } else if (errorRate >= threshold * 0.8) {
      status = 'warn';
      message = `Error rate ${(errorRate * 100).toFixed(2)}% approaching threshold ${(threshold * 100).toFixed(2)}%`;
      this.emitAlert('errorRate', message, 'warning');
    }

    return {
      name: 'errorRate',
      status,
      message,
      duration: Date.now() - start,
      metadata: {
        errorRate: Math.round(errorRate * 10000) / 10000,
        totalErrors: this.messageErrors,
        totalMessages,
      },
    };
  }

  /**
   * Emit an alert via the configured callback
   */
  private emitAlert(type: string, message: string, severity: 'warning' | 'critical'): void {
    if (this.config.onAlert) {
      this.config.onAlert({ type, message, severity });
    }
  }

  /**
   * Start the periodic health check interval
   */
  private startHealthChecks(): void {
    this.checkIntervalId = setInterval(() => {
      this.runHealthChecks();
    }, this.config.checkInterval);
  }

  /**
   * Trim the recent messages array to the metrics window
   */
  private trimRecentMessages(): void {
    const cutoff = Date.now() - this.config.metricsWindow;
    while (this.recentMessages.length > 0 && this.recentMessages[0]! < cutoff) {
      this.recentMessages.shift();
    }
  }

  /**
   * Dispose of the health monitor and stop all timers
   */
  dispose(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }
}

/**
 * Create a health monitor
 *
 * @example
 * ```typescript
 * import { createHealthMonitor } from '@pocket/sync-server';
 *
 * const monitor = createHealthMonitor({
 *   checkInterval: 10000,
 *   onAlert: (alert) => {
 *     if (alert.severity === 'critical') {
 *       notifyOpsTeam(alert.message);
 *     }
 *   },
 * });
 * ```
 */
export function createHealthMonitor(config?: MonitorConfig): HealthMonitor {
  return new HealthMonitor(config);
}

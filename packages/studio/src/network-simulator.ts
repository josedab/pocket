/**
 * NetworkSimulator - Simulates network conditions for sync debugging.
 *
 * Provides controllable latency, packet loss, bandwidth throttling,
 * and connection state simulation to help developers test sync behavior
 * under adverse network conditions.
 *
 * @module network-simulator
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Network condition preset */
export type NetworkPreset =
  | 'perfect'
  | 'broadband'
  | '4g'
  | '3g'
  | '2g'
  | 'edge'
  | 'offline'
  | 'flaky'
  | 'custom';

/** Network condition parameters */
export interface NetworkCondition {
  /** Simulated latency in ms */
  readonly latencyMs: number;
  /** Latency jitter (+/- ms) */
  readonly jitterMs: number;
  /** Packet loss rate (0-1) */
  readonly packetLossRate: number;
  /** Download bandwidth in bytes/second (0 = unlimited) */
  readonly downloadBandwidth: number;
  /** Upload bandwidth in bytes/second (0 = unlimited) */
  readonly uploadBandwidth: number;
  /** Whether the connection is online */
  readonly online: boolean;
}

/** Configuration for the network simulator */
export interface NetworkSimulatorConfig {
  /** Initial network condition preset */
  readonly preset?: NetworkPreset;
  /** Custom initial conditions */
  readonly custom?: Partial<NetworkCondition>;
  /** Log network events */
  readonly debug?: boolean;
}

/** Network event for debugging */
export interface NetworkEvent {
  readonly type:
    | 'request-delayed'
    | 'request-dropped'
    | 'condition-changed'
    | 'went-offline'
    | 'went-online'
    | 'bandwidth-throttled';
  readonly timestamp: number;
  readonly details?: Record<string, unknown>;
}

/** Statistics from the simulator */
export interface NetworkSimulatorStats {
  readonly totalRequests: number;
  readonly droppedRequests: number;
  readonly totalLatencyMs: number;
  readonly avgLatencyMs: number;
  readonly currentCondition: NetworkCondition;
  readonly currentPreset: NetworkPreset;
  readonly isOnline: boolean;
}

const PRESETS: Record<NetworkPreset, NetworkCondition> = {
  perfect: { latencyMs: 0, jitterMs: 0, packetLossRate: 0, downloadBandwidth: 0, uploadBandwidth: 0, online: true },
  broadband: { latencyMs: 20, jitterMs: 5, packetLossRate: 0, downloadBandwidth: 12_500_000, uploadBandwidth: 5_000_000, online: true },
  '4g': { latencyMs: 50, jitterMs: 20, packetLossRate: 0.01, downloadBandwidth: 5_000_000, uploadBandwidth: 1_250_000, online: true },
  '3g': { latencyMs: 200, jitterMs: 100, packetLossRate: 0.03, downloadBandwidth: 500_000, uploadBandwidth: 250_000, online: true },
  '2g': { latencyMs: 800, jitterMs: 400, packetLossRate: 0.08, downloadBandwidth: 31_250, uploadBandwidth: 15_625, online: true },
  edge: { latencyMs: 1500, jitterMs: 500, packetLossRate: 0.1, downloadBandwidth: 6_250, uploadBandwidth: 3_125, online: true },
  offline: { latencyMs: 0, jitterMs: 0, packetLossRate: 1, downloadBandwidth: 0, uploadBandwidth: 0, online: false },
  flaky: { latencyMs: 300, jitterMs: 500, packetLossRate: 0.2, downloadBandwidth: 500_000, uploadBandwidth: 250_000, online: true },
  custom: { latencyMs: 100, jitterMs: 50, packetLossRate: 0.05, downloadBandwidth: 1_000_000, uploadBandwidth: 500_000, online: true },
};

/**
 * Simulates network conditions for testing sync behavior.
 *
 * @example
 * ```typescript
 * import { createNetworkSimulator } from '@pocket/studio';
 *
 * const simulator = createNetworkSimulator({ preset: '3g' });
 *
 * // Simulate a request
 * const result = await simulator.simulateRequest(1024);
 * console.log(`Took ${result.actualLatencyMs}ms`);
 *
 * // Switch to offline
 * simulator.setPreset('offline');
 * const offlineResult = await simulator.simulateRequest(100);
 * console.log(offlineResult.dropped); // true
 *
 * // Simulate flaky connection
 * simulator.setPreset('flaky');
 * simulator.events$.subscribe(e => console.log(e.type));
 * ```
 */
export class NetworkSimulator {
  private readonly condition$ = new BehaviorSubject<NetworkCondition>(PRESETS.perfect);
  private readonly events$$ = new Subject<NetworkEvent>();
  private readonly destroy$ = new Subject<void>();
  private currentPreset: NetworkPreset = 'perfect';
  private totalRequests = 0;
  private droppedRequests = 0;
  private totalLatencyMs = 0;

  constructor(config: NetworkSimulatorConfig = {}) {
    const preset = config.preset ?? 'perfect';
    this.currentPreset = preset;
    const baseCondition = PRESETS[preset];
    if (config.custom) {
      this.condition$.next({ ...baseCondition, ...config.custom });
    } else {
      this.condition$.next(baseCondition);
    }
  }

  /** Current network condition as observable */
  get condition(): Observable<NetworkCondition> {
    return this.condition$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Network events stream */
  get events$(): Observable<NetworkEvent> {
    return this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Get current condition snapshot */
  getCondition(): NetworkCondition {
    return this.condition$.value;
  }

  /** Switch to a preset network condition */
  setPreset(preset: NetworkPreset): void {
    this.currentPreset = preset;
    const condition = PRESETS[preset];
    const wasOnline = this.condition$.value.online;
    this.condition$.next(condition);

    if (wasOnline && !condition.online) {
      this.emitEvent({ type: 'went-offline', timestamp: Date.now() });
    } else if (!wasOnline && condition.online) {
      this.emitEvent({ type: 'went-online', timestamp: Date.now() });
    }

    this.emitEvent({
      type: 'condition-changed',
      timestamp: Date.now(),
      details: { preset, condition },
    });
  }

  /** Set custom network condition */
  setCustomCondition(condition: Partial<NetworkCondition>): void {
    this.currentPreset = 'custom';
    const newCondition = { ...this.condition$.value, ...condition };
    const wasOnline = this.condition$.value.online;
    this.condition$.next(newCondition);

    if (wasOnline && !newCondition.online) {
      this.emitEvent({ type: 'went-offline', timestamp: Date.now() });
    } else if (!wasOnline && newCondition.online) {
      this.emitEvent({ type: 'went-online', timestamp: Date.now() });
    }

    this.emitEvent({
      type: 'condition-changed',
      timestamp: Date.now(),
      details: { condition: newCondition },
    });
  }

  /**
   * Simulate a network request under current conditions.
   * Returns the simulated delay and whether the packet was dropped.
   */
  async simulateRequest(payloadBytes: number): Promise<{
    actualLatencyMs: number;
    dropped: boolean;
    throttled: boolean;
  }> {
    this.totalRequests++;
    const condition = this.condition$.value;

    // Offline or packet loss check
    if (!condition.online || Math.random() < condition.packetLossRate) {
      this.droppedRequests++;
      this.emitEvent({
        type: 'request-dropped',
        timestamp: Date.now(),
        details: { payloadBytes, online: condition.online },
      });
      return { actualLatencyMs: 0, dropped: true, throttled: false };
    }

    // Calculate latency with jitter
    const jitter = condition.jitterMs > 0
      ? (Math.random() * 2 - 1) * condition.jitterMs
      : 0;
    let latency = Math.max(0, condition.latencyMs + jitter);

    // Add bandwidth delay
    let throttled = false;
    if (condition.uploadBandwidth > 0) {
      const transferTime = (payloadBytes / condition.uploadBandwidth) * 1000;
      if (transferTime > 10) {
        latency += transferTime;
        throttled = true;
        this.emitEvent({
          type: 'bandwidth-throttled',
          timestamp: Date.now(),
          details: { payloadBytes, transferTimeMs: transferTime },
        });
      }
    }

    this.totalLatencyMs += latency;

    // Simulate the delay
    if (latency > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.round(latency)));
    }

    this.emitEvent({
      type: 'request-delayed',
      timestamp: Date.now(),
      details: { payloadBytes, latencyMs: Math.round(latency) },
    });

    return {
      actualLatencyMs: Math.round(latency),
      dropped: false,
      throttled,
    };
  }

  /** Get current simulator statistics */
  getStats(): NetworkSimulatorStats {
    return {
      totalRequests: this.totalRequests,
      droppedRequests: this.droppedRequests,
      totalLatencyMs: this.totalLatencyMs,
      avgLatencyMs: this.totalRequests > 0
        ? Math.round(this.totalLatencyMs / (this.totalRequests - this.droppedRequests || 1))
        : 0,
      currentCondition: this.condition$.value,
      currentPreset: this.currentPreset,
      isOnline: this.condition$.value.online,
    };
  }

  /** Reset statistics */
  resetStats(): void {
    this.totalRequests = 0;
    this.droppedRequests = 0;
    this.totalLatencyMs = 0;
  }

  /** Get available preset names */
  getPresets(): NetworkPreset[] {
    return Object.keys(PRESETS) as NetworkPreset[];
  }

  /** Get condition for a specific preset */
  getPresetCondition(preset: NetworkPreset): NetworkCondition {
    return PRESETS[preset];
  }

  /** Destroy the simulator */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.condition$.complete();
    this.events$$.complete();
  }

  private emitEvent(event: NetworkEvent): void {
    this.events$$.next(event);
  }
}

/** Factory function to create a NetworkSimulator */
export function createNetworkSimulator(config?: NetworkSimulatorConfig): NetworkSimulator {
  return new NetworkSimulator(config);
}

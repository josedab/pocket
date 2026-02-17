/**
 * AutoScaler - Load-aware auto-scaling manager for Pocket Cloud.
 *
 * Monitors relay and server metrics, makes scaling decisions based
 * on configurable policies, and emits scaling events for orchestrators
 * (Kubernetes, Docker Swarm, AWS ECS) to act on.
 *
 * @module auto-scaler
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Scaling direction */
export type ScaleDirection = 'up' | 'down' | 'none';

/** Scaling policy type */
export type ScalingPolicyType = 'cpu' | 'connections' | 'messages' | 'latency' | 'composite';

/** Individual scaling policy */
export interface ScalingPolicy {
  readonly type: ScalingPolicyType;
  /** Threshold that triggers scale-up (e.g. 80 for 80% CPU) */
  readonly scaleUpThreshold: number;
  /** Threshold that triggers scale-down */
  readonly scaleDownThreshold: number;
  /** Weight when used in composite policy (0-1) */
  readonly weight?: number;
}

/** Auto-scaler configuration */
export interface AutoScalerConfig {
  /** Minimum number of instances */
  readonly minInstances: number;
  /** Maximum number of instances */
  readonly maxInstances: number;
  /** Evaluation interval in milliseconds */
  readonly evaluationIntervalMs?: number;
  /** Cooldown after scale-up before next scaling (ms) */
  readonly scaleUpCooldownMs?: number;
  /** Cooldown after scale-down before next scaling (ms) */
  readonly scaleDownCooldownMs?: number;
  /** Scaling policies to evaluate */
  readonly policies: readonly ScalingPolicy[];
  /** Target instances step size per scaling event */
  readonly stepSize?: number;
}

/** Metrics snapshot fed to the auto-scaler */
export interface ScalerMetrics {
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  readonly activeConnections: number;
  readonly maxConnections: number;
  readonly messagesPerSecond: number;
  readonly maxMessagesPerSecond: number;
  readonly avgLatencyMs: number;
  readonly maxLatencyMs: number;
}

/** A scaling decision made by the auto-scaler */
export interface ScalingDecision {
  readonly direction: ScaleDirection;
  readonly currentInstances: number;
  readonly desiredInstances: number;
  readonly reason: string;
  readonly triggeredBy: ScalingPolicyType;
  readonly timestamp: number;
  readonly metrics: ScalerMetrics;
}

/** Current auto-scaler state */
export interface AutoScalerState {
  readonly currentInstances: number;
  readonly desiredInstances: number;
  readonly lastScaleAt: number | null;
  readonly lastDirection: ScaleDirection;
  readonly isEvaluating: boolean;
  readonly cooldownRemainingMs: number;
}

const DEFAULT_EVALUATION_INTERVAL = 30_000;
const DEFAULT_SCALE_UP_COOLDOWN = 120_000;
const DEFAULT_SCALE_DOWN_COOLDOWN = 300_000;
const DEFAULT_STEP_SIZE = 1;

/**
 * Auto-scaling manager that evaluates metrics against policies
 * and emits scaling decisions.
 *
 * @example
 * ```typescript
 * import { createAutoScaler } from '@pocket/cloud';
 *
 * const scaler = createAutoScaler({
 *   minInstances: 1,
 *   maxInstances: 10,
 *   policies: [
 *     { type: 'connections', scaleUpThreshold: 80, scaleDownThreshold: 30 },
 *     { type: 'cpu', scaleUpThreshold: 75, scaleDownThreshold: 25 },
 *   ],
 * });
 *
 * scaler.decisions$.subscribe(decision => {
 *   console.log(`Scale ${decision.direction}: ${decision.currentInstances} → ${decision.desiredInstances}`);
 *   // Trigger Kubernetes HPA, ECS service update, etc.
 * });
 *
 * scaler.start();
 * // Feed metrics periodically
 * scaler.reportMetrics({ cpuPercent: 85, ... });
 * ```
 */
export class AutoScaler {
  private readonly config: Required<Omit<AutoScalerConfig, 'policies'>> & Pick<AutoScalerConfig, 'policies'>;
  private readonly state$ = new BehaviorSubject<AutoScalerState>({
    currentInstances: 1,
    desiredInstances: 1,
    lastScaleAt: null,
    lastDirection: 'none',
    isEvaluating: false,
    cooldownRemainingMs: 0,
  });
  private readonly decisions$$ = new Subject<ScalingDecision>();
  private readonly destroy$ = new Subject<void>();
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private latestMetrics: ScalerMetrics | null = null;
  private currentInstances: number;

  constructor(config: AutoScalerConfig) {
    this.config = {
      evaluationIntervalMs: DEFAULT_EVALUATION_INTERVAL,
      scaleUpCooldownMs: DEFAULT_SCALE_UP_COOLDOWN,
      scaleDownCooldownMs: DEFAULT_SCALE_DOWN_COOLDOWN,
      stepSize: DEFAULT_STEP_SIZE,
      ...config,
    };
    this.currentInstances = config.minInstances;
  }

  /** Stream of scaling decisions */
  get decisions$(): Observable<ScalingDecision> {
    return this.decisions$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Current auto-scaler state */
  get scalerState$(): Observable<AutoScalerState> {
    return this.state$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Start periodic evaluation */
  start(): void {
    if (this.evaluationTimer) return;
    this.evaluationTimer = setInterval(
      () => this.evaluate(),
      this.config.evaluationIntervalMs,
    );
  }

  /** Stop periodic evaluation */
  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /** Feed current metrics to the auto-scaler */
  reportMetrics(metrics: ScalerMetrics): void {
    this.latestMetrics = metrics;
  }

  /** Manually trigger an evaluation cycle */
  evaluate(): ScalingDecision | null {
    if (!this.latestMetrics) return null;

    const state = this.state$.value;
    const now = Date.now();

    this.state$.next({ ...state, isEvaluating: true });

    // Check cooldown
    if (state.lastScaleAt) {
      const cooldown =
        state.lastDirection === 'up'
          ? this.config.scaleUpCooldownMs
          : this.config.scaleDownCooldownMs;
      const remaining = cooldown - (now - state.lastScaleAt);
      if (remaining > 0) {
        this.state$.next({
          ...state,
          isEvaluating: false,
          cooldownRemainingMs: remaining,
        });
        return null;
      }
    }

    const decision = this.computeDecision(this.latestMetrics, now);

    if (decision.direction !== 'none') {
      this.currentInstances = decision.desiredInstances;
      this.state$.next({
        currentInstances: decision.desiredInstances,
        desiredInstances: decision.desiredInstances,
        lastScaleAt: now,
        lastDirection: decision.direction,
        isEvaluating: false,
        cooldownRemainingMs: 0,
      });
      this.decisions$$.next(decision);
    } else {
      this.state$.next({ ...state, isEvaluating: false, cooldownRemainingMs: 0 });
    }

    return decision;
  }

  /** Manually set the current instance count (e.g. after external scaling) */
  setCurrentInstances(count: number): void {
    this.currentInstances = Math.max(
      this.config.minInstances,
      Math.min(this.config.maxInstances, count),
    );
    const state = this.state$.value;
    this.state$.next({
      ...state,
      currentInstances: this.currentInstances,
      desiredInstances: this.currentInstances,
    });
  }

  /** Get current state snapshot */
  getState(): AutoScalerState {
    return this.state$.value;
  }

  /** Destroy the auto-scaler and release resources */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.state$.complete();
    this.decisions$$.complete();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private computeDecision(metrics: ScalerMetrics, now: number): ScalingDecision {
    let weightedScoreUp = 0;
    let weightedScoreDown = 0;
    let totalWeight = 0;
    let triggerPolicy: ScalingPolicyType = 'composite';

    for (const policy of this.config.policies) {
      const weight = policy.weight ?? 1;
      totalWeight += weight;
      const utilization = this.getUtilization(policy.type, metrics);

      if (utilization >= policy.scaleUpThreshold) {
        weightedScoreUp += weight;
        triggerPolicy = policy.type;
      }
      if (utilization <= policy.scaleDownThreshold) {
        weightedScoreDown += weight;
        triggerPolicy = policy.type;
      }
    }

    const upRatio = totalWeight > 0 ? weightedScoreUp / totalWeight : 0;
    const downRatio = totalWeight > 0 ? weightedScoreDown / totalWeight : 0;

    let direction: ScaleDirection = 'none';
    let desired = this.currentInstances;

    if (upRatio >= 0.5 && this.currentInstances < this.config.maxInstances) {
      direction = 'up';
      desired = Math.min(
        this.config.maxInstances,
        this.currentInstances + this.config.stepSize,
      );
    } else if (downRatio >= 0.5 && this.currentInstances > this.config.minInstances) {
      direction = 'down';
      desired = Math.max(
        this.config.minInstances,
        this.currentInstances - this.config.stepSize,
      );
    }

    if (this.config.policies.length > 1) {
      triggerPolicy = 'composite';
    }

    return {
      direction,
      currentInstances: this.currentInstances,
      desiredInstances: desired,
      reason: direction === 'none'
        ? 'Metrics within acceptable range'
        : `${direction === 'up' ? 'High' : 'Low'} utilization detected (${triggerPolicy})`,
      triggeredBy: triggerPolicy,
      timestamp: now,
      metrics,
    };
  }

  private getUtilization(type: ScalingPolicyType, metrics: ScalerMetrics): number {
    switch (type) {
      case 'cpu':
        return metrics.cpuPercent;
      case 'connections':
        return metrics.maxConnections > 0
          ? (metrics.activeConnections / metrics.maxConnections) * 100
          : 0;
      case 'messages':
        return metrics.maxMessagesPerSecond > 0
          ? (metrics.messagesPerSecond / metrics.maxMessagesPerSecond) * 100
          : 0;
      case 'latency':
        return metrics.maxLatencyMs > 0
          ? (metrics.avgLatencyMs / metrics.maxLatencyMs) * 100
          : 0;
      case 'composite':
        return (metrics.cpuPercent + (metrics.activeConnections / Math.max(metrics.maxConnections, 1)) * 100) / 2;
    }
  }
}

/** Factory function to create an AutoScaler */
export function createAutoScaler(config: AutoScalerConfig): AutoScaler {
  return new AutoScaler(config);
}

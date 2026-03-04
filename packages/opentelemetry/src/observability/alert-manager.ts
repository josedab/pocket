/**
 * AlertManager — rule-based alerting engine that evaluates metrics
 * against configurable thresholds and dispatches notifications.
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';

import type { AlertAction, AlertCondition, AlertRule, FiredAlert } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function generateId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function evaluateCondition(condition: AlertCondition, value: number): boolean {
  switch (condition.operator) {
    case 'gt':
      return value > condition.threshold;
    case 'lt':
      return value < condition.threshold;
    case 'gte':
      return value >= condition.threshold;
    case 'lte':
      return value <= condition.threshold;
    case 'eq':
      return value === condition.threshold;
    default:
      return false;
  }
}

// ── AlertManager ─────────────────────────────────────────

export interface AlertManagerConfig {
  cooldownMs?: number;
  maxAlerts?: number;
}

export class AlertManager {
  private readonly defaultCooldown: number;
  private readonly maxAlerts: number;
  private readonly rules = new Map<string, AlertRule>();
  private readonly firedAlerts: FiredAlert[] = [];
  private readonly lastFiredAt = new Map<string, number>();
  private readonly alertSubject = new Subject<FiredAlert>();
  private destroyed = false;

  constructor(config: AlertManagerConfig = {}) {
    this.defaultCooldown = config.cooldownMs ?? 60_000;
    this.maxAlerts = config.maxAlerts ?? 1000;
  }

  /**
   * Add a new alert rule. Returns the generated rule ID.
   */
  addRule(rule: Omit<AlertRule, 'id'>): string {
    const id = generateId();
    const fullRule: AlertRule = { ...rule, id };
    this.rules.set(id, fullRule);
    return id;
  }

  /**
   * Remove an alert rule by ID.
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.lastFiredAt.delete(ruleId);
  }

  /**
   * Enable an alert rule.
   */
  enableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) rule.enabled = true;
  }

  /**
   * Disable an alert rule.
   */
  disableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) rule.enabled = false;
  }

  /**
   * Get all configured rules.
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluate a metric value against all matching rules.
   * Returns any alerts that fired.
   */
  evaluate(metric: string, value: number): FiredAlert[] {
    if (this.destroyed) return [];

    const fired: FiredAlert[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.metric !== metric && rule.metric !== 'custom') continue;

      // Check cooldown
      const lastFired = this.lastFiredAt.get(rule.id) ?? 0;
      if (now - lastFired < rule.cooldownMs) continue;

      if (evaluateCondition(rule.condition, value)) {
        const alert: FiredAlert = {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          value,
          threshold: rule.condition.threshold,
          message: `${rule.name}: ${metric} ${rule.condition.operator} ${rule.condition.threshold} (actual: ${value})`,
          timestamp: now,
        };

        this.firedAlerts.push(alert);
        while (this.firedAlerts.length > this.maxAlerts) {
          this.firedAlerts.shift();
        }

        this.lastFiredAt.set(rule.id, now);
        fired.push(alert);

        // Dispatch actions
        this.dispatchActions(rule.actions, alert);

        // Emit on observable
        if (!this.destroyed) {
          this.alertSubject.next(alert);
        }
      }
    }

    return fired;
  }

  /**
   * Get all fired alerts.
   */
  getActiveAlerts(): FiredAlert[] {
    return [...this.firedAlerts];
  }

  /**
   * Acknowledge and remove a fired alert by matching ruleId + timestamp.
   */
  acknowledgeAlert(alertId: string): void {
    const idx = this.firedAlerts.findIndex((a) => a.ruleId === alertId);
    if (idx !== -1) this.firedAlerts.splice(idx, 1);
  }

  /**
   * Clear all fired alerts.
   */
  clearAlerts(): void {
    this.firedAlerts.length = 0;
  }

  /**
   * Observable stream of fired alerts.
   */
  get alerts$(): Observable<FiredAlert> {
    return this.alertSubject.asObservable();
  }

  /**
   * Destroy the alert manager.
   */
  destroy(): void {
    this.destroyed = true;
    this.alertSubject.complete();
    this.rules.clear();
    this.firedAlerts.length = 0;
    this.lastFiredAt.clear();
  }

  // ── Private ────────────────────────────────────────────

  private dispatchActions(actions: AlertAction[], alert: FiredAlert): void {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'log':
            this.logAlert(action.level, alert);
            break;
          case 'callback':
            action.fn(alert);
            break;
          case 'webhook':
            // Fire-and-forget webhook
            void this.sendWebhook(action.url, action.method ?? 'POST', alert);
            break;
        }
      } catch {
        // Swallow action errors to avoid breaking evaluation
      }
    }
  }

  private logAlert(level: 'info' | 'warn' | 'error', alert: FiredAlert): void {
    const msg = `[Alert:${alert.severity}] ${alert.message}`;
    switch (level) {
      case 'info':
        console.info(msg);
        break;
      case 'warn':
        console.warn(msg);
        break;
      case 'error':
        console.error(msg);
        break;
    }
  }

  private async sendWebhook(url: string, method: string, alert: FiredAlert): Promise<void> {
    try {
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      });
    } catch {
      // Webhook failures are silently ignored
    }
  }
}

/**
 * Create an AlertManager instance.
 */
export function createAlertManager(config?: AlertManagerConfig): AlertManager {
  return new AlertManager(config);
}

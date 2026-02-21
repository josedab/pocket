/**
 * Funnel analysis computation engine for offline-first analytics.
 *
 * Computes actual funnel conversion from recorded analytics events,
 * supporting multi-step funnels with time window constraints,
 * user-level deduplication, and step-to-step dropout analysis.
 *
 * @module funnel-engine
 */

import type { AnalyticsEvent } from './types.js';

/** Funnel definition */
export interface FunnelDefinition {
  /** Unique funnel ID */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Ordered list of step event names */
  readonly steps: readonly string[];
  /** Maximum time between first and last step (ms). 0 = unlimited. */
  readonly windowMs?: number;
}

/** Computed funnel result */
export interface FunnelResult {
  readonly funnelId: string;
  readonly name: string;
  readonly steps: readonly FunnelStepResult[];
  readonly totalConversionRate: number;
  readonly uniqueUsersEntered: number;
  readonly uniqueUsersCompleted: number;
  readonly medianCompletionTimeMs: number | null;
}

/** Single step result */
export interface FunnelStepResult {
  readonly stepIndex: number;
  readonly eventName: string;
  readonly uniqueUsers: number;
  readonly conversionRate: number;
  readonly dropoffRate: number;
  readonly dropoffCount: number;
}

/**
 * Compute a funnel from analytics events.
 *
 * Groups events by user/session, checks that steps occur in order,
 * and computes conversion and dropout at each step.
 *
 * @example
 * ```typescript
 * import { computeFunnel } from '@pocket/analytics';
 *
 * const funnel = computeFunnel(
 *   { id: 'signup', name: 'Signup Flow', steps: ['page_view', 'form_start', 'form_submit', 'signup_complete'] },
 *   events,
 * );
 *
 * console.log(`Overall conversion: ${funnel.totalConversionRate}%`);
 * for (const step of funnel.steps) {
 *   console.log(`  ${step.eventName}: ${step.uniqueUsers} users (${step.dropoffRate}% dropout)`);
 * }
 * ```
 */
export function computeFunnel(
  definition: FunnelDefinition,
  events: readonly AnalyticsEvent[],
  options?: { userIdField?: string },
): FunnelResult {
  const userIdField = options?.userIdField ?? 'userId';
  const windowMs = definition.windowMs ?? 0;

  // Group events by user
  const userEvents = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const userId = getEventUserId(event, userIdField);
    if (!userId) continue;
    let list = userEvents.get(userId);
    if (!list) {
      list = [];
      userEvents.set(userId, list);
    }
    list.push(event);
  }

  // Sort each user's events by timestamp
  for (const list of userEvents.values()) {
    list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }

  // Compute per-step counts
  const stepCounts: number[] = Array(definition.steps.length).fill(0) as number[];
  const completionTimes: number[] = [];

  for (const [, userEventList] of userEvents) {
    let currentStepIndex = 0;
    let firstStepTime: number | null = null;

    for (const event of userEventList) {
      if (currentStepIndex >= definition.steps.length) break;

      const expectedStep = definition.steps[currentStepIndex];
      if (event.name === expectedStep) {
        // Check time window
        if (currentStepIndex === 0) {
          firstStepTime = event.timestamp ?? Date.now();
        } else if (windowMs > 0 && firstStepTime !== null) {
          const elapsed = (event.timestamp ?? Date.now()) - firstStepTime;
          if (elapsed > windowMs) break; // Outside window
        }

        stepCounts[currentStepIndex]!++;
        currentStepIndex++;
      }
    }

    // Track completion time for users who finished all steps
    if (currentStepIndex === definition.steps.length && firstStepTime !== null) {
      const lastEvent = userEventList[userEventList.length - 1];
      const endTime = lastEvent?.timestamp ?? Date.now();
      completionTimes.push(endTime - firstStepTime);
    }
  }

  // Build step results
  const entered = stepCounts[0] ?? 0;
  const steps: FunnelStepResult[] = definition.steps.map((eventName, i) => {
    const current = stepCounts[i] ?? 0;
    const previous = i === 0 ? entered : (stepCounts[i - 1] ?? 0);
    const dropoffCount = previous - current;
    const dropoffRate = previous > 0 ? Math.round((dropoffCount / previous) * 10000) / 100 : 0;
    const conversionRate = entered > 0 ? Math.round((current / entered) * 10000) / 100 : 0;

    return { stepIndex: i, eventName, uniqueUsers: current, conversionRate, dropoffRate, dropoffCount };
  });

  const completed = stepCounts[definition.steps.length - 1] ?? 0;
  const totalConversionRate = entered > 0 ? Math.round((completed / entered) * 10000) / 100 : 0;

  // Median completion time
  completionTimes.sort((a, b) => a - b);
  const medianCompletionTimeMs = completionTimes.length > 0
    ? completionTimes[Math.floor(completionTimes.length / 2)]!
    : null;

  return {
    funnelId: definition.id,
    name: definition.name,
    steps,
    totalConversionRate,
    uniqueUsersEntered: entered,
    uniqueUsersCompleted: completed,
    medianCompletionTimeMs,
  };
}

function getEventUserId(event: AnalyticsEvent, field: string): string | null {
  if (field === 'userId' && event.userId) return event.userId;
  if (field === 'anonymousId') return event.anonymousId;
  if (field === 'sessionId') return event.sessionId;
  if (event.properties && field in event.properties) return String(event.properties[field]);
  return event.userId ?? null;
}

/**
 * Compute multiple funnels from the same event set.
 */
export function computeFunnels(
  definitions: readonly FunnelDefinition[],
  events: readonly AnalyticsEvent[],
): readonly FunnelResult[] {
  return definitions.map((def) => computeFunnel(def, events));
}

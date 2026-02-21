/**
 * A/B test experiment framework for offline-first analytics.
 *
 * Defines experiments with variants, assigns users to variants
 * deterministically, and tracks conversion/engagement metrics locally.
 *
 * @module ab-testing
 */

/** Experiment variant */
export interface ExperimentVariant {
  readonly id: string;
  readonly name: string;
  /** Weight for assignment (default: equal) */
  readonly weight: number;
  /** Variant-specific configuration */
  readonly config?: Record<string, unknown>;
}

/** Experiment definition */
export interface Experiment {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly variants: readonly ExperimentVariant[];
  readonly startedAt: number;
  readonly endedAt?: number;
  /** Percentage of users to include (0-100, default: 100) */
  readonly trafficPercent: number;
  readonly status: 'draft' | 'running' | 'paused' | 'completed';
}

/** User's assignment to a variant */
export interface VariantAssignment {
  readonly experimentId: string;
  readonly variantId: string;
  readonly userId: string;
  readonly assignedAt: number;
}

/** Experiment result metrics per variant */
export interface VariantMetrics {
  readonly variantId: string;
  readonly variantName: string;
  readonly participants: number;
  readonly conversions: number;
  readonly conversionRate: number;
  readonly events: number;
}

/** Full experiment results */
export interface ExperimentResults {
  readonly experimentId: string;
  readonly name: string;
  readonly variants: readonly VariantMetrics[];
  readonly totalParticipants: number;
  readonly winner: string | null;
  readonly confidence: number;
}

/**
 * Offline-first A/B testing framework.
 *
 * @example
 * ```typescript
 * const ab = new ABTestEngine();
 *
 * ab.createExperiment({
 *   id: 'checkout-v2',
 *   name: 'New Checkout Flow',
 *   variants: [
 *     { id: 'control', name: 'Current', weight: 50 },
 *     { id: 'treatment', name: 'New Flow', weight: 50 },
 *   ],
 *   trafficPercent: 100,
 * });
 *
 * // Get user's variant
 * const variant = ab.getVariant('checkout-v2', 'user-123');
 * if (variant.id === 'treatment') showNewCheckout();
 *
 * // Track conversion
 * ab.trackConversion('checkout-v2', 'user-123');
 *
 * // Get results
 * const results = ab.getResults('checkout-v2');
 * ```
 */
export class ABTestEngine {
  private readonly experiments = new Map<string, Experiment>();
  private readonly assignments = new Map<string, VariantAssignment>();
  private readonly conversions = new Map<string, Set<string>>(); // experimentId → set of userIds
  private readonly eventCounts = new Map<string, Map<string, number>>(); // experimentId:variantId → count

  /** Create a new experiment */
  createExperiment(input: Omit<Experiment, 'startedAt' | 'status'>): Experiment {
    const experiment: Experiment = {
      ...input,
      startedAt: Date.now(),
      status: 'running',
    };
    this.experiments.set(experiment.id, experiment);
    this.conversions.set(experiment.id, new Set());
    return experiment;
  }

  /** Get an experiment by ID */
  getExperiment(experimentId: string): Experiment | undefined {
    return this.experiments.get(experimentId);
  }

  /** List all experiments */
  listExperiments(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  /** Deterministically assign a user to a variant */
  getVariant(experimentId: string, userId: string): ExperimentVariant | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== 'running') return null;

    // Check existing assignment
    const assignmentKey = `${experimentId}:${userId}`;
    const existing = this.assignments.get(assignmentKey);
    if (existing) {
      return experiment.variants.find((v) => v.id === existing.variantId) ?? null;
    }

    // Check traffic percentage
    const hash = this.hashString(`${experimentId}:${userId}:traffic`);
    if ((hash % 100) >= experiment.trafficPercent) return null;

    // Assign variant based on weights
    const variantHash = this.hashString(`${experimentId}:${userId}:variant`);
    const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
    let threshold = variantHash % totalWeight;

    for (const variant of experiment.variants) {
      threshold -= variant.weight;
      if (threshold < 0) {
        this.assignments.set(assignmentKey, {
          experimentId,
          variantId: variant.id,
          userId,
          assignedAt: Date.now(),
        });
        return variant;
      }
    }

    // Fallback to first variant
    const fallback = experiment.variants[0]!;
    this.assignments.set(assignmentKey, {
      experimentId,
      variantId: fallback.id,
      userId,
      assignedAt: Date.now(),
    });
    return fallback;
  }

  /** Track a conversion for a user */
  trackConversion(experimentId: string, userId: string): boolean {
    const conversions = this.conversions.get(experimentId);
    if (!conversions) return false;
    conversions.add(userId);
    return true;
  }

  /** Track a generic event for a variant */
  trackEvent(experimentId: string, userId: string): void {
    const assignmentKey = `${experimentId}:${userId}`;
    const assignment = this.assignments.get(assignmentKey);
    if (!assignment) return;

    const current = this.eventCounts.get(experimentId) ?? new Map<string, number>();
    current.set(assignment.variantId, (current.get(assignment.variantId) ?? 0) + 1);
    this.eventCounts.set(experimentId, current);
  }

  /** Get experiment results */
  getResults(experimentId: string): ExperimentResults | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return null;

    const conversions = this.conversions.get(experimentId) ?? new Set<string>();
    const events = this.eventCounts.get(experimentId) ?? new Map<string, number>();

    // Count participants per variant
    const variantParticipants = new Map<string, number>();
    const variantConversions = new Map<string, number>();

    for (const [key, assignment] of this.assignments) {
      if (!key.startsWith(`${experimentId}:`)) continue;
      variantParticipants.set(
        assignment.variantId,
        (variantParticipants.get(assignment.variantId) ?? 0) + 1,
      );

      if (conversions.has(assignment.userId)) {
        variantConversions.set(
          assignment.variantId,
          (variantConversions.get(assignment.variantId) ?? 0) + 1,
        );
      }
    }

    const variantMetrics: VariantMetrics[] = experiment.variants.map((v) => {
      const participants = variantParticipants.get(v.id) ?? 0;
      const convCount = variantConversions.get(v.id) ?? 0;
      return {
        variantId: v.id,
        variantName: v.name,
        participants,
        conversions: convCount,
        conversionRate: participants > 0 ? Math.round((convCount / participants) * 10000) / 100 : 0,
        events: events.get(v.id) ?? 0,
      };
    });

    // Determine winner (highest conversion rate with min 10 participants)
    const eligible = variantMetrics.filter((v) => v.participants >= 10);
    eligible.sort((a, b) => b.conversionRate - a.conversionRate);
    const winner = eligible.length > 0 ? eligible[0]!.variantId : null;

    // Simple confidence estimate based on sample size
    const totalParticipants = variantMetrics.reduce((s, v) => s + v.participants, 0);
    const confidence = Math.min(95, Math.round(Math.sqrt(totalParticipants) * 5));

    return {
      experimentId,
      name: experiment.name,
      variants: variantMetrics,
      totalParticipants,
      winner,
      confidence,
    };
  }

  /** End an experiment */
  endExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (experiment) {
      this.experiments.set(experimentId, { ...experiment, status: 'completed', endedAt: Date.now() });
    }
  }

  // Simple deterministic hash for consistent assignment
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash);
  }
}

/** Factory function */
export function createABTestEngine(): ABTestEngine {
  return new ABTestEngine();
}

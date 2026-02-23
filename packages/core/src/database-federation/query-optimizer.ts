/**
 * FederatedQueryOptimizer — Query planning for cross-database joins.
 *
 * Analyzes federated query specs and chooses the optimal join strategy
 * (hash join vs nested loops) based on estimated cardinality.
 *
 * @example
 * ```typescript
 * const optimizer = new FederatedQueryOptimizer();
 * const plan = await optimizer.plan(registry, {
 *   from: { db: 'users-db', collection: 'users' },
 *   join: { db: 'orders-db', collection: 'orders', on: 'userId' },
 * });
 * console.log(plan.strategy, plan.estimatedCost);
 * const result = await optimizer.execute(registry, plan);
 * ```
 */

import type {
  FederatableDatabase,
  FederatedQueryResult,
  FederatedQuerySpec,
} from './database-registry.js';

// ── Types ──────────────────────────────────────────────────

export type JoinStrategy = 'hash-join' | 'nested-loop' | 'no-join';

export interface FederatedQueryPlan {
  spec: FederatedQuerySpec;
  strategy: JoinStrategy;
  estimatedPrimaryCost: number;
  estimatedJoinCost: number;
  estimatedTotalCost: number;
  explanation: string;
  steps: FederatedPlanStep[];
}

export interface FederatedPlanStep {
  operation: 'scan' | 'filter' | 'build-index' | 'hash-join' | 'nested-loop' | 'limit';
  target: string;
  estimatedRows: number;
  description: string;
}

export interface FederatedOptimizerStats {
  totalPlans: number;
  hashJoinCount: number;
  nestedLoopCount: number;
  avgPlanTimeMs: number;
}

/** Minimal database registry interface for optimizer */
export interface FederatedRegistry {
  get(name: string): FederatableDatabase | undefined;
}

// ── Configuration ─────────────────────────────────────────

/** Threshold above which hash join is preferred over nested loop */
const HASH_JOIN_THRESHOLD = 100;

// ── Implementation ────────────────────────────────────────

export class FederatedQueryOptimizer {
  private totalPlans = 0;
  private hashJoinCount = 0;
  private nestedLoopCount = 0;
  private planTimes: number[] = [];

  /**
   * Generate an optimized query plan.
   */
  async plan(registry: FederatedRegistry, spec: FederatedQuerySpec): Promise<FederatedQueryPlan> {
    const start = performance.now();
    this.totalPlans++;

    const steps: FederatedPlanStep[] = [];

    // Estimate primary cardinality
    const primaryDb = registry.get(spec.from.db);
    if (!primaryDb) throw new Error(`Database "${spec.from.db}" not found`);

    const primaryCol = primaryDb.collection<Record<string, unknown>>(spec.from.collection);
    const primaryDocs = await primaryCol.find(spec.from.filter).exec();
    const primaryCount = primaryDocs.length;

    steps.push({
      operation: 'scan',
      target: `${spec.from.db}.${spec.from.collection}`,
      estimatedRows: primaryCount,
      description: `Scan ${spec.from.collection}${spec.from.filter ? ' with filter' : ''}`,
    });

    if (spec.filter) {
      const filteredCount = Math.ceil(primaryCount * 0.5); // estimate 50% selectivity
      steps.push({
        operation: 'filter',
        target: `${spec.from.db}.${spec.from.collection}`,
        estimatedRows: filteredCount,
        description: `Apply global filter`,
      });
    }

    let strategy: JoinStrategy = 'no-join';
    let joinCost = 0;

    if (spec.join) {
      const joinDb = registry.get(spec.join.db);
      if (!joinDb) throw new Error(`Database "${spec.join.db}" not found`);

      const joinCol = joinDb.collection<Record<string, unknown>>(spec.join.collection);
      const joinDocs = await joinCol.find().exec();
      const joinCount = joinDocs.length;

      // Choose strategy based on cardinality
      const nestedLoopCost = primaryCount * joinCount;
      const hashJoinCost = primaryCount + joinCount;

      if (primaryCount > HASH_JOIN_THRESHOLD || joinCount > HASH_JOIN_THRESHOLD) {
        strategy = 'hash-join';
        joinCost = hashJoinCost;
        this.hashJoinCount++;

        steps.push({
          operation: 'build-index',
          target: `${spec.join.db}.${spec.join.collection}`,
          estimatedRows: joinCount,
          description: `Build hash index on ${spec.join.foreignKey ?? spec.join.on}`,
        });

        steps.push({
          operation: 'hash-join',
          target: `${spec.from.db} ⋈ ${spec.join.db}`,
          estimatedRows: Math.min(primaryCount, joinCount),
          description: `Hash join on ${spec.join.on}`,
        });
      } else {
        strategy = 'nested-loop';
        joinCost = nestedLoopCost;
        this.nestedLoopCount++;

        steps.push({
          operation: 'nested-loop',
          target: `${spec.from.db} ⋈ ${spec.join.db}`,
          estimatedRows: Math.min(primaryCount * 2, nestedLoopCost),
          description: `Nested loop join on ${spec.join.on}`,
        });
      }
    }

    if (spec.limit) {
      steps.push({
        operation: 'limit',
        target: 'result',
        estimatedRows: spec.limit,
        description: `Limit to ${spec.limit} rows`,
      });
    }

    const totalCost = primaryCount + joinCost;
    const elapsed = performance.now() - start;
    this.planTimes.push(elapsed);
    if (this.planTimes.length > 100) this.planTimes.shift();

    return {
      spec,
      strategy,
      estimatedPrimaryCost: primaryCount,
      estimatedJoinCost: joinCost,
      estimatedTotalCost: totalCost,
      explanation: this.buildExplanation(strategy, primaryCount, joinCost),
      steps,
    };
  }

  /**
   * Execute a query plan using the optimal strategy.
   */
  async execute(
    registry: FederatedRegistry,
    plan: FederatedQueryPlan
  ): Promise<FederatedQueryResult> {
    const start = performance.now();
    const spec = plan.spec;

    const primaryDb = registry.get(spec.from.db)!;
    const primaryCol = primaryDb.collection<Record<string, unknown>>(spec.from.collection);
    let primaryDocs = await primaryCol.find(spec.from.filter).exec();

    if (spec.filter) {
      primaryDocs = primaryDocs.filter((doc) =>
        Object.entries(spec.filter!).every(([k, v]) => doc[k] === v)
      );
    }

    const sources = [spec.from.db];
    let joinedCount = 0;

    if (spec.join) {
      const joinDb = registry.get(spec.join.db)!;
      const joinCol = joinDb.collection<Record<string, unknown>>(spec.join.collection);
      const joinDocs = await joinCol.find().exec();
      sources.push(spec.join.db);

      const joinField = spec.join.on;
      const foreignKey = spec.join.foreignKey ?? spec.join.on;

      if (plan.strategy === 'hash-join') {
        // Build hash index on join collection
        const index = new Map<unknown, Record<string, unknown>[]>();
        for (const jDoc of joinDocs) {
          const key = jDoc[foreignKey];
          const list = index.get(key);
          if (list) list.push(jDoc);
          else index.set(key, [jDoc]);
        }

        const merged: Record<string, unknown>[] = [];
        for (const pDoc of primaryDocs) {
          const matches = index.get(pDoc[joinField]) ?? [];
          if (matches.length > 0) {
            for (const m of matches) {
              merged.push({ ...pDoc, _joined: m });
              joinedCount++;
            }
          } else {
            merged.push({ ...pDoc, _joined: null });
          }
        }
        primaryDocs = merged;
      } else {
        // Nested loop
        const merged: Record<string, unknown>[] = [];
        for (const pDoc of primaryDocs) {
          const matches = joinDocs.filter((j) => j[foreignKey] === pDoc[joinField]);
          if (matches.length > 0) {
            for (const m of matches) {
              merged.push({ ...pDoc, _joined: m });
              joinedCount++;
            }
          } else {
            merged.push({ ...pDoc, _joined: null });
          }
        }
        primaryDocs = merged;
      }
    }

    if (spec.limit) {
      primaryDocs = primaryDocs.slice(0, spec.limit);
    }

    return {
      rows: primaryDocs,
      sources,
      joinedCount,
      executionTimeMs: performance.now() - start,
    };
  }

  /**
   * Get optimizer statistics.
   */
  getStats(): FederatedOptimizerStats {
    return {
      totalPlans: this.totalPlans,
      hashJoinCount: this.hashJoinCount,
      nestedLoopCount: this.nestedLoopCount,
      avgPlanTimeMs:
        this.planTimes.length > 0
          ? this.planTimes.reduce((a, b) => a + b, 0) / this.planTimes.length
          : 0,
    };
  }

  private buildExplanation(strategy: JoinStrategy, primaryCost: number, joinCost: number): string {
    switch (strategy) {
      case 'hash-join':
        return `Hash join selected (primary: ${primaryCost} rows, join: ${joinCost} total ops). Build hash index on right table, then probe with left table rows.`;
      case 'nested-loop':
        return `Nested loop join selected (primary: ${primaryCost} rows, join: ${joinCost} total ops). Small dataset — direct iteration is efficient.`;
      case 'no-join':
        return `Single table scan (${primaryCost} rows). No join required.`;
    }
  }
}

export function createFederatedQueryOptimizer(): FederatedQueryOptimizer {
  return new FederatedQueryOptimizer();
}

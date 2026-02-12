/**
 * @module query-complexity
 *
 * Query complexity analysis for the GraphQL gateway.
 * Calculates complexity scores, enforces depth limits, and provides
 * per-field cost assignment with breakdown reports.
 *
 * @example
 * ```typescript
 * import { createQueryComplexityAnalyzer } from '@pocket/graphql-gateway';
 *
 * const analyzer = createQueryComplexityAnalyzer({
 *   maxComplexity: 1000,
 *   maxDepth: 10,
 *   defaultFieldCost: 1,
 * });
 *
 * // Set custom cost for expensive fields
 * analyzer.setFieldCost('Query.searchUsers', 15);
 *
 * // Analyze a parsed query
 * const result = analyzer.analyze(queryNode);
 * if (!result.allowed) {
 *   console.error(result.message);
 * }
 * ```
 */

/** Configuration for the query complexity analyzer. */
export interface QueryComplexityConfig {
  /** Maximum allowed complexity score (default: 1000). */
  maxComplexity?: number;
  /** Maximum allowed query depth (default: 10). */
  maxDepth?: number;
  /** Default cost per field if not explicitly assigned (default: 1). */
  defaultFieldCost?: number;
  /** Multiplier applied to list fields (default: 10). */
  listMultiplier?: number;
}

/**
 * A simplified representation of a query field node used for analysis.
 * This is intentionally decoupled from any specific GraphQL AST library.
 */
export interface QueryFieldNode {
  /** Field name. */
  name: string;
  /** Whether this field returns a list. */
  isList?: boolean;
  /** Nested selections (child fields). */
  children?: QueryFieldNode[];
}

/** Breakdown of cost per field path. */
export interface FieldCostEntry {
  /** Dot-separated field path (e.g. "Query.users.posts"). */
  path: string;
  /** Computed cost for this field. */
  cost: number;
  /** Depth of this field in the query tree. */
  depth: number;
}

/** Result returned by the complexity analyzer. */
export interface ComplexityResult {
  /** Whether the query is within the configured limits. */
  allowed: boolean;
  /** Total complexity score. */
  totalComplexity: number;
  /** Maximum depth reached in the query. */
  maxDepthReached: number;
  /** Human-readable message (populated when rejected). */
  message?: string;
  /** Per-field cost breakdown. */
  breakdown: FieldCostEntry[];
}

const DEFAULT_MAX_COMPLEXITY = 1000;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_FIELD_COST = 1;
const DEFAULT_LIST_MULTIPLIER = 10;

/**
 * Analyzes GraphQL query complexity and enforces configurable limits.
 */
export class QueryComplexityAnalyzer {
  private readonly config: Required<QueryComplexityConfig>;
  private readonly fieldCosts = new Map<string, number>();

  constructor(config: QueryComplexityConfig = {}) {
    this.config = {
      maxComplexity: config.maxComplexity ?? DEFAULT_MAX_COMPLEXITY,
      maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
      defaultFieldCost: config.defaultFieldCost ?? DEFAULT_FIELD_COST,
      listMultiplier: config.listMultiplier ?? DEFAULT_LIST_MULTIPLIER,
    };
  }

  /** Set a custom cost for a specific field path (e.g. "Query.searchUsers"). */
  setFieldCost(fieldPath: string, cost: number): void {
    this.fieldCosts.set(fieldPath, cost);
  }

  /** Get the configured cost for a field path, or the default cost. */
  getFieldCost(fieldPath: string): number {
    return this.fieldCosts.get(fieldPath) ?? this.config.defaultFieldCost;
  }

  /** Remove a previously set field cost override. */
  removeFieldCost(fieldPath: string): void {
    this.fieldCosts.delete(fieldPath);
  }

  /**
   * Analyze a query represented as a tree of {@link QueryFieldNode}s.
   *
   * @param fields - Top-level field selections (e.g. one per operation root field).
   * @param parentPath - Optional path prefix (used internally for recursion).
   * @returns A {@link ComplexityResult} indicating whether the query is allowed.
   */
  analyze(
    fields: QueryFieldNode[],
    parentPath?: string,
  ): ComplexityResult {
    const breakdown: FieldCostEntry[] = [];
    let totalComplexity = 0;
    let maxDepthReached = 0;

    this.walk(fields, parentPath ?? '', 1, 1, breakdown);

    for (const entry of breakdown) {
      totalComplexity += entry.cost;
      if (entry.depth > maxDepthReached) {
        maxDepthReached = entry.depth;
      }
    }

    if (maxDepthReached > this.config.maxDepth) {
      return {
        allowed: false,
        totalComplexity,
        maxDepthReached,
        message: `Query depth ${maxDepthReached} exceeds maximum allowed depth of ${this.config.maxDepth}`,
        breakdown,
      };
    }

    if (totalComplexity > this.config.maxComplexity) {
      return {
        allowed: false,
        totalComplexity,
        maxDepthReached,
        message: `Query complexity ${totalComplexity} exceeds maximum allowed complexity of ${this.config.maxComplexity}`,
        breakdown,
      };
    }

    return {
      allowed: true,
      totalComplexity,
      maxDepthReached,
      breakdown,
    };
  }

  /** Return the current configuration (read-only snapshot). */
  getConfig(): Readonly<Required<QueryComplexityConfig>> {
    return { ...this.config };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private walk(
    fields: QueryFieldNode[],
    parentPath: string,
    depth: number,
    multiplier: number,
    breakdown: FieldCostEntry[],
  ): void {
    for (const field of fields) {
      const path = parentPath ? `${parentPath}.${field.name}` : field.name;
      const baseCost = this.getFieldCost(path);
      const fieldMultiplier = field.isList
        ? multiplier * this.config.listMultiplier
        : multiplier;
      const cost = baseCost * fieldMultiplier;

      breakdown.push({ path, cost, depth });

      if (field.children && field.children.length > 0) {
        this.walk(field.children, path, depth + 1, fieldMultiplier, breakdown);
      }
    }
  }
}

/** Factory function to create a {@link QueryComplexityAnalyzer}. */
export function createQueryComplexityAnalyzer(
  config: QueryComplexityConfig = {},
): QueryComplexityAnalyzer {
  return new QueryComplexityAnalyzer(config);
}

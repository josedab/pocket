/** OLAP query types and interfaces */

/** Aggregation function type */
export type AggregateFunction =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | 'median'
  | 'stddev'
  | 'variance'
  | 'first'
  | 'last';

/** Window frame type */
export type WindowFrameType = 'rows' | 'range';

/** Window frame boundary */
export type WindowFrameBound =
  | 'unbounded_preceding'
  | 'current_row'
  | 'unbounded_following'
  | number;

/** Window function specification */
export interface WindowSpec {
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  frame?: {
    type: WindowFrameType;
    start: WindowFrameBound;
    end: WindowFrameBound;
  };
}

/** Window function definition */
export interface WindowFunctionDef {
  name: string;
  fn:
    | AggregateFunction
    | 'row_number'
    | 'rank'
    | 'dense_rank'
    | 'lag'
    | 'lead'
    | 'ntile';
  field?: string;
  windowSpec: WindowSpec;
  alias: string;
}

/** Group-by specification */
export interface GroupBySpec {
  fields: string[];
  aggregations: Array<{
    field: string;
    fn: AggregateFunction;
    alias: string;
  }>;
  having?: (group: Record<string, unknown>) => boolean;
}

/** Rollup specification - hierarchical aggregation */
export interface RollupSpec {
  dimensions: string[];
  measures: Array<{
    field: string;
    fn: AggregateFunction;
    alias: string;
  }>;
}

/** Cube specification - all combinations of dimensions */
export interface CubeSpec {
  dimensions: string[];
  measures: Array<{
    field: string;
    fn: AggregateFunction;
    alias: string;
  }>;
}

/** Pivot specification */
export interface PivotSpec {
  rowFields: string[];
  columnField: string;
  valueField: string;
  aggregation: AggregateFunction;
}

/** Pivot result */
export interface PivotResult {
  rows: Record<string, unknown>[];
  columnValues: unknown[];
  totals?: Record<string, unknown>;
}

/** OLAP query result */
export interface OLAPResult<T = Record<string, unknown>> {
  data: T[];
  metadata: {
    rowCount: number;
    executionTimeMs: number;
    dimensions: string[];
    measures: string[];
    engine: 'main-thread' | 'worker';
  };
}

/** OLAP engine configuration */
export interface OLAPEngineConfig {
  workerThreshold?: number;
  enableIncrementalUpdates?: boolean;
  cacheResults?: boolean;
  cacheTTLMs?: number;
}

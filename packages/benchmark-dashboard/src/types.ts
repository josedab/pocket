/**
 * Benchmark Dashboard — types and harness for comparing database engines.
 */

/** A database engine adapter for benchmarking. */
export interface BenchmarkEngine {
  readonly name: string;
  readonly version: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  insertOne(doc: Record<string, unknown>): Promise<void>;
  insertBatch(docs: readonly Record<string, unknown>[]): Promise<void>;
  findAll(): Promise<unknown[]>;
  findWithFilter(filter: Record<string, unknown>): Promise<unknown[]>;
  updateOne(id: string, changes: Record<string, unknown>): Promise<void>;
  deleteOne(id: string): Promise<void>;
}

/** Configuration for a benchmark run. */
export interface BenchmarkRunConfig {
  readonly engines: readonly BenchmarkEngine[];
  readonly documentCount: number;
  readonly iterations: number;
  readonly warmupIterations?: number;
  readonly documentFactory?: (index: number) => Record<string, unknown>;
}

/** Result of a single benchmark operation. */
export interface OperationResult {
  readonly operation: string;
  readonly engine: string;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p95Ms: number;
  readonly opsPerSecond: number;
  readonly iterations: number;
}

/** Full benchmark report. */
export interface BenchmarkReport {
  readonly id: string;
  readonly timestamp: number;
  readonly config: {
    readonly documentCount: number;
    readonly iterations: number;
  };
  readonly results: readonly OperationResult[];
  readonly winner: Record<string, string>;
  readonly totalDurationMs: number;
}

/** Shareable state for URL encoding. */
export interface ShareableResult {
  readonly reportId: string;
  readonly encoded: string;
}

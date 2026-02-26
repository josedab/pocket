/**
 * Health Check & Benchmark Runner — diagnostic commands for
 * verifying project setup and measuring database performance.
 */

/** Health check result for a single component. */
export interface HealthCheckItem {
  readonly name: string;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly message: string;
  readonly details?: string;
}

/** Overall health check report. */
export interface HealthReport {
  readonly items: readonly HealthCheckItem[];
  readonly passed: number;
  readonly warnings: number;
  readonly failed: number;
  readonly healthy: boolean;
}

/** A single benchmark result. */
export interface BenchmarkResult {
  readonly name: string;
  readonly opsPerSecond: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly iterations: number;
}

/** Benchmark suite result. */
export interface BenchmarkReport {
  readonly results: readonly BenchmarkResult[];
  readonly totalDurationMs: number;
  readonly timestamp: number;
}

/**
 * Run health checks on the project configuration and dependencies.
 */
export function runHealthCheck(config: {
  configPath?: string;
  hasDatabase?: boolean;
  hasCollections?: boolean;
  hasTests?: boolean;
  nodeVersion?: string;
}): HealthReport {
  const items: HealthCheckItem[] = [];

  // Node.js version
  const nodeVersion = config.nodeVersion ?? process.version;
  const major = parseInt(nodeVersion.replace('v', ''), 10);
  if (major >= 18) {
    items.push({
      name: 'Node.js Version',
      status: 'pass',
      message: `${nodeVersion} (>= 18 required)`,
    });
  } else {
    items.push({
      name: 'Node.js Version',
      status: 'fail',
      message: `${nodeVersion} — upgrade to 18+`,
    });
  }

  // Config file
  if (config.configPath) {
    items.push({ name: 'Config File', status: 'pass', message: `Found: ${config.configPath}` });
  } else {
    items.push({ name: 'Config File', status: 'warn', message: 'No pocket.config.ts found' });
  }

  // Database
  if (config.hasDatabase) {
    items.push({ name: 'Database Setup', status: 'pass', message: 'Database configured' });
  } else {
    items.push({ name: 'Database Setup', status: 'fail', message: 'No database configured' });
  }

  // Collections
  if (config.hasCollections) {
    items.push({ name: 'Collections', status: 'pass', message: 'Collections defined' });
  } else {
    items.push({ name: 'Collections', status: 'warn', message: 'No collections defined' });
  }

  // Tests
  if (config.hasTests) {
    items.push({ name: 'Test Setup', status: 'pass', message: 'Tests found' });
  } else {
    items.push({ name: 'Test Setup', status: 'warn', message: 'No tests found' });
  }

  const passed = items.filter((i) => i.status === 'pass').length;
  const warnings = items.filter((i) => i.status === 'warn').length;
  const failed = items.filter((i) => i.status === 'fail').length;

  return {
    items,
    passed,
    warnings,
    failed,
    healthy: failed === 0,
  };
}

/**
 * Run a simple benchmark suite for common database operations.
 */
export async function runBenchmark(config: {
  /** Function to insert N documents. */
  insert: (count: number) => Promise<void>;
  /** Function to query documents. */
  query: () => Promise<number>;
  /** Function to update a document. */
  update: () => Promise<void>;
  /** Function to delete a document. */
  remove: () => Promise<void>;
  /** Number of iterations per benchmark. Defaults to 100. */
  iterations?: number;
}): Promise<BenchmarkReport> {
  const iterations = config.iterations ?? 100;
  const results: BenchmarkResult[] = [];
  const start = performance.now();

  // Insert benchmark
  results.push(
    await runBench('Insert (single)', iterations, async () => {
      await config.insert(1);
    })
  );

  // Bulk insert benchmark
  results.push(
    await runBench('Insert (batch 100)', Math.ceil(iterations / 10), async () => {
      await config.insert(100);
    })
  );

  // Query benchmark
  results.push(
    await runBench('Query', iterations, async () => {
      await config.query();
    })
  );

  // Update benchmark
  results.push(
    await runBench('Update', iterations, async () => {
      await config.update();
    })
  );

  // Delete benchmark
  results.push(
    await runBench('Delete', iterations, async () => {
      await config.remove();
    })
  );

  return {
    results,
    totalDurationMs: performance.now() - start,
    timestamp: Date.now(),
  };
}

async function runBench(
  name: string,
  iterations: number,
  fn: () => Promise<void>
): Promise<BenchmarkResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  const totalMs = durations.reduce((s, d) => s + d, 0);

  return {
    name,
    iterations,
    avgMs: totalMs / iterations,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    opsPerSecond: iterations > 0 ? (iterations / totalMs) * 1000 : 0,
  };
}

/**
 * Format a benchmark report as a readable string.
 */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '┌─────────────────────────────────────────────────────────┐',
    '│                  POCKET BENCHMARK REPORT                │',
    '├────────────────────┬──────────┬──────────┬──────────────┤',
    '│ Operation          │  Avg ms  │  Ops/sec │  Iterations  │',
    '├────────────────────┼──────────┼──────────┼──────────────┤',
  ];

  for (const r of report.results) {
    const name = r.name.padEnd(18);
    const avg = r.avgMs.toFixed(2).padStart(8);
    const ops = Math.round(r.opsPerSecond).toString().padStart(8);
    const iters = r.iterations.toString().padStart(12);
    lines.push(`│ ${name} │ ${avg} │ ${ops} │ ${iters} │`);
  }

  lines.push('├────────────────────┴──────────┴──────────┴──────────────┤');
  lines.push(
    `│ Total: ${report.totalDurationMs.toFixed(0)}ms${' '.repeat(45 - report.totalDurationMs.toFixed(0).length)}│`
  );
  lines.push('└─────────────────────────────────────────────────────────┘');

  return lines.join('\n');
}

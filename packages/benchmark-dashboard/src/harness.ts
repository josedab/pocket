/**
 * Benchmark Harness — executes standard benchmarks across engine adapters.
 */

import type {
  BenchmarkEngine,
  BenchmarkReport,
  BenchmarkRunConfig,
  OperationResult,
} from './types.js';

function defaultDocFactory(index: number): Record<string, unknown> {
  return {
    _id: `doc-${index}`,
    title: `Item ${index}`,
    value: Math.random() * 1000,
    active: index % 2 === 0,
    tags: ['tag-a', index % 3 === 0 ? 'tag-b' : 'tag-c'],
    createdAt: Date.now() - index * 1000,
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measureOp(
  name: string,
  engineName: string,
  iterations: number,
  fn: () => Promise<void>
): Promise<OperationResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const total = durations.reduce((s, d) => s + d, 0);

  return {
    operation: name,
    engine: engineName,
    avgMs: total / iterations,
    minMs: durations[0] ?? 0,
    maxMs: durations[durations.length - 1] ?? 0,
    p95Ms: percentile(durations, 95),
    opsPerSecond: iterations > 0 ? (iterations / total) * 1000 : 0,
    iterations,
  };
}

/**
 * Run the standard benchmark suite across all configured engines.
 */
export async function runBenchmarkSuite(config: BenchmarkRunConfig): Promise<BenchmarkReport> {
  const start = performance.now();
  const results: OperationResult[] = [];
  const docFactory = config.documentFactory ?? defaultDocFactory;
  const warmup = config.warmupIterations ?? Math.min(5, config.iterations);

  const docs = Array.from({ length: config.documentCount }, (_, i) => docFactory(i));
  const batchDocs = docs.slice(0, Math.min(100, docs.length));

  for (const engine of config.engines) {
    await engine.setup();

    // Warmup
    for (let i = 0; i < warmup; i++) {
      await engine.insertOne(docFactory(1000000 + i));
    }
    await engine.teardown();
    await engine.setup();

    // Insert single
    results.push(
      await measureOp('insert-single', engine.name, config.iterations, async () => {
        await engine.insertOne(docFactory(Math.random() * 1000000));
      })
    );

    // Insert batch
    results.push(
      await measureOp(
        'insert-batch-100',
        engine.name,
        Math.ceil(config.iterations / 10),
        async () => {
          await engine.insertBatch(batchDocs);
        }
      )
    );

    // Seed data for queries
    await engine.insertBatch(docs);

    // Find all
    results.push(
      await measureOp('find-all', engine.name, config.iterations, async () => {
        await engine.findAll();
      })
    );

    // Find with filter
    results.push(
      await measureOp('find-filtered', engine.name, config.iterations, async () => {
        await engine.findWithFilter({ active: true });
      })
    );

    // Update
    results.push(
      await measureOp('update-single', engine.name, config.iterations, async () => {
        await engine.updateOne('doc-0', { value: Math.random() });
      })
    );

    // Delete
    results.push(
      await measureOp('delete-single', engine.name, Math.ceil(config.iterations / 5), async () => {
        const id = `doc-${Math.floor(Math.random() * config.documentCount)}`;
        await engine.deleteOne(id);
      })
    );

    await engine.teardown();
  }

  // Determine winner per operation
  const operations = [...new Set(results.map((r) => r.operation))];
  const winner: Record<string, string> = {};
  for (const op of operations) {
    const opResults = results.filter((r) => r.operation === op);
    const best = opResults.reduce((a, b) => (a.avgMs < b.avgMs ? a : b));
    winner[op] = best.engine;
  }

  return {
    id: `bench-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    config: {
      documentCount: config.documentCount,
      iterations: config.iterations,
    },
    results,
    winner,
    totalDurationMs: performance.now() - start,
  };
}

/**
 * Create an in-memory benchmark engine for testing the harness itself.
 */
export function createInMemoryEngine(name = 'in-memory'): BenchmarkEngine {
  let store = new Map<string, Record<string, unknown>>();

  return {
    name,
    version: '1.0.0',
    async setup() {
      store = new Map();
    },
    async teardown() {
      store.clear();
    },
    async insertOne(doc) {
      store.set((doc._id as string) ?? crypto.randomUUID(), doc);
    },
    async insertBatch(docs) {
      for (const d of docs) store.set((d._id as string) ?? crypto.randomUUID(), d);
    },
    async findAll() {
      return Array.from(store.values());
    },
    async findWithFilter(filter) {
      return Array.from(store.values()).filter((doc) =>
        Object.entries(filter).every(([k, v]) => doc[k] === v)
      );
    },
    async updateOne(id, changes) {
      const doc = store.get(id);
      if (doc) store.set(id, { ...doc, ...changes });
    },
    async deleteOne(id) {
      store.delete(id);
    },
  };
}

/**
 * Format a report as a comparison table string.
 */
export function formatReportTable(report: BenchmarkReport): string {
  const operations = [...new Set(report.results.map((r) => r.operation))];
  const engines = [...new Set(report.results.map((r) => r.engine))];

  const lines: string[] = [
    `Benchmark: ${report.config.documentCount} docs, ${report.config.iterations} iterations`,
    '',
    `| Operation${' '.repeat(12)}| ${engines.map((e) => e.padEnd(14)).join('| ')}| Winner |`,
    `|${'-'.repeat(21)}|${engines.map(() => '-'.repeat(15)).join('|')}|--------|`,
  ];

  for (const op of operations) {
    const cells = engines.map((eng) => {
      const r = report.results.find((x) => x.operation === op && x.engine === eng);
      return r ? `${r.avgMs.toFixed(2)}ms`.padEnd(14) : 'N/A'.padEnd(14);
    });
    const w = report.winner[op] ?? '?';
    lines.push(`| ${op.padEnd(20)}| ${cells.join('| ')}| ${w.padEnd(6)} |`);
  }

  lines.push('');
  lines.push(`Total: ${report.totalDurationMs.toFixed(0)}ms`);
  return lines.join('\n');
}

/**
 * Encode a benchmark report for URL sharing.
 */
export function encodeReport(report: BenchmarkReport): string {
  const compact = {
    i: report.id,
    t: report.timestamp,
    c: report.config,
    r: report.results.map((r) => ({
      o: r.operation,
      e: r.engine,
      a: Math.round(r.avgMs * 100) / 100,
      p: Math.round(r.p95Ms * 100) / 100,
      s: Math.round(r.opsPerSecond),
    })),
    w: report.winner,
  };
  return btoa(encodeURIComponent(JSON.stringify(compact)));
}

/**
 * Decode a benchmark report from a URL hash.
 */
export function decodeReport(encoded: string): BenchmarkReport | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const compact = JSON.parse(json) as Record<string, unknown>;
    const results = (compact.r as Record<string, unknown>[]).map((r) => ({
      operation: r.o as string,
      engine: r.e as string,
      avgMs: r.a as number,
      minMs: r.a as number,
      maxMs: r.a as number,
      p95Ms: r.p as number,
      opsPerSecond: r.s as number,
      iterations: 0,
    }));

    return {
      id: compact.i as string,
      timestamp: compact.t as number,
      config: compact.c as { documentCount: number; iterations: number },
      results,
      winner: compact.w as Record<string, string>,
      totalDurationMs: 0,
    };
  } catch {
    return null;
  }
}

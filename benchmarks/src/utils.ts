/**
 * Benchmark utilities
 */

export interface BenchmarkResult {
  name: string;
  ops: number;
  time: number;
  opsPerSec: number;
  avgTime: number;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(2)}K`;
  }
  return n.toFixed(2);
}

export function formatTime(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  if (ms >= 1) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms * 1000).toFixed(2)}µs`;
}

export function printResults(results: BenchmarkResult[]): void {
  console.log('\n' + '═'.repeat(70));
  console.log(
    '  Benchmark'.padEnd(40) +
      'ops/sec'.padStart(12) +
      'avg time'.padStart(12) +
      'runs'.padStart(8)
  );
  console.log('─'.repeat(70));

  for (const result of results) {
    console.log(
      `  ${result.name}`.padEnd(40) +
        formatNumber(result.opsPerSec).padStart(12) +
        formatTime(result.avgTime).padStart(12) +
        formatNumber(result.ops).padStart(8)
    );
  }

  console.log('═'.repeat(70) + '\n');
}

export function generateTestDoc(i: number): { name: string; email: string; age: number } {
  return {
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
  };
}

export function generateTestDocs(
  count: number
): Array<{ name: string; email: string; age: number }> {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push(generateTestDoc(i));
  }
  return docs;
}

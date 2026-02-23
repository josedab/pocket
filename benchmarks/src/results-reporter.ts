/**
 * Benchmark results reporter — formats vitest bench output as markdown
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface BenchmarkEntry {
  name: string;
  opsPerSec: number;
  margin: number;
  samples: number;
}

function formatOps(ops: number): string {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(2)}K`;
  return ops.toFixed(2);
}

/**
 * Formats benchmark entries as a markdown table.
 */
export function formatAsMarkdownTable(entries: BenchmarkEntry[]): string {
  if (entries.length === 0) return '_No benchmark results._';

  const fastest = Math.max(...entries.map((e) => e.opsPerSec));

  const lines: string[] = [
    `# Benchmark Results`,
    '',
    `_Generated on ${new Date().toISOString()}_`,
    '',
    '| Benchmark | ops/sec | Margin (±%) | Relative | Samples |',
    '|-----------|--------:|------------:|---------:|--------:|',
  ];

  for (const entry of entries) {
    const relative = entry.opsPerSec / fastest;
    const relativeStr = relative === 1 ? '**fastest**' : `${(relative * 100).toFixed(1)}%`;
    lines.push(
      `| ${entry.name} | ${formatOps(entry.opsPerSec)} | ±${entry.margin.toFixed(2)}% | ${relativeStr} | ${entry.samples} |`
    );
  }

  return lines.join('\n');
}

export interface ResultsReporter {
  /** Format entries as a markdown string */
  format(entries: BenchmarkEntry[]): string;
  /** Write formatted results to the configured output path */
  write(entries: BenchmarkEntry[]): void;
}

/**
 * Creates a results reporter that can format and optionally write benchmark
 * results to a markdown file.
 *
 * @param outputPath - File path to write results (defaults to benchmarks/results/latest.md)
 */
export function createResultsReporter(
  outputPath = 'benchmarks/results/latest.md'
): ResultsReporter {
  return {
    format(entries: BenchmarkEntry[]): string {
      return formatAsMarkdownTable(entries);
    },

    write(entries: BenchmarkEntry[]): void {
      const markdown = formatAsMarkdownTable(entries);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, markdown + '\n', 'utf-8');
      console.log(`\n📄 Results written to ${outputPath}`);
    },
  };
}

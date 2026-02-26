/**
 * Standardized Benchmark Suite — predefined benchmark scenarios
 * that can be run consistently across CI and browser environments.
 */

import { createInMemoryEngine, runBenchmarkSuite } from './harness.js';
import type { BenchmarkEngine, BenchmarkReport, BenchmarkRunConfig } from './types.js';

/** Suite presets for different scenarios. */
export type SuitePreset = 'quick' | 'standard' | 'comprehensive';

/** Suite configuration derived from preset. */
export interface SuiteConfig {
  readonly preset: SuitePreset;
  readonly documentCount: number;
  readonly iterations: number;
  readonly warmupIterations: number;
}

const PRESETS: Record<SuitePreset, Omit<SuiteConfig, 'preset'>> = {
  quick: { documentCount: 100, iterations: 20, warmupIterations: 3 },
  standard: { documentCount: 1000, iterations: 100, warmupIterations: 5 },
  comprehensive: { documentCount: 10000, iterations: 500, warmupIterations: 10 },
};

/** Get a suite configuration for a preset. */
export function getSuiteConfig(preset: SuitePreset): SuiteConfig {
  const base = PRESETS[preset];
  return { preset, ...base };
}

/** Result of running the standardized suite. */
export interface StandardizedSuiteResult {
  readonly report: BenchmarkReport;
  readonly suiteConfig: SuiteConfig;
  readonly environment: BenchmarkEnvironment;
}

/** Captured environment information for reproducibility. */
export interface BenchmarkEnvironment {
  readonly userAgent: string;
  readonly timestamp: string;
  readonly platform: string;
  readonly cores: number;
  readonly memory: string;
}

/** Detect the current benchmark environment. */
export function detectEnvironment(): BenchmarkEnvironment {
  const isBrowser = typeof window !== 'undefined';

  return {
    userAgent: isBrowser
      ? navigator.userAgent
      : `Node.js ${typeof process !== 'undefined' ? process.version : 'unknown'}`,
    timestamp: new Date().toISOString(),
    platform: isBrowser
      ? ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        'browser')
      : typeof process !== 'undefined'
        ? process.platform
        : 'unknown',
    cores: isBrowser ? navigator.hardwareConcurrency : typeof require === 'function' ? 1 : 1,
    memory: isBrowser ? 'N/A' : 'N/A',
  };
}

/**
 * Run the standardized benchmark suite with a preset configuration.
 * Includes Pocket's in-memory engine by default, additional engines can be provided.
 */
export async function runStandardizedSuite(
  preset: SuitePreset,
  additionalEngines?: readonly BenchmarkEngine[]
): Promise<StandardizedSuiteResult> {
  const suiteConfig = getSuiteConfig(preset);
  const environment = detectEnvironment();

  const engines: BenchmarkEngine[] = [createInMemoryEngine('Pocket'), ...(additionalEngines ?? [])];

  const runConfig: BenchmarkRunConfig = {
    engines,
    documentCount: suiteConfig.documentCount,
    iterations: suiteConfig.iterations,
    warmupIterations: suiteConfig.warmupIterations,
  };

  const report = await runBenchmarkSuite(runConfig);

  return { report, suiteConfig, environment };
}

/**
 * Serialize a suite result to JSON for storage/CI artifacts.
 */
export function serializeSuiteResult(result: StandardizedSuiteResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Deserialize a suite result from JSON.
 */
export function deserializeSuiteResult(json: string): StandardizedSuiteResult | null {
  try {
    return JSON.parse(json) as StandardizedSuiteResult;
  } catch {
    return null;
  }
}

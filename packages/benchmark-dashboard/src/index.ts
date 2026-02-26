export type {
  BenchmarkEngine,
  BenchmarkReport,
  BenchmarkRunConfig,
  OperationResult,
  ShareableResult,
} from './types.js';

export {
  createInMemoryEngine,
  decodeReport,
  encodeReport,
  formatReportTable,
  runBenchmarkSuite,
} from './harness.js';

export { createDexieAdapter, createGenericAdapter, createPouchDBAdapter } from './adapters.js';

// Standardized benchmark suite
export {
  deserializeSuiteResult,
  detectEnvironment,
  getSuiteConfig,
  runStandardizedSuite,
  serializeSuiteResult,
  type BenchmarkEnvironment,
  type StandardizedSuiteResult,
  type SuiteConfig,
  type SuitePreset,
} from './suite.js';

// CI runner and comparison
export {
  aggregateResults,
  compareReports,
  formatResultsJson,
  generateMarkdownSummary,
  parseResultsJson,
  processCIResult,
  type BenchmarkComparison,
  type CIRunResult,
} from './ci-runner.js';

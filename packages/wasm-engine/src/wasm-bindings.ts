/**
 * Wasm Bindings — loads and interfaces with the Rust-compiled Wasm module.
 *
 * This module handles:
 * 1. Fetching and instantiating the .wasm binary
 * 2. Marshalling data between JS and Wasm (JSON serialization)
 * 3. Providing a QueryEngine-compatible interface over the Wasm exports
 */

import type {
  AggregateResult,
  FilterCondition,
  FilterGroup,
  GroupByClause,
  QueryEngine,
  QueryPlan,
  QueryResult,
} from './types.js';

/** The Wasm module's exported functions. */
interface WasmExports {
  init(): void;
  execute_query(documents_json: string, plan_json: string): string;
  execute_aggregate(
    documents_json: string,
    group_by_json: string,
    filter_json: string | null
  ): string;
}

/**
 * Load the Wasm binary from a URL and return a QueryEngine.
 *
 * Requires `fetch` and `WebAssembly` APIs (browser or Node 18+).
 *
 * @param wasmUrl URL or path to the .wasm binary
 * @returns A QueryEngine backed by the Wasm module
 * @throws If the Wasm module fails to load or initialize
 */
export async function loadWasmModule(wasmUrl: string): Promise<QueryEngine> {
  // Dynamically detect if we have streaming compilation support
  const response = await fetch(wasmUrl);

  let wasmInstance: WebAssembly.Instance;

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    // Streaming compilation — most efficient
    const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {});
    wasmInstance = result.instance;
  } else {
    // Fallback: download and compile
    const buffer = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(buffer, {});
    wasmInstance = result.instance;
  }

  const exports = wasmInstance.exports as unknown as WasmExports;
  exports.init();

  return createWasmQueryEngine(exports);
}

/**
 * Create a QueryEngine wrapper around the Wasm exports.
 *
 * Handles JSON serialization/deserialization between JS objects
 * and the Wasm module's string-based API.
 */
function createWasmQueryEngine(exports: WasmExports): QueryEngine {
  return {
    execute<T extends Record<string, unknown>>(
      documents: readonly T[],
      plan: QueryPlan
    ): QueryResult<T> {
      const docsJson = JSON.stringify(documents);
      const planJson = JSON.stringify(plan);

      const resultJson = exports.execute_query(docsJson, planJson);
      const result = JSON.parse(resultJson) as {
        documents: T[];
        total_matched: number;
        execution_time_ms: number;
        engine: string;
      };

      return {
        documents: result.documents,
        totalMatched: result.total_matched,
        executionTimeMs: result.execution_time_ms,
        engine: 'wasm',
      };
    },

    aggregate(
      documents: readonly Record<string, unknown>[],
      groupBy: GroupByClause,
      filter?: FilterCondition | FilterGroup
    ): AggregateResult {
      const docsJson = JSON.stringify(documents);
      const groupByJson = JSON.stringify(groupBy);
      const filterJson = filter ? JSON.stringify(filter) : null;

      const resultJson = exports.execute_aggregate(docsJson, groupByJson, filterJson);
      const result = JSON.parse(resultJson) as {
        groups: Record<string, unknown>[];
        execution_time_ms: number;
        engine: string;
      };

      return {
        groups: result.groups,
        executionTimeMs: result.execution_time_ms,
        engine: 'wasm',
      };
    },
  };
}

/**
 * Check if WebAssembly is available in the current environment.
 */
export function isWasmSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';
}

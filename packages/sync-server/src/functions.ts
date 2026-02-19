/**
 * Server-side event-driven function system for Pocket sync server.
 *
 * Register functions that execute in response to data changes (insert, update, delete, sync).
 *
 * @example
 * ```typescript
 * import { createFunctionRegistry } from '@pocket/sync-server';
 *
 * const registry = createFunctionRegistry({ defaultTimeoutMs: 5000 });
 *
 * registry.register({
 *   name: 'onUserInsert',
 *   collection: 'users',
 *   trigger: 'afterInsert',
 *   enabled: true,
 *   handler: async (ctx) => {
 *     console.log(`User created: ${ctx.documentId}`);
 *   },
 * });
 *
 * const results = await registry.trigger('afterInsert', {
 *   collection: 'users',
 *   documentId: 'user-1',
 *   timestamp: Date.now(),
 * });
 * ```
 */

import { Subject, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events that can trigger a registered function. */
export type TriggerEvent = 'afterInsert' | 'afterUpdate' | 'afterDelete' | 'afterSync';

/** Context passed to a function handler when triggered. */
export interface FunctionContext {
  collection: string;
  documentId: string;
  document?: Record<string, unknown>;
  previousDocument?: Record<string, unknown>;
  userId?: string;
  timestamp: number;
}

/** A registered server-side function. */
export interface PocketFunction {
  name: string;
  collection: string;
  trigger: TriggerEvent;
  handler: (ctx: FunctionContext) => Promise<void>;
  enabled: boolean;
  timeout?: number;
}

/** Result of a single function execution. */
export interface FunctionResult {
  functionName: string;
  success: boolean;
  executionTimeMs: number;
  error?: string;
}

/** Configuration for the function registry. */
export interface FunctionRegistryConfig {
  maxFunctions?: number;
  defaultTimeoutMs?: number;
  onError?: (err: Error, fn: PocketFunction) => void;
}

/** Aggregate stats for the registry. */
export interface FunctionStats {
  totalFunctions: number;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  avgExecutionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FUNCTIONS = 100;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Function timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// FunctionRegistry
// ---------------------------------------------------------------------------

export class FunctionRegistry {
  private readonly functions = new Map<string, PocketFunction>();
  private readonly config: Required<Pick<FunctionRegistryConfig, 'maxFunctions' | 'defaultTimeoutMs'>> & {
    onError?: (err: Error, fn: PocketFunction) => void;
  };

  // Stats
  private totalExecutions = 0;
  private successCount = 0;
  private errorCount = 0;
  private totalExecutionTimeMs = 0;

  // Observable stream
  private readonly results$$ = new Subject<FunctionResult>();

  /** Observable stream of function execution results. */
  get results$(): Observable<FunctionResult> {
    return this.results$$.asObservable();
  }

  constructor(config?: FunctionRegistryConfig) {
    this.config = {
      maxFunctions: config?.maxFunctions ?? DEFAULT_MAX_FUNCTIONS,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      onError: config?.onError,
    };
  }

  /** Register a new function. Throws if name is duplicate or limit is reached. */
  register(fn: PocketFunction): void {
    if (this.functions.has(fn.name)) {
      throw new Error(`Function "${fn.name}" is already registered`);
    }
    if (this.functions.size >= this.config.maxFunctions) {
      throw new Error(`Maximum number of functions (${this.config.maxFunctions}) reached`);
    }
    this.functions.set(fn.name, { ...fn });
  }

  /** Unregister a function by name. */
  unregister(name: string): void {
    this.functions.delete(name);
  }

  /** Enable a previously registered function. */
  enable(name: string): void {
    const fn = this.functions.get(name);
    if (fn) fn.enabled = true;
  }

  /** Disable a registered function so it won't fire on trigger. */
  disable(name: string): void {
    const fn = this.functions.get(name);
    if (fn) fn.enabled = false;
  }

  /** List all registered functions. */
  list(): PocketFunction[] {
    return [...this.functions.values()];
  }

  /**
   * Trigger all enabled functions matching the given event and collection.
   * Each function runs independently — a failure in one does not stop others.
   */
  async trigger(event: TriggerEvent, context: FunctionContext): Promise<FunctionResult[]> {
    const matching = [...this.functions.values()].filter(
      (fn) => fn.enabled && fn.trigger === event && fn.collection === context.collection,
    );

    const results = await Promise.all(matching.map((fn) => this.execute(fn, context)));
    return results;
  }

  /** Get aggregate execution stats. */
  getStats(): FunctionStats {
    return {
      totalFunctions: this.functions.size,
      totalExecutions: this.totalExecutions,
      successCount: this.successCount,
      errorCount: this.errorCount,
      avgExecutionTimeMs:
        this.totalExecutions > 0 ? this.totalExecutionTimeMs / this.totalExecutions : 0,
    };
  }

  /** Clean up the registry and complete the results stream. */
  dispose(): void {
    this.functions.clear();
    this.results$$.complete();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async execute(fn: PocketFunction, ctx: FunctionContext): Promise<FunctionResult> {
    const timeoutMs = fn.timeout ?? this.config.defaultTimeoutMs;
    const start = Date.now();

    try {
      await withTimeout(fn.handler(ctx), timeoutMs);
      const executionTimeMs = Date.now() - start;

      const result: FunctionResult = { functionName: fn.name, success: true, executionTimeMs };
      this.recordResult(result);
      return result;
    } catch (err: unknown) {
      const executionTimeMs = Date.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));

      if (this.config.onError) {
        this.config.onError(error, fn);
      }

      const result: FunctionResult = {
        functionName: fn.name,
        success: false,
        executionTimeMs,
        error: error.message,
      };
      this.recordResult(result);
      return result;
    }
  }

  private recordResult(result: FunctionResult): void {
    this.totalExecutions++;
    this.totalExecutionTimeMs += result.executionTimeMs;
    if (result.success) {
      this.successCount++;
    } else {
      this.errorCount++;
    }
    this.results$$.next(result);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a new {@link FunctionRegistry} instance. */
export function createFunctionRegistry(config?: FunctionRegistryConfig): FunctionRegistry {
  return new FunctionRegistry(config);
}

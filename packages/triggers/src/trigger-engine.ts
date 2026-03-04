import type { Document } from '@pocket/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import type {
  BeforeTriggerResult,
  DeadLetterEntry,
  TriggerContext,
  TriggerDefinition,
  TriggerEngineConfig,
  TriggerEngineState,
  TriggerEvent,
  TriggerExecutionLog,
  TriggerHandler,
  TriggerOperation,
} from './types.js';

const DEFAULT_CONFIG: Required<TriggerEngineConfig> = {
  maxConcurrentExecutions: 10,
  defaultTimeoutMs: 30_000,
  maxRetries: 3,
  maxTriggerDepth: 8,
  enableLogging: true,
  logRetentionCount: 1000,
  deadLetterQueueSize: 100,
};

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

export class TriggerEngine {
  private readonly config: Required<TriggerEngineConfig>;
  private readonly triggers = new Map<string, TriggerDefinition>();
  private readonly logs: TriggerExecutionLog[] = [];
  private readonly deadLetterQueue: DeadLetterEntry[] = [];
  private readonly state$$ = new BehaviorSubject<TriggerEngineState>(this.buildState());
  private readonly events$$ = new Subject<TriggerEvent>();
  private executionDepth = 0;
  private activeExecutions = 0;
  private executionCount = 0;
  private errorCount = 0;
  private destroyed = false;

  constructor(config: TriggerEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  register<T extends Document = Document>(
    definition: Omit<TriggerDefinition<T>, 'id' | 'enabled'> & { id?: string },
  ): string {
    this.ensureNotDestroyed();
    const id = definition.id ?? generateId('trigger');
    const trigger: TriggerDefinition<T> = {
      ...definition,
      id,
      enabled: true,
    };
    this.triggers.set(id, trigger as unknown as TriggerDefinition);
    this.emitEvent('trigger_registered', { triggerId: id, name: trigger.name });
    this.emitState();
    return id;
  }

  on<T extends Document = Document>(
    collection: string,
    operation: TriggerOperation | TriggerOperation[],
    handler: TriggerHandler<T>,
    options: Partial<Omit<TriggerDefinition<T>, 'id' | 'collection' | 'operations' | 'handler'>> = {},
  ): string {
    const operations = Array.isArray(operation) ? operation : [operation];
    return this.register<T>({
      name: options.name ?? `${collection}:${operations.join(',')}`,
      collection,
      operations,
      timing: options.timing ?? 'after',
      handler,
      priority: options.priority ?? 0,
      executionEnv: options.executionEnv ?? 'local',
      ...options,
    });
  }

  remove(triggerId: string): void {
    this.ensureNotDestroyed();
    if (this.triggers.delete(triggerId)) {
      this.emitEvent('trigger_removed', { triggerId });
      this.emitState();
    }
  }

  enable(triggerId: string): void {
    this.ensureNotDestroyed();
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.enabled = true;
      this.emitEvent('trigger_enabled', { triggerId });
      this.emitState();
    }
  }

  disable(triggerId: string): void {
    this.ensureNotDestroyed();
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.enabled = false;
      this.emitEvent('trigger_disabled', { triggerId });
      this.emitState();
    }
  }

  getTrigger(id: string): TriggerDefinition | null {
    return this.triggers.get(id) ?? null;
  }

  getTriggers(collection?: string): TriggerDefinition[] {
    const all = Array.from(this.triggers.values());
    return collection ? all.filter((t) => t.collection === collection) : all;
  }

  async execute(
    collection: string,
    operation: TriggerOperation,
    document: Document | null,
    previousDocument: Document | null = null,
  ): Promise<{
    results: TriggerExecutionLog[];
    cancelled: boolean;
    modifiedDocument?: Document;
  }> {
    this.ensureNotDestroyed();

    // Cycle / recursion protection
    this.executionDepth++;
    if (this.executionDepth > this.config.maxTriggerDepth) {
      this.executionDepth--;
      this.emitEvent('cycle_detected', { collection, operation, depth: this.executionDepth + 1 });
      throw new Error(
        `Maximum trigger depth (${this.config.maxTriggerDepth}) exceeded – possible cycle detected`,
      );
    }

    try {
      const matching = this.findMatchingTriggers(collection, operation);
      const results: TriggerExecutionLog[] = [];
      let cancelled = false;
      let currentDoc = document;

      // Execute 'before' triggers
      const beforeTriggers = matching.filter((t) => t.timing === 'before');
      for (const trigger of beforeTriggers) {
        if (cancelled) break;
        const log = await this.executeTrigger(trigger, collection, operation, currentDoc, previousDocument);
        results.push(log);
        if (log.status === 'success' || log.status === 'cancelled') {
          const result = (log as TriggerExecutionLog & { _result?: BeforeTriggerResult }).
            _result;
          if (result?.cancel) {
            cancelled = true;
          }
          if (result?.modifiedDocument) {
            currentDoc = result.modifiedDocument;
          }
        }
      }

      // Execute 'after' triggers only if not cancelled
      if (!cancelled) {
        const afterTriggers = matching.filter((t) => t.timing === 'after');
        for (const trigger of afterTriggers) {
          const log = await this.executeTrigger(trigger, collection, operation, currentDoc, previousDocument);
          results.push(log);
        }
      }

      return {
        results,
        cancelled,
        ...(currentDoc !== document ? { modifiedDocument: currentDoc ?? undefined } : {}),
      };
    } finally {
      this.executionDepth--;
    }
  }

  getExecutionLogs(options: {
    triggerId?: string;
    collection?: string;
    limit?: number;
  } = {}): TriggerExecutionLog[] {
    let filtered = this.logs.slice();
    if (options.triggerId) {
      filtered = filtered.filter((l) => l.triggerId === options.triggerId);
    }
    if (options.collection) {
      filtered = filtered.filter((l) => l.collection === options.collection);
    }
    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }
    return filtered;
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  async retryDeadLetter(entryId: string): Promise<boolean> {
    this.ensureNotDestroyed();
    const idx = this.deadLetterQueue.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;

    const entry = this.deadLetterQueue[idx]!;
    const trigger = this.triggers.get(entry.triggerId);
    if (!trigger) return false;

    try {
      const context = entry.payload as TriggerContext;
      await trigger.handler(context);
      this.deadLetterQueue.splice(idx, 1);
      this.emitState();
      return true;
    } catch {
      entry.attempts++;
      entry.lastAttemptAt = Date.now();
      return false;
    }
  }

  clearDeadLetterQueue(): void {
    this.deadLetterQueue.length = 0;
    this.emitState();
  }

  clearLogs(): void {
    this.logs.length = 0;
  }

  get events(): Observable<TriggerEvent> {
    return this.events$$.asObservable();
  }

  get state(): Observable<TriggerEngineState> {
    return this.state$$.asObservable();
  }

  get state$(): Observable<TriggerEngineState> {
    return this.state$$.asObservable();
  }

  destroy(): void {
    this.destroyed = true;
    this.triggers.clear();
    this.logs.length = 0;
    this.deadLetterQueue.length = 0;
    this.state$$.complete();
    this.events$$.complete();
  }

  // ── Private helpers ──────────────────────────────────────────────

  private findMatchingTriggers(collection: string, operation: TriggerOperation): TriggerDefinition[] {
    return Array.from(this.triggers.values())
      .filter(
        (t) =>
          t.enabled &&
          t.collection === collection &&
          t.operations.includes(operation),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  private async executeTrigger(
    trigger: TriggerDefinition,
    collection: string,
    operation: TriggerOperation,
    document: Document | null,
    previousDocument: Document | null,
  ): Promise<TriggerExecutionLog> {
    const logId = generateId('log');
    const start = Date.now();
    this.activeExecutions++;
    this.executionCount++;
    this.emitEvent('execution_started', { triggerId: trigger.id, logId });
    this.emitState();

    // Condition check
    if (trigger.condition && document) {
      if (!trigger.condition(document)) {
        this.activeExecutions--;
        const log: TriggerExecutionLog = {
          id: logId,
          triggerId: trigger.id,
          collection,
          operation,
          timing: trigger.timing,
          status: 'cancelled',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          documentId: document?._id,
          retryCount: 0,
        };
        this.addLog(log);
        this.emitState();
        return log;
      }
    }

    const context: TriggerContext = {
      collection,
      operation,
      timing: trigger.timing,
      document,
      previousDocument,
      timestamp: Date.now(),
      triggerId: trigger.id,
      metadata: {},
    };

    const timeoutMs = trigger.timeoutMs ?? this.config.defaultTimeoutMs;
    const maxRetries = trigger.maxRetries ?? this.config.maxRetries;
    let retryCount = 0;
    let lastError: string | undefined;

    while (retryCount <= maxRetries) {
      try {
        const resultPromise = Promise.resolve(trigger.handler(context));
        const result = await Promise.race([
          resultPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Trigger execution timed out')), timeoutMs),
          ),
        ]);

        this.activeExecutions--;
        const status = result && (result as BeforeTriggerResult).cancel ? 'cancelled' : 'success';
        const log: TriggerExecutionLog & { _result?: BeforeTriggerResult } = {
          id: logId,
          triggerId: trigger.id,
          collection,
          operation,
          timing: trigger.timing,
          status,
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          documentId: document?._id,
          retryCount,
          _result: result as BeforeTriggerResult | undefined,
        };
        this.addLog(log);
        this.emitEvent('execution_completed', { triggerId: trigger.id, logId, status });
        this.emitState();
        return log;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retryCount++;
        if (retryCount <= maxRetries) {
          // Small back-off between retries
          await new Promise((r) => setTimeout(r, retryCount * 50));
        }
      }
    }

    // All retries exhausted
    this.activeExecutions--;
    this.errorCount++;
    const isTimeout = lastError?.includes('timed out');
    const log: TriggerExecutionLog = {
      id: logId,
      triggerId: trigger.id,
      collection,
      operation,
      timing: trigger.timing,
      status: isTimeout ? 'timeout' : 'error',
      executionTimeMs: Date.now() - start,
      timestamp: Date.now(),
      error: lastError,
      documentId: document?._id,
      retryCount: retryCount - 1,
    };
    this.addLog(log);
    this.addDeadLetter(trigger.id, context, lastError ?? 'Unknown error', retryCount - 1);
    this.emitEvent('execution_failed', { triggerId: trigger.id, logId, error: lastError });
    this.emitState();
    return log;
  }

  private addLog(log: TriggerExecutionLog): void {
    if (!this.config.enableLogging) return;
    this.logs.push(log);
    while (this.logs.length > this.config.logRetentionCount) {
      this.logs.shift();
    }
  }

  private addDeadLetter(triggerId: string, payload: unknown, error: string, attempts: number): void {
    const entry: DeadLetterEntry = {
      id: generateId('dlq'),
      triggerId,
      payload,
      error,
      attempts,
      createdAt: Date.now(),
      lastAttemptAt: Date.now(),
    };
    this.deadLetterQueue.push(entry);
    while (this.deadLetterQueue.length > this.config.deadLetterQueueSize) {
      this.deadLetterQueue.shift();
    }
    this.emitEvent('dead_letter_added', { entryId: entry.id, triggerId });
  }

  private buildState(): TriggerEngineState {
    const triggers = Array.from(this.triggers.values());
    return {
      totalTriggers: triggers.length,
      activeTriggers: triggers.filter((t) => t.enabled).length,
      executionCount: this.executionCount,
      errorCount: this.errorCount,
      activeExecutions: this.activeExecutions,
      deadLetterCount: this.deadLetterQueue.length,
    };
  }

  private emitState(): void {
    if (!this.destroyed) {
      this.state$$.next(this.buildState());
    }
  }

  private emitEvent(type: TriggerEvent['type'], data: Record<string, unknown>): void {
    if (!this.destroyed) {
      this.events$$.next({ type, timestamp: Date.now(), data });
    }
  }

  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('TriggerEngine has been destroyed');
    }
  }
}

export function createTriggerEngine(config?: TriggerEngineConfig): TriggerEngine {
  return new TriggerEngine(config);
}

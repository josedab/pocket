import type { Document } from '@pocket/core';

/** Trigger timing */
export type TriggerTiming = 'before' | 'after';

/** Trigger operation */
export type TriggerOperation = 'insert' | 'update' | 'delete';

/** Trigger execution environment */
export type TriggerExecutionEnv = 'local' | 'worker' | 'remote';

/** Trigger handler context */
export interface TriggerContext<T extends Document = Document> {
  collection: string;
  operation: TriggerOperation;
  timing: TriggerTiming;
  document: T | null;
  previousDocument: T | null;
  timestamp: number;
  triggerId: string;
  metadata: Record<string, unknown>;
}

/** Trigger handler result for 'before' triggers */
export interface BeforeTriggerResult<T extends Document = Document> {
  cancel?: boolean;
  modifiedDocument?: T;
  error?: string;
}

/** Trigger handler function */
export type TriggerHandler<T extends Document = Document> =
  (context: TriggerContext<T>) => Promise<BeforeTriggerResult<T> | void> | BeforeTriggerResult<T> | void;

/** Trigger definition */
export interface TriggerDefinition<T extends Document = Document> {
  id: string;
  name: string;
  collection: string;
  operations: TriggerOperation[];
  timing: TriggerTiming;
  handler: TriggerHandler<T>;
  enabled: boolean;
  priority: number;
  executionEnv: TriggerExecutionEnv;
  maxRetries?: number;
  timeoutMs?: number;
  description?: string;
  condition?: (doc: T) => boolean;
}

/** Remote trigger / webhook configuration */
export interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers?: Record<string, string>;
  batchSize?: number;
  batchIntervalMs?: number;
  retries?: number;
  retryDelayMs?: number;
  deadLetterQueue?: boolean;
  authHeader?: string;
}

/** Trigger execution log entry */
export interface TriggerExecutionLog {
  id: string;
  triggerId: string;
  collection: string;
  operation: TriggerOperation;
  timing: TriggerTiming;
  status: 'success' | 'error' | 'cancelled' | 'timeout';
  executionTimeMs: number;
  timestamp: number;
  error?: string;
  documentId?: string;
  retryCount: number;
}

/** Dead letter queue entry */
export interface DeadLetterEntry {
  id: string;
  triggerId: string;
  payload: unknown;
  error: string;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number;
}

/** Trigger engine configuration */
export interface TriggerEngineConfig {
  maxConcurrentExecutions?: number;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  maxTriggerDepth?: number;
  enableLogging?: boolean;
  logRetentionCount?: number;
  deadLetterQueueSize?: number;
}

/** Trigger engine event types */
export type TriggerEventType =
  | 'trigger_registered' | 'trigger_removed' | 'trigger_enabled' | 'trigger_disabled'
  | 'execution_started' | 'execution_completed' | 'execution_failed'
  | 'cycle_detected' | 'dead_letter_added';

/** Trigger engine event */
export interface TriggerEvent {
  type: TriggerEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Trigger engine state */
export interface TriggerEngineState {
  totalTriggers: number;
  activeTriggers: number;
  executionCount: number;
  errorCount: number;
  activeExecutions: number;
  deadLetterCount: number;
}

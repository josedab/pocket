/**
 * Scheduled Task Runner — executes AI tasks on a configurable schedule.
 *
 * Enables autonomous document processing, summarization, classification,
 * and other AI-driven tasks that run periodically or on-demand.
 */

import { BehaviorSubject, Subject } from 'rxjs';
import type { LLMProvider, Tool } from './types.js';

/** A scheduled AI task definition. */
export interface ScheduledTask {
  readonly id: string;
  readonly name: string;
  /** Cron-like interval description or milliseconds between runs. */
  readonly intervalMs: number;
  /** The prompt template to execute. Use {{collection}} for dynamic substitution. */
  readonly prompt: string;
  /** Tools available to this task. */
  readonly tools?: readonly Tool[];
  /** Maximum execution time before timeout (ms). Defaults to 30000. */
  readonly timeoutMs?: number;
  /** Whether the task is currently enabled. */
  readonly enabled?: boolean;
}

/** Result of a scheduled task execution. */
export interface TaskExecutionResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly toolCallCount: number;
}

/** Task runner status. */
export interface TaskRunnerStatus {
  readonly running: boolean;
  readonly activeTasks: number;
  readonly totalExecutions: number;
  readonly lastExecution?: TaskExecutionResult;
}

/** Task runner event. */
export interface TaskRunnerEvent {
  readonly type:
    | 'task-started'
    | 'task-completed'
    | 'task-failed'
    | 'runner-started'
    | 'runner-stopped';
  readonly taskId?: string;
  readonly timestamp: number;
  readonly result?: TaskExecutionResult;
}

export class ScheduledTaskRunner {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly history: TaskExecutionResult[] = [];
  private readonly status$: BehaviorSubject<TaskRunnerStatus>;
  private readonly events$ = new Subject<TaskRunnerEvent>();
  private running = false;
  private totalExecutions = 0;

  constructor(private readonly provider: LLMProvider) {
    this.status$ = new BehaviorSubject<TaskRunnerStatus>(this.buildStatus());
  }

  /** Register a task for scheduled execution. */
  registerTask(task: ScheduledTask): void {
    this.tasks.set(task.id, { ...task, enabled: task.enabled ?? true });
    if (this.running && task.enabled !== false) {
      this.scheduleTask(task);
    }
  }

  /** Remove a registered task. */
  unregisterTask(taskId: string): void {
    this.tasks.delete(taskId);
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
  }

  /** Start the task runner, scheduling all enabled tasks. */
  start(): void {
    if (this.running) return;
    this.running = true;

    for (const task of this.tasks.values()) {
      if (task.enabled !== false) {
        this.scheduleTask(task);
      }
    }

    this.emitEvent({ type: 'runner-started', timestamp: Date.now() });
    this.emitStatus();
  }

  /** Stop the task runner and clear all scheduled timers. */
  stop(): void {
    this.running = false;
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    this.emitEvent({ type: 'runner-stopped', timestamp: Date.now() });
    this.emitStatus();
  }

  /** Execute a task immediately (on-demand). */
  async executeNow(taskId: string): Promise<TaskExecutionResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        taskId,
        success: false,
        error: `Task ${taskId} not found`,
        durationMs: 0,
        timestamp: Date.now(),
        toolCallCount: 0,
      };
    }
    return this.runTask(task);
  }

  /** Get execution history for a task. */
  getHistory(taskId?: string): readonly TaskExecutionResult[] {
    if (taskId) {
      return this.history.filter((h) => h.taskId === taskId);
    }
    return this.history;
  }

  /** Observable of runner status. */
  get status() {
    return this.status$.asObservable();
  }

  /** Observable of runner events. */
  get events() {
    return this.events$.asObservable();
  }

  /** Shut down and clean up. */
  destroy(): void {
    this.stop();
    this.status$.complete();
    this.events$.complete();
  }

  private scheduleTask(task: ScheduledTask): void {
    if (this.timers.has(task.id)) return;

    const timer = setInterval(() => {
      void this.runTask(task);
    }, task.intervalMs);
    this.timers.set(task.id, timer);
  }

  private async runTask(task: ScheduledTask): Promise<TaskExecutionResult> {
    const start = Date.now();
    this.emitEvent({ type: 'task-started', taskId: task.id, timestamp: start });

    try {
      const toolSchemas = (task.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
          ),
          required: t.parameters.filter((p) => p.required).map((p) => p.name),
        },
      }));

      const response = await this.provider.complete(
        [
          {
            role: 'system',
            content: 'You are an AI assistant executing a scheduled database task.',
          },
          { role: 'user', content: task.prompt },
        ],
        {
          tools: toolSchemas,
          maxTokens: 1000,
        }
      );

      const result: TaskExecutionResult = {
        taskId: task.id,
        success: true,
        output: response.content,
        durationMs: Date.now() - start,
        timestamp: start,
        toolCallCount: response.toolCalls?.length ?? 0,
      };

      this.history.push(result);
      this.totalExecutions++;
      this.emitEvent({ type: 'task-completed', taskId: task.id, timestamp: Date.now(), result });
      this.emitStatus();
      return result;
    } catch (err) {
      const result: TaskExecutionResult = {
        taskId: task.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        timestamp: start,
        toolCallCount: 0,
      };

      this.history.push(result);
      this.totalExecutions++;
      this.emitEvent({ type: 'task-failed', taskId: task.id, timestamp: Date.now(), result });
      this.emitStatus();
      return result;
    }
  }

  private buildStatus(): TaskRunnerStatus {
    return {
      running: this.running,
      activeTasks: this.timers.size,
      totalExecutions: this.totalExecutions,
      lastExecution: this.history[this.history.length - 1],
    };
  }

  private emitStatus(): void {
    this.status$.next(this.buildStatus());
  }

  private emitEvent(event: TaskRunnerEvent): void {
    this.events$.next(event);
  }
}

export function createScheduledTaskRunner(provider: LLMProvider): ScheduledTaskRunner {
  return new ScheduledTaskRunner(provider);
}

/**
 * REPL Engine — Interactive Read-Eval-Print Loop for Pocket.
 *
 * Provides session management, command history, multi-line editing,
 * and database context for live code execution in the browser.
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import type { CodeExecutor } from './executor.js';
import { createCodeExecutor } from './executor.js';
import type { OutputLine } from './types.js';

/** A single REPL entry (input + output pair). */
export interface ReplEntry {
  readonly id: string;
  readonly code: string;
  readonly output: OutputLine[];
  readonly error: string | null;
  readonly executionTimeMs: number;
  readonly timestamp: number;
}

/** Current REPL session state. */
export interface ReplState {
  readonly entries: ReplEntry[];
  readonly isExecuting: boolean;
  readonly currentInput: string;
  readonly historyIndex: number;
  readonly sessionId: string;
  readonly variables: Record<string, unknown>;
}

/** Configuration for the REPL. */
export interface ReplConfig {
  readonly timeoutMs?: number;
  readonly maxOutputLines?: number;
  readonly maxHistory?: number;
  readonly persistSession?: boolean;
  /** Pre-loaded context variables available in every execution. */
  readonly context?: Record<string, unknown>;
}

/** REPL session interface. */
export interface ReplSession {
  execute(code: string): Promise<ReplEntry>;
  setInput(input: string): void;
  historyUp(): string;
  historyDown(): string;
  clearEntries(): void;
  reset(): void;
  getCompletions(partial: string): string[];
  readonly state$: Observable<ReplState>;
  readonly state: ReplState;
  destroy(): void;
}

let entryCounter = 0;

export function createReplSession(config?: ReplConfig): ReplSession {
  const maxHistory = config?.maxHistory ?? 200;
  const sessionId = `repl-${Date.now().toString(36)}`;
  const executor: CodeExecutor = createCodeExecutor({
    timeoutMs: config?.timeoutMs ?? 10000,
    maxOutputLines: config?.maxOutputLines ?? 500,
  });

  const sharedContext: Record<string, unknown> = { ...(config?.context ?? {}) };
  const commandHistory: string[] = [];

  const stateSubject = new BehaviorSubject<ReplState>({
    entries: [],
    isExecuting: false,
    currentInput: '',
    historyIndex: -1,
    sessionId,
    variables: { ...sharedContext },
  });

  function updateState(partial: Partial<ReplState>): void {
    stateSubject.next({ ...stateSubject.getValue(), ...partial });
  }

  async function execute(code: string): Promise<ReplEntry> {
    const trimmed = code.trim();
    if (!trimmed) {
      const emptyEntry: ReplEntry = {
        id: `entry-${++entryCounter}`,
        code: '',
        output: [],
        error: null,
        executionTimeMs: 0,
        timestamp: Date.now(),
      };
      return emptyEntry;
    }

    // Add to history (dedup consecutive identical entries)
    if (commandHistory[commandHistory.length - 1] !== trimmed) {
      commandHistory.push(trimmed);
      if (commandHistory.length > maxHistory) {
        commandHistory.shift();
      }
    }

    updateState({ isExecuting: true, historyIndex: -1 });

    const result = await executor.execute(trimmed, sharedContext);

    // Capture any assigned variables for the next execution context
    if (result.returnValue !== undefined) {
      sharedContext._ = result.returnValue;
    }

    const entry: ReplEntry = {
      id: `entry-${++entryCounter}`,
      code: trimmed,
      output: result.output,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
      timestamp: Date.now(),
    };

    const current = stateSubject.getValue();
    const entries = [...current.entries, entry];

    updateState({
      entries,
      isExecuting: false,
      currentInput: '',
      variables: { ...sharedContext },
    });

    return entry;
  }

  function setInput(input: string): void {
    updateState({ currentInput: input, historyIndex: -1 });
  }

  function historyUp(): string {
    if (commandHistory.length === 0) return stateSubject.getValue().currentInput;

    const current = stateSubject.getValue();
    const newIndex =
      current.historyIndex === -1
        ? commandHistory.length - 1
        : Math.max(0, current.historyIndex - 1);

    const code = commandHistory[newIndex] ?? '';
    updateState({ historyIndex: newIndex, currentInput: code });
    return code;
  }

  function historyDown(): string {
    const current = stateSubject.getValue();
    if (current.historyIndex === -1) return current.currentInput;

    const newIndex = current.historyIndex + 1;
    if (newIndex >= commandHistory.length) {
      updateState({ historyIndex: -1, currentInput: '' });
      return '';
    }

    const code = commandHistory[newIndex] ?? '';
    updateState({ historyIndex: newIndex, currentInput: code });
    return code;
  }

  function clearEntries(): void {
    updateState({ entries: [] });
  }

  function reset(): void {
    for (const key of Object.keys(sharedContext)) {
      if (config?.context && key in config.context) continue;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete sharedContext[key];
    }
    commandHistory.length = 0;
    updateState({
      entries: [],
      isExecuting: false,
      currentInput: '',
      historyIndex: -1,
      variables: { ...sharedContext },
    });
  }

  function getCompletions(partial: string): string[] {
    const builtins = [
      'console.log',
      'JSON.stringify',
      'JSON.parse',
      'Object.keys',
      'Object.values',
      'Object.entries',
      'Array.from',
      'Array.isArray',
      'Map',
      'Set',
      'Promise',
      'Math.round',
      'Math.floor',
      'Math.ceil',
      'Math.random',
    ];

    const contextKeys = Object.keys(sharedContext);
    const all = [...builtins, ...contextKeys];

    const lower = partial.toLowerCase();
    return all.filter((item) => item.toLowerCase().startsWith(lower)).slice(0, 20);
  }

  function destroy(): void {
    stateSubject.complete();
  }

  return {
    execute,
    setInput,
    historyUp,
    historyDown,
    clearEntries,
    reset,
    getCompletions,
    state$: stateSubject.asObservable(),
    get state() {
      return stateSubject.getValue();
    },
    destroy,
  };
}

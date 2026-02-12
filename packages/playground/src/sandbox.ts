/**
 * @module @pocket/playground/sandbox
 *
 * Playground sandbox that manages state, code execution, and
 * output history. Provides an Observable-based reactive API.
 *
 * @example
 * ```typescript
 * const sandbox = createPlaygroundSandbox({ timeoutMs: 5000 });
 * sandbox.state$.subscribe(state => renderUI(state));
 * await sandbox.run('console.log("Hello Pocket!")');
 * ```
 */
import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import type { CodeExecutor, SyntaxValidation } from './executor.js';
import { createCodeExecutor } from './executor.js';
import type { PlaygroundState } from './types.js';

export interface PlaygroundSandboxConfig {
  timeoutMs?: number;
  maxOutputLines?: number;
  maxHistory?: number;
  initialCode?: string;
}

export interface PlaygroundSandbox {
  run(code?: string): Promise<void>;
  setCode(code: string): void;
  getCode(): string;
  clearOutput(): void;
  validateSyntax(): SyntaxValidation;
  getHistory(): string[];
  readonly state$: Observable<PlaygroundState>;
  readonly state: PlaygroundState;
  destroy(): void;
}

export function createPlaygroundSandbox(config?: PlaygroundSandboxConfig): PlaygroundSandbox {
  const maxHistory = config?.maxHistory ?? 50;
  const executor: CodeExecutor = createCodeExecutor({
    timeoutMs: config?.timeoutMs,
    maxOutputLines: config?.maxOutputLines,
  });

  let currentCode = config?.initialCode ?? '';
  const history: string[] = [];

  const stateSubject = new BehaviorSubject<PlaygroundState>({
    code: currentCode,
    output: [],
    isRunning: false,
    error: null,
    executionTimeMs: 0,
    lastRunAt: null,
  });

  function updateState(partial: Partial<PlaygroundState>): void {
    stateSubject.next({ ...stateSubject.getValue(), ...partial });
  }

  async function run(code?: string): Promise<void> {
    const codeToRun = code ?? currentCode;
    if (code !== undefined) {
      currentCode = code;
    }

    // Add to history
    if (codeToRun.trim()) {
      history.push(codeToRun);
      if (history.length > maxHistory) {
        history.shift();
      }
    }

    updateState({ isRunning: true, error: null, code: codeToRun });

    const result = await executor.execute(codeToRun);

    updateState({
      isRunning: false,
      output: result.output.map((o) => o.content),
      error: result.error,
      executionTimeMs: result.executionTimeMs,
      lastRunAt: Date.now(),
    });
  }

  function setCode(code: string): void {
    currentCode = code;
    updateState({ code });
  }

  function getCode(): string {
    return currentCode;
  }

  function clearOutput(): void {
    updateState({ output: [], error: null });
  }

  function validateSyntax(): SyntaxValidation {
    return executor.validateSyntax(currentCode);
  }

  function getHistory(): string[] {
    return [...history];
  }

  function destroy(): void {
    stateSubject.complete();
  }

  return {
    run,
    setCode,
    getCode,
    clearOutput,
    validateSyntax,
    getHistory,
    state$: stateSubject.asObservable(),
    get state() {
      return stateSubject.getValue();
    },
    destroy,
  };
}

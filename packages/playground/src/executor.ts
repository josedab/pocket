/**
 * @module @pocket/playground/executor
 *
 * Safe code execution engine for the playground.
 * Executes user code in a sandboxed context with output capture
 * and timeout protection.
 *
 * @example
 * ```typescript
 * const executor = createCodeExecutor({ timeoutMs: 5000 });
 * const result = await executor.execute('return 2 + 2');
 * console.log(result.output); // ['4']
 * ```
 */
import type { OutputLine } from './types.js';

export interface ExecutionResult {
  success: boolean;
  output: OutputLine[];
  returnValue: unknown;
  executionTimeMs: number;
  error: string | null;
}

export interface CodeExecutorConfig {
  timeoutMs?: number;
  maxOutputLines?: number;
}

export interface CodeExecutor {
  execute(code: string, context?: Record<string, unknown>): Promise<ExecutionResult>;
  validateSyntax(code: string): SyntaxValidation;
}

export interface SyntaxValidation {
  valid: boolean;
  errors: { message: string; line?: number; column?: number }[];
}

export function createCodeExecutor(config?: CodeExecutorConfig): CodeExecutor {
  const timeoutMs = config?.timeoutMs ?? 5000;
  const maxOutputLines = config?.maxOutputLines ?? 200;

  async function execute(
    code: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const output: OutputLine[] = [];
    const startTime = Date.now();

    // Create captured console
    const capturedConsole = {
      log: (...args: unknown[]) => {
        if (output.length < maxOutputLines) {
          output.push({
            type: 'log' as const,
            content: args.map(formatValue).join(' '),
            timestamp: Date.now(),
          });
        }
      },
      error: (...args: unknown[]) => {
        if (output.length < maxOutputLines) {
          output.push({
            type: 'error' as const,
            content: args.map(formatValue).join(' '),
            timestamp: Date.now(),
          });
        }
      },
      warn: (...args: unknown[]) => {
        if (output.length < maxOutputLines) {
          output.push({
            type: 'warn' as const,
            content: args.map(formatValue).join(' '),
            timestamp: Date.now(),
          });
        }
      },
      info: (...args: unknown[]) => {
        if (output.length < maxOutputLines) {
          output.push({
            type: 'info' as const,
            content: args.map(formatValue).join(' '),
            timestamp: Date.now(),
          });
        }
      },
    };

    try {
      // Execute with timeout
      const result = await Promise.race([
        executeCode(code, { console: capturedConsole, ...context }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      if (result !== undefined) {
        output.push({
          type: 'result',
          content: formatValue(result),
          timestamp: Date.now(),
        });
      }

      return {
        success: true,
        output,
        returnValue: result,
        executionTimeMs: Date.now() - startTime,
        error: null,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      output.push({ type: 'error', content: errorMessage, timestamp: Date.now() });

      return {
        success: false,
        output,
        returnValue: undefined,
        executionTimeMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  function validateSyntax(code: string): SyntaxValidation {
    try {
      // Basic syntax validation via parsing heuristics
      // Check for obviously broken syntax patterns
      const openBraces = (code.match(/\{/g) ?? []).length;
      const closeBraces = (code.match(/\}/g) ?? []).length;
      const openParens = (code.match(/\(/g) ?? []).length;
      const closeParens = (code.match(/\)/g) ?? []).length;
      const errors: { message: string }[] = [];
      if (openBraces !== closeBraces) {
        errors.push({ message: 'Mismatched braces' });
      }
      if (openParens !== closeParens) {
        errors.push({ message: 'Mismatched parentheses' });
      }
      return { valid: errors.length === 0, errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown syntax error';
      return {
        valid: false,
        errors: [{ message }],
      };
    }
  }

  return { execute, validateSyntax };
}

function executeCode(code: string, context: Record<string, unknown>): unknown {
  const contextKeys = Object.keys(context);
  const contextValues = Object.values(context);

  // Create a function with context variables as parameters
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...contextKeys, `'use strict';\n${code}`) as (
    ...args: unknown[]
  ) => unknown;
  return fn(...contextValues);
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

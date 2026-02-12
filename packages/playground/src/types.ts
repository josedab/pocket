/**
 * Types for the Pocket Playground.
 */

export interface PlaygroundState {
  code: string;
  output: string[];
  isRunning: boolean;
  error: string | null;
  executionTimeMs: number;
  lastRunAt: number | null;
}

export interface PlaygroundTheme {
  name: 'light' | 'dark' | 'auto';
  fontFamily?: string;
  fontSize?: number;
}

export interface PlaygroundFeatures {
  autoRun: boolean;
  showOutput: boolean;
  showTimings: boolean;
  readOnly: boolean;
  maxExecutionTimeMs: number;
}

export interface OutputLine {
  type: 'log' | 'error' | 'warn' | 'result' | 'info';
  content: string;
  timestamp: number;
}

/**
 * @module @pocket/playground
 *
 * Interactive browser-based sandbox for Pocket database.
 * Provides a code execution environment, example templates,
 * and embeddable playground component for documentation.
 */
export { createPlaygroundConfig } from './config.js';
export type { EmbedConfig, PlaygroundConfig } from './config.js';
export { createCodeExecutor } from './executor.js';
export type { CodeExecutor, ExecutionResult } from './executor.js';
export { createPlaygroundSandbox } from './sandbox.js';
export type { PlaygroundSandbox } from './sandbox.js';
export { createExampleTemplates, getTemplateByName } from './templates.js';
export type { PlaygroundTemplate } from './templates.js';
export type * from './types.js';

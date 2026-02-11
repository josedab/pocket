/**
 * @module @pocket/ai-agent
 *
 * Local AI agent framework for Pocket database. Provides an agent loop
 * with tool-calling, streaming responses, and built-in database tools
 * for autonomous data querying and transformation.
 *
 * @example
 * ```typescript
 * import { createAgent, createDatabaseTools } from '@pocket/ai-agent';
 *
 * const agent = createAgent({
 *   tools: createDatabaseTools(db),
 *   provider: myLLMProvider,
 * });
 *
 * const response = await agent.run('Find all incomplete todos');
 * ```
 */

// Types
export type {
  Agent,
  AgentConfig,
  AgentContext,
  AgentEvent,
  AgentResponse,
  AgentStep,
  ConversationMemory,
  ConversationMessage,
  LLMProvider,
  LLMResponse,
  StreamChunk,
  Tool,
  ToolCall,
  ToolParameter,
  ToolResult,
  ToolSchema,
} from './types.js';

// Core
export { createAgent } from './agent.js';
export { createConversationMemory } from './conversation-memory.js';
export { createDatabaseTools } from './database-tools.js';
export { createToolRegistry } from './tool-registry.js';

// Data transformation tools
export { createDataTransformationTools } from './data-tools.js';
export type { DataTransformationConfig } from './data-tools.js';

// Execution planner
export { createExecutionPlanner } from './planner.js';
export type { ExecutionPlan, ExecutionPlanner, ExecutionStep, PlanSummary } from './planner.js';

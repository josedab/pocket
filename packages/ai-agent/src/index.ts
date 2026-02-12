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
  ConversationMessage,
  ConversationMemory,
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
export { createDatabaseTools } from './database-tools.js';
export { createConversationMemory } from './conversation-memory.js';
export { createToolRegistry } from './tool-registry.js';

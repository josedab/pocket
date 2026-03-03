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

// Offline agent
export { OfflineAgent, createOfflineAgent } from './offline-agent.js';
export type {
  AgentQuery,
  CollectionContext,
  CollectionFieldDescriptor,
  OfflineAgentConfig,
  OfflineAgentResult,
  OfflineAgentStats,
  OfflineAgentStep,
} from './offline-agent.js';

// Scheduled task runner
export { ScheduledTaskRunner, createScheduledTaskRunner } from './task-runner.js';
export type {
  ScheduledTask,
  TaskExecutionResult,
  TaskRunnerEvent,
  TaskRunnerStatus,
} from './task-runner.js';

// Document watcher
export { DocumentWatcher, createDocumentWatcher } from './document-watcher.js';
export type {
  ChangeSource,
  DocumentChange,
  PipelineResult,
  WatchPipeline,
  WatchTrigger,
} from './document-watcher.js';

// Inference cache
export { InferenceCache, createInferenceCache } from './inference-cache.js';
export type { InferenceCacheConfig, InferenceCacheStats } from './inference-cache.js';

// Collection Tools
export { createCollectionTools } from './collection-tools.js';
export type {
  CollectionCountFn,
  CollectionInsertFn,
  CollectionQueryFn,
  CollectionToolsConfig,
} from './collection-tools.js';

// Streaming Agent
export { StreamingAgent, createStreamingAgent } from './streaming-agent.js';
export type {
  AgentStreamEvent,
  OfflineInferenceConfig,
  StreamingAgentConfig,
} from './streaming-agent.js';

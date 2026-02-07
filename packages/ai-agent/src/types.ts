/**
 * Types for the AI agent framework.
 */

import type { Observable } from 'rxjs';

/**
 * Configuration for creating an AI agent.
 */
export interface AgentConfig {
  /** LLM provider for generating responses */
  readonly provider: LLMProvider;
  /** Available tools the agent can call */
  readonly tools?: ReadonlyArray<Tool>;
  /** System prompt prepended to all conversations */
  readonly systemPrompt?: string;
  /** Maximum number of tool-calling iterations per run */
  readonly maxIterations?: number;
  /** Conversation memory for context management */
  readonly memory?: ConversationMemory;
  /** Temperature for LLM sampling (0-1) */
  readonly temperature?: number;
  /** Maximum tokens in LLM response */
  readonly maxTokens?: number;
}

/**
 * LLM provider interface for generating completions.
 */
export interface LLMProvider {
  /** Provider name */
  readonly name: string;
  /** Generate a completion from messages */
  complete(messages: ReadonlyArray<ConversationMessage>, options?: LLMOptions): Promise<LLMResponse>;
  /** Stream a completion (optional) */
  stream?(messages: ReadonlyArray<ConversationMessage>, options?: LLMOptions): Observable<StreamChunk>;
}

export interface LLMOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<ToolSchema>;
  readonly stopSequences?: ReadonlyArray<string>;
}

/**
 * Response from an LLM completion.
 */
export interface LLMResponse {
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

/**
 * A chunk from a streaming LLM response.
 */
export interface StreamChunk {
  readonly type: 'text' | 'tool_call' | 'done' | 'error';
  readonly content?: string;
  readonly toolCall?: ToolCall;
  readonly error?: string;
}

/**
 * A message in a conversation.
 */
export interface ConversationMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly toolCallId?: string;
  readonly name?: string;
}

/**
 * A tool that the agent can invoke.
 */
export interface Tool {
  /** Unique tool name */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Parameter schema */
  readonly parameters: ReadonlyArray<ToolParameter>;
  /** Execute the tool with given arguments */
  execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult>;
}

/**
 * Schema for a tool parameter.
 */
export interface ToolParameter {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly description: string;
  readonly required?: boolean;
  readonly default?: unknown;
}

/**
 * Schema representation of a tool for LLM function calling.
 */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, { type: string; description: string }>;
    readonly required: ReadonlyArray<string>;
  };
}

/**
 * A tool call requested by the LLM.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  readonly success: boolean;
  readonly data: unknown;
  readonly error?: string;
}

/**
 * Context available to tools during execution.
 */
export interface AgentContext {
  /** Conversation history */
  readonly messages: ReadonlyArray<ConversationMessage>;
  /** Current iteration number */
  readonly iteration: number;
  /** Agent configuration */
  readonly config: AgentConfig;
}

/**
 * A single step in the agent's execution.
 */
export interface AgentStep {
  readonly type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  readonly content: string;
  readonly toolCall?: ToolCall;
  readonly toolResult?: ToolResult;
  readonly timestamp: number;
}

/**
 * Events emitted during agent execution.
 */
export interface AgentEvent {
  readonly type: 'step' | 'stream' | 'complete' | 'error';
  readonly step?: AgentStep;
  readonly chunk?: StreamChunk;
  readonly response?: AgentResponse;
  readonly error?: string;
}

/**
 * Final response from an agent run.
 */
export interface AgentResponse {
  readonly content: string;
  readonly steps: ReadonlyArray<AgentStep>;
  readonly toolCallCount: number;
  readonly iterationCount: number;
  readonly totalTokens?: number;
}

/**
 * Manages conversation memory and context window.
 */
export interface ConversationMemory {
  /** Add a message to memory */
  add(message: ConversationMessage): void;
  /** Get messages within the context window */
  getMessages(maxTokens?: number): ReadonlyArray<ConversationMessage>;
  /** Clear all messages */
  clear(): void;
  /** Get total message count */
  readonly size: number;
}

/**
 * The main agent interface.
 */
export interface Agent {
  /** Run the agent with a user message */
  run(message: string): Promise<AgentResponse>;
  /** Run with streaming events */
  run$(message: string): Observable<AgentEvent>;
  /** Get the conversation history */
  getHistory(): ReadonlyArray<ConversationMessage>;
  /** Reset the agent's conversation state */
  reset(): void;
  /** Destroy and free resources */
  destroy(): void;
}

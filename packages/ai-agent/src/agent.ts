/**
 * @module agent
 *
 * Core agent implementation with observe-think-act loop,
 * tool execution, and streaming support.
 */

import { type Observable, Subject } from 'rxjs';
import type {
  Agent,
  AgentConfig,
  AgentContext,
  AgentEvent,
  AgentResponse,
  AgentStep,
  ConversationMessage,
  LLMResponse,
  ToolCall,
} from './types.js';
import { createConversationMemory } from './conversation-memory.js';
import { createToolRegistry } from './tool-registry.js';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to a local database. 
Use the available tools to query and manipulate data as needed. 
Always explain your reasoning before taking actions.
When presenting data, format it clearly for the user.`;

/**
 * Creates an AI agent that can autonomously interact with data
 * using tool-calling and an observe-think-act loop.
 *
 * @param config - Agent configuration
 * @returns An Agent instance
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   provider: myLLMProvider,
 *   tools: createDatabaseTools(db),
 * });
 *
 * const response = await agent.run('How many todos are incomplete?');
 * console.log(response.content);
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
  const {
    provider,
    tools = [],
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxIterations = 10,
    temperature = 0.7,
    maxTokens = 2048,
  } = config;

  const memory = config.memory ?? createConversationMemory({ systemMessage: systemPrompt });
  const toolRegistry = createToolRegistry(tools);
  let destroyed = false;

  if (!config.memory) {
    // Memory was created with system message already
  } else if (systemPrompt && memory.size === 0) {
    memory.add({ role: 'system', content: systemPrompt });
  }

  async function executeTool(
    toolCall: ToolCall,
    context: AgentContext,
  ): Promise<AgentStep> {
    const tool = toolRegistry.get(toolCall.name);

    if (!tool) {
      return {
        type: 'tool_result',
        content: `Tool "${toolCall.name}" not found`,
        toolCall,
        toolResult: { success: false, data: null, error: `Unknown tool: ${toolCall.name}` },
        timestamp: Date.now(),
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments, context);
      return {
        type: 'tool_result',
        content: JSON.stringify(result.data),
        toolCall,
        toolResult: result,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        type: 'tool_result',
        content: err instanceof Error ? err.message : 'Tool execution failed',
        toolCall,
        toolResult: { success: false, data: null, error: String(err) },
        timestamp: Date.now(),
      };
    }
  }

  async function runLoop(
    userMessage: string,
    eventSubject?: Subject<AgentEvent>,
  ): Promise<AgentResponse> {
    if (destroyed) throw new Error('Agent has been destroyed');

    memory.add({ role: 'user', content: userMessage });
    const steps: AgentStep[] = [];
    let iteration = 0;
    let totalTokens = 0;
    let toolCallCount = 0;

    while (iteration < maxIterations) {
      iteration++;

      const context: AgentContext = {
        messages: memory.getMessages(),
        iteration,
        config,
      };

      const toolSchemas = toolRegistry.getSchemas();
      let response: LLMResponse;

      try {
        response = await provider.complete(memory.getMessages(), {
          temperature,
          maxTokens,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        });
      } catch (err) {
        const errorStep: AgentStep = {
          type: 'thinking',
          content: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        steps.push(errorStep);
        eventSubject?.next({ type: 'step', step: errorStep });
        break;
      }

      if (response.usage) {
        totalTokens += response.usage.promptTokens + response.usage.completionTokens;
      }

      // Handle tool calls
      if (response.finishReason === 'tool_calls' && response.toolCalls?.length) {
        memory.add({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          const callStep: AgentStep = {
            type: 'tool_call',
            content: `Calling ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
            toolCall,
            timestamp: Date.now(),
          };
          steps.push(callStep);
          eventSubject?.next({ type: 'step', step: callStep });

          const resultStep = await executeTool(toolCall, context);
          steps.push(resultStep);
          eventSubject?.next({ type: 'step', step: resultStep });
          toolCallCount++;

          memory.add({
            role: 'tool',
            content: resultStep.content,
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
        }

        continue;
      }

      // Final response
      const responseStep: AgentStep = {
        type: 'response',
        content: response.content,
        timestamp: Date.now(),
      };
      steps.push(responseStep);
      eventSubject?.next({ type: 'step', step: responseStep });

      memory.add({ role: 'assistant', content: response.content });

      const result: AgentResponse = {
        content: response.content,
        steps,
        toolCallCount,
        iterationCount: iteration,
        totalTokens: totalTokens > 0 ? totalTokens : undefined,
      };

      eventSubject?.next({ type: 'complete', response: result });
      eventSubject?.complete();

      return result;
    }

    // Max iterations reached
    const finalContent = steps.length > 0
      ? `Reached maximum iterations (${maxIterations}). Last step: ${steps[steps.length - 1]!.content}`
      : 'No response generated';

    const result: AgentResponse = {
      content: finalContent,
      steps,
      toolCallCount,
      iterationCount: iteration,
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
    };

    eventSubject?.next({ type: 'complete', response: result });
    eventSubject?.complete();

    return result;
  }

  function run(message: string): Promise<AgentResponse> {
    return runLoop(message);
  }

  function run$(message: string): Observable<AgentEvent> {
    const subject = new Subject<AgentEvent>();
    runLoop(message, subject).catch((err) => {
      subject.next({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      subject.complete();
    });
    return subject.asObservable();
  }

  function getHistory(): readonly ConversationMessage[] {
    return memory.getMessages();
  }

  function reset(): void {
    memory.clear();
  }

  function destroy(): void {
    destroyed = true;
    memory.clear();
  }

  return { run, run$, getHistory, reset, destroy };
}

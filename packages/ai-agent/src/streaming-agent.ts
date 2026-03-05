/**
 * Streaming agent with support for offline inference and API fallback.
 */
import { Subject, type Observable } from 'rxjs';
import type {
  AgentConfig,
  AgentStep,
  ConversationMessage,
  LLMProvider,
  LLMResponse,
  Tool,
  ToolResult,
} from './types.js';

export interface StreamingAgentConfig extends AgentConfig {
  maxIterations?: number;
  onStepComplete?: (step: AgentStep) => void;
}

export interface AgentStreamEvent {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ToolResult;
  step?: AgentStep;
  error?: string;
  timestamp: number;
}

export interface OfflineInferenceConfig {
  /** Primary provider (may be offline) */
  primaryProvider: LLMProvider;
  /** Fallback provider (e.g., local model) */
  fallbackProvider?: LLMProvider;
  /** Cache recent responses for offline use */
  enableCache?: boolean;
  /** Max cached responses */
  maxCacheSize?: number;
}

/**
 * Streaming agent that emits events as it processes.
 */
export class StreamingAgent {
  private readonly config: StreamingAgentConfig;
  private readonly provider: LLMProvider;
  private readonly fallbackProvider?: LLMProvider;
  private readonly tools: Map<string, Tool>;
  private readonly memory: ConversationMessage[];
  private readonly steps: AgentStep[] = [];
  private readonly responseCache = new Map<string, LLMResponse>();
  private readonly maxCacheSize: number;
  private _isRunning = false;

  constructor(config: StreamingAgentConfig, offlineConfig?: OfflineInferenceConfig) {
    this.config = config;
    this.provider = offlineConfig?.primaryProvider ?? config.provider;
    this.fallbackProvider = offlineConfig?.fallbackProvider;
    this.tools = new Map((config.tools ?? []).map((t) => [t.name, t]));
    this.memory = [];
    this.maxCacheSize = offlineConfig?.maxCacheSize ?? 100;

    if (config.systemPrompt) {
      this.memory.push({ role: 'system', content: config.systemPrompt });
    }
  }

  /** Whether the agent is currently processing */
  get running(): boolean {
    return this._isRunning;
  }

  /** Run agent with streaming output */
  run$(input: string): Observable<AgentStreamEvent> {
    const events$ = new Subject<AgentStreamEvent>();

    this.runLoop(input, events$).catch((err: unknown) => {
      events$.next({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      events$.complete();
    });

    return events$.asObservable();
  }

  /** Run agent and collect all results */
  async run(input: string): Promise<{ content: string; steps: AgentStep[] }> {
    const events: AgentStreamEvent[] = [];

    return new Promise((resolve, reject) => {
      const sub = this.run$(input).subscribe({
        next: (event) => events.push(event),
        complete: () => {
          sub.unsubscribe();
          const content = events
            .filter((e) => e.type === 'text')
            .map((e) => e.content)
            .join('');
          resolve({ content, steps: [...this.steps] });
        },
        error: (err) => {
          sub.unsubscribe();
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      });
    });
  }

  /** Add a tool at runtime */
  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** Get conversation history */
  getHistory(): ConversationMessage[] {
    return [...this.memory];
  }

  /** Reset agent state */
  reset(): void {
    this.memory.length = 0;
    this.steps.length = 0;
    if (this.config.systemPrompt) {
      this.memory.push({ role: 'system', content: this.config.systemPrompt });
    }
  }

  private async runLoop(input: string, events$: Subject<AgentStreamEvent>): Promise<void> {
    this._isRunning = true;
    const maxIterations = this.config.maxIterations ?? 10;

    this.memory.push({ role: 'user', content: input });
    events$.next({ type: 'thinking', timestamp: Date.now() });

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.callLLM();

      // Emit text content
      if (response.content) {
        events$.next({ type: 'text', content: response.content, timestamp: Date.now() });
        const step: AgentStep = {
          type: 'response',
          content: response.content,
          timestamp: Date.now(),
        };
        this.steps.push(step);
        this.config.onStepComplete?.(step);
        this.memory.push({ role: 'assistant', content: response.content });
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          events$.next({
            type: 'tool_call',
            toolName: toolCall.name,
            toolArgs: toolCall.arguments,
            timestamp: Date.now(),
          });

          const tool = this.tools.get(toolCall.name);
          let result: ToolResult;
          if (tool) {
            try {
              const context = {
                messages: [...this.memory],
                iteration,
                config: this.config,
              };
              result = await tool.execute(toolCall.arguments, context);
            } catch (err) {
              result = {
                success: false,
                data: null,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          } else {
            result = { success: false, data: null, error: `Tool not found: ${toolCall.name}` };
          }

          events$.next({
            type: 'tool_result',
            toolResult: result,
            toolName: toolCall.name,
            timestamp: Date.now(),
          });

          const callStep: AgentStep = {
            type: 'tool_call',
            content: `Calling ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
            toolCall,
            toolResult: result,
            timestamp: Date.now(),
          };
          this.steps.push(callStep);
          this.config.onStepComplete?.(callStep);

          this.memory.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
          });
        }

        // Continue loop for next LLM response after tool results
        continue;
      }

      // No tool calls = we're done
      break;
    }

    events$.next({ type: 'done', timestamp: Date.now() });
    events$.complete();
    this._isRunning = false;
  }

  private async callLLM(): Promise<LLMResponse> {
    const toolSchemas = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
        ),
        required: t.parameters.filter((p) => p.required).map((p) => p.name),
      },
    }));

    // Try primary provider
    try {
      const response = await this.provider.complete(this.memory, {
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      });

      // Cache response
      const cacheKey = this.memory.map((m) => m.content).join('|');
      this.cacheResponse(cacheKey, response);

      return response;
    } catch (primaryError) {
      // Try fallback
      if (this.fallbackProvider) {
        try {
          return await this.fallbackProvider.complete(this.memory, {
            tools: toolSchemas.length > 0 ? toolSchemas : undefined,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
          });
        } catch {
          // Both failed
        }
      }

      // Try cache
      const cacheKey = this.memory.map((m) => m.content).join('|');
      const cached = this.responseCache.get(cacheKey);
      if (cached) return cached;

      throw primaryError;
    }
  }

  private cacheResponse(key: string, response: LLMResponse): void {
    if (this.responseCache.size >= this.maxCacheSize) {
      const firstKey = this.responseCache.keys().next().value;
      if (firstKey) this.responseCache.delete(firstKey);
    }
    this.responseCache.set(key, response);
  }
}

export function createStreamingAgent(
  config: StreamingAgentConfig,
  offlineConfig?: OfflineInferenceConfig
): StreamingAgent {
  return new StreamingAgent(config, offlineConfig);
}

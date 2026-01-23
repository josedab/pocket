/**
 * React hooks for AI Assistant
 * These are type definitions - actual implementation requires React
 */

import type { Document } from '@pocket/core';
import type { AIAssistant } from './ai-assistant.js';
import type {
  AIQueryOptions,
  AIQueryResult,
  AIStreamChunk,
  ContextDocument,
  Message,
} from './types.js';

/**
 * State for useAIQuery hook
 */
export interface UseAIQueryState<T extends Document = Document> {
  /** The generated response */
  response: string | null;
  /** Retrieved context documents */
  context: ContextDocument<T>[];
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether currently streaming */
  isStreaming: boolean;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Options for useAIQuery hook
 */
export interface UseAIQueryOptions extends AIQueryOptions {
  /** Auto-execute on mount/query change */
  enabled?: boolean;
  /** Callback when query completes */
  onSuccess?: (result: AIQueryResult) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Callback for each stream chunk */
  onStreamChunk?: (chunk: AIStreamChunk) => void;
}

/**
 * Return type for useAIQuery hook
 */
export interface UseAIQueryReturn<T extends Document = Document> extends UseAIQueryState<T> {
  /** Execute a query */
  query: (question: string) => Promise<void>;
  /** Stream a query */
  streamQuery: (question: string) => void;
  /** Stop streaming */
  stopStreaming: () => void;
  /** Reset state */
  reset: () => void;
  /** Search without generating response */
  search: (query: string) => Promise<ContextDocument<T>[]>;
}

/**
 * State for useChat hook
 */
export interface UseChatState {
  /** Chat messages */
  messages: Message[];
  /** Current input */
  input: string;
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether currently streaming */
  isStreaming: boolean;
}

/**
 * Return type for useChat hook
 */
export interface UseChatReturn extends UseChatState {
  /** Send a message */
  sendMessage: (message?: string) => Promise<void>;
  /** Stream a message */
  streamMessage: (message?: string) => void;
  /** Stop streaming */
  stopStreaming: () => void;
  /** Set input value */
  setInput: (input: string) => void;
  /** Clear chat history */
  clearHistory: () => void;
  /** Reset entire state */
  reset: () => void;
}

/**
 * React hooks interface for dependency injection
 */
export interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
}

/**
 * Factory to create useAIQuery hook
 * This allows the hook to be created without direct React dependency
 *
 * @example
 * ```typescript
 * import * as React from 'react';
 * import { createUseAIQueryHook } from '@pocket/ai';
 *
 * const useAIQuery = createUseAIQueryHook(React);
 * ```
 */
export function createUseAIQueryHook(React: ReactHooks) {
  return function useAIQuery<T extends Document>(
    assistant: AIAssistant<T>,
    options: UseAIQueryOptions = {}
  ): UseAIQueryReturn<T> {
    const [state, setState] = React.useState<UseAIQueryState<T>>({
      response: null,
      context: [],
      isLoading: false,
      error: null,
      isStreaming: false,
    });

    const subscriptionRef = React.useRef<{ unsubscribe: () => void } | null>(null);

    const query = React.useCallback(
      async (question: string) => {
        setState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          isStreaming: false,
        }));

        try {
          const result = await assistant.query(question, options);
          setState({
            response: result.response,
            context: result.context,
            isLoading: false,
            error: null,
            isStreaming: false,
            usage: result.usage,
          });
          options.onSuccess?.(result);
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Query failed');
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error,
            isStreaming: false,
          }));
          options.onError?.(error);
        }
      },
      [assistant, options]
    ) as (question: string) => Promise<void>;

    const streamQuery = React.useCallback(
      (question: string) => {
        setState((prev) => ({
          ...prev,
          isLoading: true,
          isStreaming: true,
          error: null,
          response: '',
        }));

        const subscription = assistant.stream(question, options).subscribe({
          next: (chunk) => {
            if (chunk.context) {
              setState((prev) => ({
                ...prev,
                context: chunk.context ?? prev.context,
              }));
            }
            setState((prev) => ({
              ...prev,
              response: chunk.accumulated,
            }));
            options.onStreamChunk?.(chunk);
          },
          error: (err) => {
            const error = err instanceof Error ? err : new Error('Stream failed');
            setState((prev) => ({
              ...prev,
              isLoading: false,
              isStreaming: false,
              error,
            }));
            options.onError?.(error);
          },
          complete: () => {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              isStreaming: false,
            }));
          },
        });

        subscriptionRef.current = subscription;
      },
      [assistant, options]
    ) as (question: string) => void;

    const stopStreaming = React.useCallback(() => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
      }));
    }, []) as () => void;

    const reset = React.useCallback(() => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      setState({
        response: null,
        context: [],
        isLoading: false,
        error: null,
        isStreaming: false,
      });
    }, []) as () => void;

    const search = React.useCallback(
      async (searchQuery: string) => {
        return assistant.search(searchQuery, {
          topK: options.topK,
          minScore: options.minScore,
        });
      },
      [assistant, options.topK, options.minScore]
    ) as (query: string) => Promise<ContextDocument<T>[]>;

    // Cleanup on unmount
    React.useEffect(() => {
      return () => {
        subscriptionRef.current?.unsubscribe();
      };
    }, []);

    return {
      ...state,
      query,
      streamQuery,
      stopStreaming,
      reset,
      search,
    };
  };
}

/**
 * Factory to create useChat hook
 *
 * @example
 * ```typescript
 * import * as React from 'react';
 * import { createUseChatHook } from '@pocket/ai';
 *
 * const useChat = createUseChatHook(React);
 * ```
 */
export function createUseChatHook(React: ReactHooks) {
  return function useChat<T extends Document>(
    assistant: AIAssistant<T>,
    options: {
      initialMessages?: Message[];
      onMessage?: (message: Message) => void;
      onError?: (error: Error) => void;
    } = {}
  ): UseChatReturn {
    const [state, setState] = React.useState<UseChatState>({
      messages: options.initialMessages ?? [],
      input: '',
      isLoading: false,
      error: null,
      isStreaming: false,
    });

    const subscriptionRef = React.useRef<{ unsubscribe: () => void } | null>(null);

    const sendMessage = React.useCallback(
      async (message?: string) => {
        const content = message ?? state.input;
        if (!content.trim()) return;

        const userMessage: Message = { role: 'user', content };

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, userMessage],
          input: '',
          isLoading: true,
          error: null,
        }));

        try {
          const response = await assistant.chat(content, {
            history: state.messages,
          });

          const assistantMessage: Message = { role: 'assistant', content: response };

          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, assistantMessage],
            isLoading: false,
          }));

          options.onMessage?.(assistantMessage);
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Chat failed');
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error,
          }));
          options.onError?.(error);
        }
      },
      [assistant, state.messages, state.input, options]
    ) as (message?: string) => Promise<void>;

    const streamMessage = React.useCallback(
      (message?: string) => {
        const content = message ?? state.input;
        if (!content.trim()) return;

        const userMessage: Message = { role: 'user', content };

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, userMessage, { role: 'assistant', content: '' }],
          input: '',
          isLoading: true,
          isStreaming: true,
          error: null,
        }));

        const subscription = assistant
          .stream(content, {
            history: state.messages,
          })
          .subscribe({
            next: (chunk) => {
              setState((prev) => {
                const messages = [...prev.messages];
                const lastMessage = messages[messages.length - 1];
                if (lastMessage?.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMessage,
                    content: chunk.accumulated,
                  };
                }
                return { ...prev, messages };
              });
            },
            error: (err) => {
              const error = err instanceof Error ? err : new Error('Stream failed');
              setState((prev) => ({
                ...prev,
                isLoading: false,
                isStreaming: false,
                error,
              }));
              options.onError?.(error);
            },
            complete: () => {
              setState((prev) => ({
                ...prev,
                isLoading: false,
                isStreaming: false,
              }));
            },
          });

        subscriptionRef.current = subscription;
      },
      [assistant, state.messages, state.input, options]
    ) as (message?: string) => void;

    const stopStreaming = React.useCallback(() => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
      }));
    }, []) as () => void;

    const setInput = React.useCallback((input: string) => {
      setState((prev) => ({ ...prev, input }));
    }, []) as (input: string) => void;

    const clearHistory = React.useCallback(() => {
      assistant.clearHistory();
      setState((prev) => ({
        ...prev,
        messages: [],
      }));
    }, [assistant]) as () => void;

    const reset = React.useCallback(() => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      assistant.clearHistory();
      setState({
        messages: [],
        input: '',
        isLoading: false,
        error: null,
        isStreaming: false,
      });
    }, [assistant]) as () => void;

    // Cleanup on unmount
    React.useEffect(() => {
      return () => {
        subscriptionRef.current?.unsubscribe();
      };
    }, []);

    return {
      ...state,
      sendMessage,
      streamMessage,
      stopStreaming,
      setInput,
      clearHistory,
      reset,
    };
  };
}

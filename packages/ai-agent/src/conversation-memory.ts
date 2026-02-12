/**
 * @module conversation-memory
 *
 * Manages conversation history with context window management.
 */

import type { ConversationMemory, ConversationMessage } from './types.js';

/**
 * Configuration for conversation memory.
 */
export interface ConversationMemoryConfig {
  /** Maximum number of messages to retain */
  readonly maxMessages?: number;
  /** System message to always include */
  readonly systemMessage?: string;
}

/**
 * Creates a conversation memory that manages message history
 * with automatic pruning to stay within context limits.
 *
 * @param config - Memory configuration
 * @returns A ConversationMemory instance
 *
 * @example
 * ```typescript
 * const memory = createConversationMemory({ maxMessages: 50 });
 * memory.add({ role: 'user', content: 'Hello' });
 * ```
 */
export function createConversationMemory(
  config: ConversationMemoryConfig = {},
): ConversationMemory {
  const { maxMessages = 100, systemMessage } = config;
  const messages: ConversationMessage[] = [];

  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage });
  }

  function add(message: ConversationMessage): void {
    messages.push(message);

    // Prune old messages (keep system + most recent)
    while (messages.length > maxMessages) {
      const firstNonSystem = messages.findIndex((m) => m.role !== 'system');
      if (firstNonSystem >= 0) {
        messages.splice(firstNonSystem, 1);
      } else {
        break;
      }
    }
  }

  function getMessages(_maxTokens?: number): readonly ConversationMessage[] {
    return [...messages];
  }

  function clear(): void {
    const systemMsgs = messages.filter((m) => m.role === 'system');
    messages.length = 0;
    messages.push(...systemMsgs);
  }

  return {
    add,
    getMessages,
    clear,
    get size() {
      return messages.length;
    },
  };
}

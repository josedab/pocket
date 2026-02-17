/**
 * @module offline-agent
 *
 * On-device AI agent for private data Q&A. Works entirely offline —
 * the LLMProvider could be backed by Ollama or any local model.
 * No data is ever sent to the cloud.
 */

import type { LLMProvider, LLMResponse, ConversationMessage } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema description for a single collection field. */
export interface CollectionFieldDescriptor {
  readonly name: string;
  readonly type: string;
}

/** Describes a local data collection the agent can reason about. */
export interface CollectionContext {
  readonly name: string;
  readonly description?: string;
  readonly fields: readonly CollectionFieldDescriptor[];
}

/** Configuration for the offline agent. */
export interface OfflineAgentConfig {
  /** LLM provider (e.g. Ollama, WebLLM). */
  readonly adapter: LLMProvider;
  /** Available data collections. */
  readonly collections: CollectionContext[];
  /** Max documents included in context per query. @default 20 */
  readonly maxContextDocuments?: number;
  /** Max reasoning iterations. @default 5 */
  readonly maxIterations?: number;
  /** Sampling temperature. @default 0.3 */
  readonly temperature?: number;
}

/** A question directed at the offline agent. */
export interface AgentQuery {
  readonly question: string;
  readonly collection?: string;
}

/** A single step in the agent's reasoning chain. */
export interface OfflineAgentStep {
  readonly type: 'think' | 'query' | 'answer';
  readonly content: string;
  readonly timestamp: number;
}

/** Result returned by {@link OfflineAgent.ask}. */
export interface OfflineAgentResult {
  readonly answer: string;
  readonly steps: readonly OfflineAgentStep[];
  readonly documentsUsed: number;
  readonly executionTimeMs: number;
  readonly confidence: number;
}

/** Aggregate statistics for an agent instance. */
export interface OfflineAgentStats {
  readonly totalQueries: number;
  readonly avgResponseTimeMs: number;
  readonly avgStepsPerQuery: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemPrompt(collections: readonly CollectionContext[]): string {
  const collectionDescriptions = collections
    .map((c) => {
      const fields = c.fields.map((f) => `${f.name}: ${f.type}`).join(', ');
      return `- ${c.name}${c.description ? ` (${c.description})` : ''}: { ${fields} }`;
    })
    .join('\n');

  return [
    'You are a private, on-device AI assistant that answers questions about local data.',
    'You NEVER send data to external services. All reasoning happens locally.',
    '',
    'Available collections:',
    collectionDescriptions,
    '',
    'When answering:',
    '1. First output a THINK line explaining your reasoning.',
    '2. Then output a QUERY line describing what data you would retrieve.',
    '3. Finally output an ANSWER line with the answer and a confidence score (0-1) in the format CONFIDENCE:0.X.',
    'Always include a CONFIDENCE score in your ANSWER line.',
  ].join('\n');
}

function detectCollection(
  question: string,
  collections: readonly CollectionContext[],
): string | undefined {
  const lower = question.toLowerCase();
  for (const col of collections) {
    if (lower.includes(col.name.toLowerCase())) {
      return col.name;
    }
    if (col.description && lower.includes(col.description.toLowerCase())) {
      return col.name;
    }
  }
  return undefined;
}

function parseSteps(content: string): OfflineAgentStep[] {
  const steps: OfflineAgentStep[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper.startsWith('THINK:') || upper.startsWith('THINK ')) {
      steps.push({ type: 'think', content: trimmed.slice(trimmed.indexOf(':') + 1).trim() || trimmed.slice(6).trim(), timestamp: Date.now() });
    } else if (upper.startsWith('QUERY:') || upper.startsWith('QUERY ')) {
      steps.push({ type: 'query', content: trimmed.slice(trimmed.indexOf(':') + 1).trim() || trimmed.slice(6).trim(), timestamp: Date.now() });
    } else if (upper.startsWith('ANSWER:') || upper.startsWith('ANSWER ')) {
      steps.push({ type: 'answer', content: trimmed.slice(trimmed.indexOf(':') + 1).trim() || trimmed.slice(7).trim(), timestamp: Date.now() });
    }
  }

  return steps;
}

function extractConfidence(content: string): number {
  const match = content.match(/CONFIDENCE[:\s]*([\d.]+)/i);
  if (match) {
    const val = parseFloat(match[1]!);
    if (!isNaN(val) && val >= 0 && val <= 1) return val;
  }
  return 0.5;
}

// ---------------------------------------------------------------------------
// OfflineAgent
// ---------------------------------------------------------------------------

/** On-device AI agent for private data Q&A. */
export class OfflineAgent {
  private readonly adapter: LLMProvider;
  private collections: CollectionContext[];
  private readonly maxContextDocuments: number;
  private readonly temperature: number;

  private history: ConversationMessage[] = [];
  private queryTimes: number[] = [];
  private queryStepCounts: number[] = [];

  constructor(config: OfflineAgentConfig) {
    this.adapter = config.adapter;
    this.collections = [...config.collections];
    this.maxContextDocuments = config.maxContextDocuments ?? 20;
    this.temperature = config.temperature ?? 0.3;
  }

  /**
   * Ask a question about local data.
   *
   * The agent analyses the question, determines relevant collection(s),
   * generates a structured query, builds context, and answers using the LLM.
   */
  async ask(query: AgentQuery): Promise<OfflineAgentResult> {
    const startTime = Date.now();
    const allSteps: OfflineAgentStep[] = [];

    // Step 1 — Determine target collection
    const targetCollection = query.collection ?? detectCollection(query.question, this.collections);

    allSteps.push({
      type: 'think',
      content: targetCollection
        ? `Identified collection: ${targetCollection}`
        : 'No specific collection identified; using all available collections.',
      timestamp: Date.now(),
    });

    // Step 2 — Build query context describing the data schema
    const relevantCollections = targetCollection
      ? this.collections.filter((c) => c.name === targetCollection)
      : this.collections;

    const contextBlock = relevantCollections
      .map((c) => {
        const fields = c.fields.map((f) => `  ${f.name} (${f.type})`).join('\n');
        return `Collection "${c.name}":\n${fields}`;
      })
      .join('\n\n');

    allSteps.push({
      type: 'query',
      content: `Prepared schema context for ${relevantCollections.length} collection(s) (max ${this.maxContextDocuments} docs).`,
      timestamp: Date.now(),
    });

    // Step 3 — Build messages and call LLM
    const systemMessage: ConversationMessage = {
      role: 'system',
      content: buildSystemPrompt(this.collections),
    };

    const userMessage: ConversationMessage = {
      role: 'user',
      content: [
        `Question: ${query.question}`,
        '',
        'Data context:',
        contextBlock,
      ].join('\n'),
    };

    const messages: ConversationMessage[] = [
      systemMessage,
      ...this.history.slice(-10), // keep recent history for multi-turn
      userMessage,
    ];

    let response: LLMResponse;
    try {
      response = await this.adapter.complete(messages, {
        temperature: this.temperature,
        maxTokens: 1024,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`LLM completion failed: ${errorMsg}`);
    }

    // Step 4 — Parse structured steps from the LLM output
    const llmSteps = parseSteps(response.content);
    allSteps.push(...llmSteps);

    // If the LLM didn't return structured steps, create a single answer step
    if (llmSteps.length === 0) {
      allSteps.push({ type: 'answer', content: response.content, timestamp: Date.now() });
    }

    // Step 5 — Extract answer and confidence
    const answerStep = allSteps.find((s) => s.type === 'answer');
    const answer = answerStep?.content ?? response.content;
    const confidence = extractConfidence(response.content);

    // Persist to history
    this.history.push(userMessage);
    this.history.push({ role: 'assistant', content: response.content });

    const executionTimeMs = Date.now() - startTime;
    this.queryTimes.push(executionTimeMs);
    this.queryStepCounts.push(allSteps.length);

    return {
      answer,
      steps: allSteps,
      documentsUsed: relevantCollections.reduce((sum, c) => sum + c.fields.length, 0),
      executionTimeMs,
      confidence,
    };
  }

  /** List registered collections. */
  getCollections(): readonly CollectionContext[] {
    return this.collections;
  }

  /** Update the schema context. */
  updateCollections(collections: CollectionContext[]): void {
    this.collections = [...collections];
  }

  /** Aggregate query statistics. */
  getStats(): OfflineAgentStats {
    const total = this.queryTimes.length;
    const avgTime = total > 0 ? this.queryTimes.reduce((a, b) => a + b, 0) / total : 0;
    const avgSteps = total > 0 ? this.queryStepCounts.reduce((a, b) => a + b, 0) / total : 0;
    return {
      totalQueries: total,
      avgResponseTimeMs: avgTime,
      avgStepsPerQuery: avgSteps,
    };
  }

  /** Reset conversation history and statistics. */
  clearHistory(): void {
    this.history = [];
    this.queryTimes = [];
    this.queryStepCounts = [];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create an on-device offline agent for private data Q&A. */
export function createOfflineAgent(config: OfflineAgentConfig): OfflineAgent {
  return new OfflineAgent(config);
}

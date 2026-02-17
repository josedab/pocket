/**
 * Streaming response support for the AI copilot.
 *
 * Wraps QueryCopilot to support streaming partial results during
 * LLM generation, enabling progressive UI updates.
 *
 * @module streaming-copilot
 */

import { Subject, type Observable } from 'rxjs';
import type { LLMAdapter, Message } from './types.js';
import type { CollectionSchema, GeneratedQuery } from './smart-query.js';

/** A streaming chunk from the copilot */
export interface CopilotStreamChunk {
  readonly type: 'partial' | 'complete' | 'error';
  readonly text: string;
  readonly accumulated: string;
  readonly query?: GeneratedQuery | null;
  readonly confidence?: number;
  readonly done: boolean;
}

/** Configuration for the streaming copilot */
export interface StreamingCopilotConfig {
  /** LLM adapter that supports streaming */
  readonly adapter: LLMAdapter;
  /** Collection schemas */
  readonly schemas: readonly CollectionSchema[];
  /** Temperature (default: 0.1) */
  readonly temperature?: number;
}

/**
 * Streaming query copilot that emits partial results.
 *
 * @example
 * ```typescript
 * const streamer = new StreamingCopilot({ adapter, schemas });
 *
 * const stream = streamer.askStream('show me incomplete todos');
 * stream.subscribe(chunk => {
 *   if (chunk.type === 'partial') {
 *     updateUI(chunk.accumulated); // Progressive display
 *   } else if (chunk.type === 'complete') {
 *     executeQuery(chunk.query!);
 *   }
 * });
 * ```
 */
export class StreamingCopilot {
  private readonly config: StreamingCopilotConfig;

  constructor(config: StreamingCopilotConfig) {
    this.config = config;
  }

  /** Ask a question and get a streaming response */
  askStream(question: string): Observable<CopilotStreamChunk> {
    const subject = new Subject<CopilotStreamChunk>();

    void this.executeStream(question, subject);

    return subject.asObservable();
  }

  private async executeStream(question: string, subject: Subject<CopilotStreamChunk>): Promise<void> {
    const systemPrompt = this.buildSystemPrompt();
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ];

    let accumulated = '';

    try {
      // Use streaming if adapter supports it
      const stream = this.config.adapter.stream(messages, {
        temperature: this.config.temperature ?? 0.1,
      });

      for await (const chunk of stream) {
        accumulated += chunk.text;
        subject.next({
          type: 'partial',
          text: chunk.text,
          accumulated,
          done: chunk.done,
        });

        if (chunk.done) {
          // Try to parse the accumulated response as a query
          const query = this.parseQueryResponse(accumulated, question);
          subject.next({
            type: 'complete',
            text: '',
            accumulated,
            query,
            confidence: query?.confidence ?? 0,
            done: true,
          });
        }
      }
    } catch (err) {
      // Fallback to non-streaming
      try {
        const result = await this.config.adapter.complete(messages, {
          temperature: this.config.temperature ?? 0.1,
        });
        accumulated = result.content;
        const query = this.parseQueryResponse(accumulated, question);

        subject.next({
          type: 'complete',
          text: accumulated,
          accumulated,
          query,
          confidence: query?.confidence ?? 0,
          done: true,
        });
      } catch (fallbackErr) {
        subject.next({
          type: 'error',
          text: String(fallbackErr),
          accumulated,
          done: true,
        });
      }
    }

    subject.complete();
  }

  private parseQueryResponse(response: string, originalQuestion: string): GeneratedQuery | null {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        collection: String(parsed['collection'] ?? ''),
        filter: (parsed['filter'] as Record<string, unknown>) ?? {},
        sort: parsed['sort'] as Record<string, 'asc' | 'desc'> | undefined,
        limit: typeof parsed['limit'] === 'number' ? parsed['limit'] : undefined,
        explanation: String(parsed['explanation'] ?? ''),
        confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0.5,
        naturalLanguage: originalQuestion,
      };
    } catch {
      return null;
    }
  }

  private buildSystemPrompt(): string {
    const schemaDesc = this.config.schemas
      .map((s) => `Collection "${s.name}": fields ${s.fields.map((f) => `${f.name}(${f.type})`).join(', ')}`)
      .join('\n');

    return `You are a database query translator. Convert natural language to JSON query objects.
Output ONLY valid JSON with: collection, filter, sort, limit, explanation, confidence (0-1).

Available schemas:
${schemaDesc}`;
  }
}

/** Factory function */
export function createStreamingCopilot(config: StreamingCopilotConfig): StreamingCopilot {
  return new StreamingCopilot(config);
}

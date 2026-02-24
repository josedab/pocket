/**
 * Document Watcher — triggers AI pipelines when documents change.
 *
 * Watches Pocket collections for changes and automatically runs
 * AI processing (summarize, classify, extract, etc.) on new or
 * modified documents.
 */

import { Subject, type Subscription } from 'rxjs';
import type { LLMProvider, Tool } from './types.js';

/** Trigger condition for document watching. */
export type WatchTrigger = 'insert' | 'update' | 'delete' | 'any';

/** AI pipeline to run when a document changes. */
export interface WatchPipeline {
  readonly id: string;
  readonly name: string;
  /** Collection to watch. */
  readonly collection: string;
  /** Which operations trigger the pipeline. */
  readonly triggers: readonly WatchTrigger[];
  /** Prompt template. Use {{document}} for the changed doc JSON. */
  readonly promptTemplate: string;
  /** Optional filter: only trigger for docs matching this predicate. */
  readonly filter?: (doc: Record<string, unknown>) => boolean;
  /** Debounce in ms to batch rapid changes. Defaults to 1000. */
  readonly debounceMs?: number;
  /** Tools available to the pipeline. */
  readonly tools?: readonly Tool[];
}

/** Result of a pipeline execution triggered by a document change. */
export interface PipelineResult {
  readonly pipelineId: string;
  readonly collection: string;
  readonly documentId: string;
  readonly trigger: WatchTrigger;
  readonly output: string;
  readonly success: boolean;
  readonly error?: string;
  readonly timestamp: number;
}

/** Document change event shape. */
export interface DocumentChange {
  readonly type: 'insert' | 'update' | 'delete';
  readonly collection: string;
  readonly documentId: string;
  readonly document?: Record<string, unknown>;
}

/** A subscribable change source (e.g., a Pocket collection). */
export interface ChangeSource {
  subscribe(callback: (change: DocumentChange) => void): Subscription;
}

export class DocumentWatcher {
  private readonly pipelines = new Map<string, WatchPipeline>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly results$ = new Subject<PipelineResult>();
  private readonly changeSources = new Map<string, ChangeSource>();

  constructor(private readonly provider: LLMProvider) {}

  /** Register a change source for a collection. */
  registerSource(collection: string, source: ChangeSource): void {
    this.changeSources.set(collection, source);
  }

  /** Register a pipeline to run on document changes. */
  addPipeline(pipeline: WatchPipeline): void {
    this.pipelines.set(pipeline.id, pipeline);
    this.setupSubscription(pipeline);
  }

  /** Remove a pipeline. */
  removePipeline(pipelineId: string): void {
    this.pipelines.delete(pipelineId);
    const sub = this.subscriptions.get(pipelineId);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(pipelineId);
    }
  }

  /** Observable of pipeline results. */
  get results() {
    return this.results$.asObservable();
  }

  /** Manually trigger a pipeline for a specific document. */
  async triggerPipeline(pipelineId: string, change: DocumentChange): Promise<PipelineResult> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return {
        pipelineId,
        collection: change.collection,
        documentId: change.documentId,
        trigger: change.type,
        output: '',
        success: false,
        error: `Pipeline ${pipelineId} not found`,
        timestamp: Date.now(),
      };
    }
    return this.executePipeline(pipeline, change);
  }

  /** Shut down all watchers. */
  destroy(): void {
    for (const sub of this.subscriptions.values()) sub.unsubscribe();
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.subscriptions.clear();
    this.debounceTimers.clear();
    this.results$.complete();
  }

  private setupSubscription(pipeline: WatchPipeline): void {
    const source = this.changeSources.get(pipeline.collection);
    if (!source) return;

    const debounceMs = pipeline.debounceMs ?? 1000;

    const sub = source.subscribe((change) => {
      const triggerMatch =
        pipeline.triggers.includes('any') || pipeline.triggers.includes(change.type);
      if (!triggerMatch) return;

      if (pipeline.filter && change.document && !pipeline.filter(change.document)) {
        return;
      }

      // Debounce
      const timerKey = `${pipeline.id}:${change.documentId}`;
      const existing = this.debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        timerKey,
        setTimeout(() => {
          this.debounceTimers.delete(timerKey);
          void this.executePipeline(pipeline, change);
        }, debounceMs)
      );
    });

    this.subscriptions.set(pipeline.id, sub);
  }

  private async executePipeline(
    pipeline: WatchPipeline,
    change: DocumentChange
  ): Promise<PipelineResult> {
    try {
      const docJson = JSON.stringify(change.document ?? {}, null, 2);
      const prompt = pipeline.promptTemplate
        .replace(/\{\{document\}\}/g, docJson)
        .replace(/\{\{collection\}\}/g, change.collection)
        .replace(/\{\{documentId\}\}/g, change.documentId);

      const response = await this.provider.complete(
        [
          {
            role: 'system',
            content: `You are an AI processing a document change in the "${change.collection}" collection. Change type: ${change.type}.`,
          },
          { role: 'user', content: prompt },
        ],
        { maxTokens: 500 }
      );

      const result: PipelineResult = {
        pipelineId: pipeline.id,
        collection: change.collection,
        documentId: change.documentId,
        trigger: change.type,
        output: response.content,
        success: true,
        timestamp: Date.now(),
      };

      this.results$.next(result);
      return result;
    } catch (err) {
      const result: PipelineResult = {
        pipelineId: pipeline.id,
        collection: change.collection,
        documentId: change.documentId,
        trigger: change.type,
        output: '',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };

      this.results$.next(result);
      return result;
    }
  }
}

export function createDocumentWatcher(provider: LLMProvider): DocumentWatcher {
  return new DocumentWatcher(provider);
}

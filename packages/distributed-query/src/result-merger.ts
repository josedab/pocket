/**
 * Result merger with deduplication, sorting, and failure handling
 * for distributed query results.
 */

export interface PartialResult<T = Record<string, unknown>> {
  nodeId: string;
  data: T[];
  error?: string;
  executionMs: number;
  isFinal: boolean;
}

export interface MergedResult<T = Record<string, unknown>> {
  data: T[];
  totalCount: number;
  respondedNodes: string[];
  failedNodes: { nodeId: string; error: string }[];
  duplicatesRemoved: number;
  executionMs: number;
}

export interface MergerConfig {
  deduplicateBy?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  quorumSize?: number;
}

/**
 * Merges results from multiple nodes with deduplication and failure handling.
 */
export class ResultMerger {
  private readonly config: MergerConfig;

  constructor(config?: MergerConfig) {
    this.config = config ?? {};
  }

  /** Merge multiple partial results into one final result */
  merge<T extends Record<string, unknown>>(partials: PartialResult<T>[]): MergedResult<T> {
    const start = Date.now();
    const respondedNodes: string[] = [];
    const failedNodes: { nodeId: string; error: string }[] = [];
    let allData: T[] = [];

    for (const partial of partials) {
      if (partial.error) {
        failedNodes.push({ nodeId: partial.nodeId, error: partial.error });
      } else {
        respondedNodes.push(partial.nodeId);
        allData.push(...partial.data);
      }
    }

    // Check quorum
    if (this.config.quorumSize && respondedNodes.length < this.config.quorumSize) {
      return {
        data: [],
        totalCount: 0,
        respondedNodes,
        failedNodes,
        duplicatesRemoved: 0,
        executionMs: Date.now() - start,
      };
    }

    // Deduplication
    let duplicatesRemoved = 0;
    if (this.config.deduplicateBy) {
      const seen = new Set<unknown>();
      const deduped: T[] = [];
      const key = this.config.deduplicateBy;
      for (const item of allData) {
        const val = item[key];
        if (!seen.has(val)) {
          seen.add(val);
          deduped.push(item);
        } else {
          duplicatesRemoved++;
        }
      }
      allData = deduped;
    }

    // Sort
    if (this.config.sortBy) {
      const field = this.config.sortBy;
      const dir = this.config.sortDirection === 'desc' ? -1 : 1;
      allData.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        return aVal < bVal ? -dir : dir;
      });
    }

    // Limit
    const totalCount = allData.length;
    if (this.config.limit) {
      allData = allData.slice(0, this.config.limit);
    }

    return {
      data: allData,
      totalCount,
      respondedNodes,
      failedNodes,
      duplicatesRemoved,
      executionMs: Date.now() - start,
    };
  }

  /** Incrementally merge a new partial result into an existing merged result */
  mergeIncremental<T extends Record<string, unknown>>(
    existing: MergedResult<T>,
    newPartial: PartialResult<T>
  ): MergedResult<T> {
    const allPartials: PartialResult<T>[] = [
      { nodeId: 'existing', data: existing.data, executionMs: 0, isFinal: true },
      newPartial,
    ];
    const merged = this.merge(allPartials);

    return {
      ...merged,
      respondedNodes: [
        ...existing.respondedNodes,
        ...merged.respondedNodes.filter((n) => n !== 'existing'),
      ],
      failedNodes: [...existing.failedNodes, ...merged.failedNodes],
    };
  }
}

export function createResultMerger(config?: MergerConfig): ResultMerger {
  return new ResultMerger(config);
}

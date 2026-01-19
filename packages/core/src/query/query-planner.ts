import type { Document } from '../types/document.js';
import type { QueryFilter, QueryPlan, QueryPlanStep, QuerySpec } from '../types/query.js';
import type { NormalizedIndex } from '../types/storage.js';

/**
 * Query planner - selects indexes and creates execution plan
 */
export class QueryPlanner<T extends Document> {
  private readonly indexes: NormalizedIndex[];

  constructor(indexes: NormalizedIndex[] = []) {
    this.indexes = indexes;
  }

  /**
   * Update available indexes
   */
  setIndexes(indexes: NormalizedIndex[]): void {
    this.indexes.length = 0;
    this.indexes.push(...indexes);
  }

  /**
   * Create an execution plan for a query
   */
  plan(spec: QuerySpec<T>): QueryPlan {
    const steps: QueryPlanStep[] = [];
    let selectedIndex: NormalizedIndex | null = null;
    let indexCovers = false;
    let sortUsingIndex = false;
    let estimatedScan = Infinity;

    // Find best index for the filter
    if (spec.filter) {
      const filterFields = this.extractFilterFields(spec.filter);
      const indexScores = this.scoreIndexes(filterFields, spec.sort);

      if (indexScores.length > 0) {
        // Sort by score descending
        indexScores.sort((a, b) => b.score - a.score);
        const bestMatch = indexScores[0]!;

        if (bestMatch.score > 0) {
          selectedIndex = bestMatch.index;
          indexCovers = bestMatch.covers;
          sortUsingIndex = bestMatch.sortMatch;
          estimatedScan = bestMatch.estimatedScan;
        }
      }
    } else if (spec.sort && spec.sort.length > 0) {
      // No filter, but we might use an index for sorting
      const sortField = spec.sort[0]!.field;
      const sortDirection = spec.sort[0]!.direction;

      for (const index of this.indexes) {
        const firstField = index.fields[0];
        if (firstField && firstField.field === sortField) {
          // Check if direction matches (or we can reverse)
          selectedIndex = index;
          sortUsingIndex = firstField.direction === sortDirection;
          break;
        }
      }
    }

    // Build plan steps
    if (selectedIndex) {
      steps.push({
        type: 'index-scan',
        description: `Scan index "${selectedIndex.name}" on fields [${selectedIndex.fields.map((f) => f.field).join(', ')}]`,
        estimatedCost: estimatedScan,
      });

      if (!indexCovers && spec.filter) {
        steps.push({
          type: 'filter',
          description: 'Apply remaining filter conditions',
          estimatedCost: estimatedScan * 0.5,
        });
      }
    } else {
      steps.push({
        type: 'collection-scan',
        description: 'Full collection scan',
        estimatedCost: Infinity,
      });

      if (spec.filter) {
        steps.push({
          type: 'filter',
          description: 'Apply filter conditions',
          estimatedCost: Infinity,
        });
      }
    }

    if (spec.sort && !sortUsingIndex) {
      steps.push({
        type: 'sort',
        description: `Sort by ${spec.sort.map((s) => `${s.field} ${s.direction}`).join(', ')}`,
        estimatedCost: 100, // Sorting cost
      });
    }

    if (spec.skip && spec.skip > 0) {
      steps.push({
        type: 'skip',
        description: `Skip ${spec.skip} documents`,
        estimatedCost: 1,
      });
    }

    if (spec.limit && spec.limit > 0) {
      steps.push({
        type: 'limit',
        description: `Limit to ${spec.limit} documents`,
        estimatedCost: 1,
      });
    }

    return {
      indexName: selectedIndex?.name ?? null,
      indexCovers,
      estimatedScan: selectedIndex ? estimatedScan : Infinity,
      sortUsingIndex,
      steps,
    };
  }

  /**
   * Extract fields used in a filter
   */
  private extractFilterFields(filter: QueryFilter<T>): Set<string> {
    const fields = new Set<string>();

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operator
        if (key === '$and' || key === '$or' || key === '$nor') {
          const subFilters = value as QueryFilter<T>[];
          for (const subFilter of subFilters) {
            const subFields = this.extractFilterFields(subFilter);
            subFields.forEach((f) => fields.add(f));
          }
        } else if (key === '$not') {
          const subFields = this.extractFilterFields(value as QueryFilter<T>);
          subFields.forEach((f) => fields.add(f));
        }
      } else {
        fields.add(key);
      }
    }

    return fields;
  }

  /**
   * Score indexes for a query
   */
  private scoreIndexes(filterFields: Set<string>, sort?: QuerySpec<T>['sort']): IndexScore[] {
    const scores: IndexScore[] = [];

    for (const index of this.indexes) {
      let score = 0;
      let covers = true;
      let sortMatch = false;
      let matchedFields = 0;

      // Check how many filter fields the index covers
      for (const indexField of index.fields) {
        if (filterFields.has(indexField.field)) {
          matchedFields++;
          score += 10;
        } else {
          // Index field not in filter - can't use further fields efficiently
          break;
        }
      }

      // Check if index covers all filter fields
      covers = matchedFields === filterFields.size;

      // Bonus for covering all fields
      if (covers) {
        score += 5;
      }

      // Check if index can be used for sorting
      if (sort && sort.length > 0) {
        const firstSort = sort[0]!;
        const lastMatchedIndex = matchedFields;
        const nextIndexField = index.fields[lastMatchedIndex];

        if (nextIndexField && nextIndexField.field === firstSort.field) {
          sortMatch = true;
          score += 3;
        } else if (
          index.fields[0] &&
          index.fields[0].field === firstSort.field &&
          filterFields.size === 0
        ) {
          sortMatch = true;
          score += 3;
        }
      }

      // Unique indexes get a small bonus
      if (index.unique) {
        score += 1;
      }

      if (score > 0) {
        scores.push({
          index,
          score,
          covers,
          sortMatch,
          estimatedScan: this.estimateScanSize(matchedFields, filterFields.size),
        });
      }
    }

    return scores;
  }

  /**
   * Estimate scan size based on index match
   */
  private estimateScanSize(matchedFields: number, totalFields: number): number {
    if (matchedFields === 0) return Infinity;
    // More matched fields = smaller estimated scan
    const matchRatio = matchedFields / Math.max(totalFields, 1);
    return Math.round(1000 * (1 - matchRatio * 0.9));
  }
}

/**
 * Index score for planning
 */
interface IndexScore {
  index: NormalizedIndex;
  score: number;
  covers: boolean;
  sortMatch: boolean;
  estimatedScan: number;
}

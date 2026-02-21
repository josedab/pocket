import type {
  AggregateResult,
  CompiledQuery,
  JoinedResult,
  PocketQLConfig,
} from './types.js';

/**
 * Query executor interface.
 */
export interface QueryExecutor {
  execute<T>(compiled: CompiledQuery<T>, data: T[]): T[];
  executeAggregate<T>(compiled: CompiledQuery<T>, data: T[]): AggregateResult;
  executeJoin<T>(compiled: CompiledQuery<T>, leftData: T[], rightData: Record<string, unknown>[]): JoinedResult[];
}

/**
 * Creates a query executor with the given configuration.
 */
export function createPocketQLExecutor(_config: PocketQLConfig = {}): QueryExecutor {
  return {
    execute<T>(compiled: CompiledQuery<T>, data: T[]): T[] {
      let results = data.filter(compiled.filterFn);

      if (compiled.sortFn) {
        results = [...results].sort(compiled.sortFn);
      }

      const skip = compiled.expression.skip;
      const limit = compiled.expression.limit;

      if (skip !== null && skip > 0) {
        results = results.slice(skip);
      }

      if (limit !== null) {
        results = results.slice(0, limit);
      }

      if (compiled.projectFn) {
        results = results.map(compiled.projectFn) as T[];
      }

      return results;
    },

    executeAggregate<T>(compiled: CompiledQuery<T>, data: T[]): AggregateResult {
      const filtered = data.filter(compiled.filterFn);
      const result: Record<string, number> = {};

      for (const agg of compiled.expression.aggregates) {
        const values = filtered.map(
          (item) => (item as Record<string, unknown>)[agg.field] as number,
        );

        switch (agg.operation) {
          case 'count':
            result[agg.alias] = values.length;
            break;
          case 'sum':
            result[agg.alias] = values.reduce((acc, v) => acc + v, 0);
            break;
          case 'avg':
            result[agg.alias] = values.length > 0
              ? values.reduce((acc, v) => acc + v, 0) / values.length
              : 0;
            break;
          case 'min':
            result[agg.alias] = values.length > 0 ? Math.min(...values) : 0;
            break;
          case 'max':
            result[agg.alias] = values.length > 0 ? Math.max(...values) : 0;
            break;
        }
      }

      return result;
    },

    executeJoin<T>(compiled: CompiledQuery<T>, leftData: T[], rightData: Record<string, unknown>[]): JoinedResult[] {
      const results: JoinedResult[] = [];

      for (const join of compiled.expression.joins) {
        for (const left of leftData) {
          const leftVal = (left as Record<string, unknown>)[join.localField];
          const matches = rightData.filter(
            (right) => right[join.foreignField] === leftVal,
          );

          if (join.type === 'inner') {
            for (const match of matches) {
              results.push({ ...left as Record<string, unknown>, [join.as]: match });
            }
          } else {
            if (matches.length > 0) {
              for (const match of matches) {
                results.push({ ...left as Record<string, unknown>, [join.as]: match });
              }
            } else {
              results.push({ ...left as Record<string, unknown>, [join.as]: null });
            }
          }
        }
      }

      return results;
    },
  };
}

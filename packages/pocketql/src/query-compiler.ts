import type {
  CompiledQuery,
  PocketQLConfig,
  QueryExpression,
  QueryPlan,
  QueryStep,
  ValidationResult,
  WhereClause,
} from './types.js';

function evaluateCondition<T>(item: T, clause: WhereClause<T>): boolean {
  const fieldValue = (item as Record<string, unknown>)[clause.field];

  switch (clause.operator) {
    case 'eq':
      return fieldValue === clause.value;
    case 'ne':
      return fieldValue !== clause.value;
    case 'gt':
      return (fieldValue as number) > (clause.value as number);
    case 'gte':
      return (fieldValue as number) >= (clause.value as number);
    case 'lt':
      return (fieldValue as number) < (clause.value as number);
    case 'lte':
      return (fieldValue as number) <= (clause.value as number);
    case 'in':
      return Array.isArray(clause.value) && clause.value.includes(fieldValue);
    case 'nin':
      return Array.isArray(clause.value) && !clause.value.includes(fieldValue);
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(clause.value as string);
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(clause.value as string);
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(clause.value as string);
    case 'exists':
      return clause.value ? fieldValue !== undefined && fieldValue !== null : fieldValue === undefined || fieldValue === null;
    case 'regex':
      return typeof fieldValue === 'string' && new RegExp(clause.value as string).test(fieldValue);
    default:
      return false;
  }
}

/**
 * Query compiler interface.
 */
export interface QueryCompiler {
  compile<T>(expression: QueryExpression<T>): CompiledQuery<T>;
  explain<T>(expression: QueryExpression<T>): QueryPlan;
  validate<T>(expression: QueryExpression<T>): ValidationResult;
  optimize<T>(expression: QueryExpression<T>): QueryExpression<T>;
}

/**
 * Creates a query compiler with the given configuration.
 */
export function createQueryCompiler(config: PocketQLConfig = {}): QueryCompiler {
  return {
    compile<T>(expression: QueryExpression<T>): CompiledQuery<T> {
      const filterFn = (item: T): boolean => {
        for (const clause of expression.where) {
          if (!evaluateCondition(item, clause)) return false;
        }

        for (const group of expression.logicalGroups) {
          if (group.type === 'and') {
            const allMatch = group.clauses.every((c) => evaluateCondition(item, c));
            if (!allMatch) return false;
          } else {
            const anyMatch = group.clauses.some((c) => evaluateCondition(item, c));
            if (!anyMatch) return false;
          }
        }

        return true;
      };

      const sortFn = expression.sort.length > 0
        ? (a: T, b: T): number => {
            for (const s of expression.sort) {
              const aVal = (a as Record<string, unknown>)[s.field] as string | number;
              const bVal = (b as Record<string, unknown>)[s.field] as string | number;
              if (aVal < bVal) return s.direction === 'asc' ? -1 : 1;
              if (aVal > bVal) return s.direction === 'asc' ? 1 : -1;
            }
            return 0;
          }
        : null;

      const projectFn = expression.projection
        ? (item: T): Partial<T> => {
            const result: Partial<T> = {};
            for (const key of Object.keys(expression.projection!) as (keyof T & string)[]) {
              if ((expression.projection as Record<string, boolean>)[key]) {
                result[key] = (item as Record<string, unknown>)[key] as T[keyof T & string];
              }
            }
            return result;
          }
        : null;

      return { expression, filterFn, sortFn, projectFn };
    },

    explain<T>(expression: QueryExpression<T>): QueryPlan {
      const steps: QueryStep[] = [];
      let estimatedCost = 1;

      steps.push({
        type: 'scan',
        description: `Full scan of ${expression.collection}`,
        collection: expression.collection,
      });

      if (expression.where.length > 0) {
        estimatedCost += expression.where.length;
        steps.push({
          type: 'filter',
          description: `Apply ${expression.where.length} filter condition(s)`,
        });
      }

      if (expression.logicalGroups.length > 0) {
        estimatedCost += expression.logicalGroups.length;
        steps.push({
          type: 'filter',
          description: `Apply ${expression.logicalGroups.length} logical group(s)`,
        });
      }

      if (expression.joins.length > 0) {
        estimatedCost += expression.joins.length * 5;
        for (const join of expression.joins) {
          steps.push({
            type: 'join',
            description: `${join.type} join with ${join.collection}`,
            collection: join.collection,
          });
        }
      }

      if (expression.sort.length > 0) {
        estimatedCost += 2;
        steps.push({
          type: 'sort',
          description: `Sort by ${expression.sort.map((s) => `${s.field} ${s.direction}`).join(', ')}`,
        });
      }

      if (expression.groupBy) {
        estimatedCost += 3;
        steps.push({
          type: 'groupBy',
          description: `Group by ${expression.groupBy.fields.join(', ')}`,
        });
      }

      if (expression.aggregates.length > 0) {
        estimatedCost += expression.aggregates.length;
        steps.push({
          type: 'aggregate',
          description: `Compute ${expression.aggregates.map((a) => `${a.operation}(${a.field})`).join(', ')}`,
        });
      }

      if (expression.projection) {
        steps.push({
          type: 'project',
          description: 'Apply field projection',
        });
      }

      if (expression.skip !== null) {
        steps.push({
          type: 'skip',
          description: `Skip ${expression.skip} result(s)`,
        });
      }

      if (expression.limit !== null) {
        steps.push({
          type: 'limit',
          description: `Limit to ${expression.limit} result(s)`,
        });
      }

      return { steps, estimatedCost, usesIndex: false };
    },

    validate<T>(expression: QueryExpression<T>): ValidationResult {
      const errors: string[] = [];

      if (!expression.collection) {
        errors.push('Collection name is required');
      }

      if (config.strict) {
        if (expression.limit !== null && expression.limit <= 0) {
          errors.push('Limit must be a positive number');
        }

        if (expression.skip !== null && expression.skip < 0) {
          errors.push('Skip must be a non-negative number');
        }
      }

      if (config.maxResults && expression.limit !== null && expression.limit > config.maxResults) {
        errors.push(`Limit exceeds maximum allowed results (${config.maxResults})`);
      }

      for (const join of expression.joins) {
        if (!join.collection) {
          errors.push('Join must specify a target collection');
        }
        if (!join.localField || !join.foreignField) {
          errors.push('Join must specify localField and foreignField');
        }
      }

      return { valid: errors.length === 0, errors };
    },

    optimize<T>(expression: QueryExpression<T>): QueryExpression<T> {
      const optimizedWhere = [...expression.where];

      // Move equality checks to the front for potential index usage
      optimizedWhere.sort((a, b) => {
        if (a.operator === 'eq' && b.operator !== 'eq') return -1;
        if (a.operator !== 'eq' && b.operator === 'eq') return 1;
        return 0;
      });

      return {
        ...expression,
        where: optimizedWhere,
      };
    },
  };
}

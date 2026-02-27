/**
 * Execution bridge compiling PQL AST to @pocket/core query builder calls.
 */
import type { PQLQuery, SelectColumn, WhereCondition } from './parser.js';

export interface ExecutionPlan {
  collection: string;
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  projection: string[];
  limit?: number;
  offset?: number;
  aggregations: { field: string; op: string; alias: string }[];
  groupBy?: string[];
  joins: { collection: string; localField: string; foreignField: string; type: string }[];
}

export interface ExecutionResult<T = Record<string, unknown>> {
  data: T[];
  metadata: {
    collection: string;
    rowCount: number;
    executionMs: number;
    plan: ExecutionPlan;
  };
}

export type CollectionQueryFn = (
  collection: string,
  options: {
    filter?: Record<string, unknown>;
    sort?: Record<string, 1 | -1>;
    limit?: number;
    offset?: number;
    projection?: string[];
  }
) => Promise<Record<string, unknown>[]>;

/**
 * Compiles a PQL AST into an execution plan and executes it.
 */
export class ExecutionBridge {
  private readonly queryFn: CollectionQueryFn;

  constructor(queryFn: CollectionQueryFn) {
    this.queryFn = queryFn;
  }

  /** Compile a PQL AST into an execution plan */
  compile(query: PQLQuery): ExecutionPlan {
    return {
      collection: query.from.collection,
      filter: query.where ? this.compileWhere(query.where) : {},
      sort: this.compileOrderBy(query.orderBy),
      projection: this.compileProjection(query.columns),
      limit: query.limit,
      offset: query.offset,
      aggregations: query.columns
        .filter((c): c is SelectColumn & { func: string } => c.type === 'aggregate' && !!c.func)
        .map((c) => ({ field: c.name ?? '*', op: c.func ?? '', alias: c.alias ?? c.name ?? '' })),
      groupBy: query.groupBy,
      joins: query.joins.map((j) => ({
        collection: j.collection,
        localField: (j.on?.left as { name?: string } | undefined)?.name ?? '',
        foreignField: (j.on?.right as { name?: string } | undefined)?.name ?? '',
        type: j.joinType,
      })),
    };
  }

  /** Execute a PQL query */
  async execute<T = Record<string, unknown>>(query: PQLQuery): Promise<ExecutionResult<T>> {
    const start = Date.now();
    const plan = this.compile(query);

    // Execute main collection query
    let rows = await this.queryFn(plan.collection, {
      filter: plan.filter,
      sort: plan.sort,
      limit: plan.limit,
      offset: plan.offset,
      projection: plan.projection.length > 0 ? plan.projection : undefined,
    });

    // Execute joins
    for (const join of plan.joins) {
      const joinedRows: Record<string, unknown>[] = [];
      for (const row of rows) {
        const localValue = row[join.localField];
        const joinFilter: Record<string, unknown> = {};
        const foreignField = join.foreignField.includes('.')
          ? join.foreignField.split('.').pop()!
          : join.foreignField;
        joinFilter[foreignField] = localValue;

        const joinResults = await this.queryFn(join.collection, { filter: joinFilter });

        if (joinResults.length > 0) {
          for (const jr of joinResults) {
            joinedRows.push({ ...row, ...this.prefixKeys(jr, join.collection) });
          }
        } else if (join.type === 'LEFT') {
          joinedRows.push(row);
        }
      }
      rows =
        joinedRows.length > 0 ? joinedRows : plan.joins.every((j) => j.type === 'LEFT') ? rows : [];
    }

    // Apply aggregations
    if (plan.aggregations.length > 0) {
      rows = this.applyAggregations(rows, plan.aggregations, plan.groupBy);
    }

    // Apply projection
    if (plan.projection.length > 0 && plan.aggregations.length === 0) {
      rows = rows.map((row) => {
        const projected: Record<string, unknown> = {};
        for (const col of plan.projection) {
          projected[col] = row[col];
        }
        return projected;
      });
    }

    return {
      data: rows as T[],
      metadata: {
        collection: plan.collection,
        rowCount: rows.length,
        executionMs: Date.now() - start,
        plan,
      },
    };
  }

  private compileWhere(condition: WhereCondition): Record<string, unknown> {
    if (condition.logicalOp && condition.conditions) {
      const compiled = condition.conditions.map((c) => this.compileWhere(c));
      if (condition.logicalOp === 'AND') {
        return Object.assign({}, ...compiled);
      }
      return { $or: compiled };
    }

    if (condition.operator && condition.left && condition.right) {
      const field = (condition.left as { name?: string }).name ?? '';
      const value = (condition.right as { value?: unknown }).value;
      const values = (condition.right as { values?: unknown[] }).values;

      switch (condition.operator) {
        case '=':
          return { [field]: value };
        case '!=':
          return { [field]: { $ne: value } };
        case '<':
          return { [field]: { $lt: value } };
        case '>':
          return { [field]: { $gt: value } };
        case '<=':
          return { [field]: { $lte: value } };
        case '>=':
          return { [field]: { $gte: value } };
        case 'IN':
          return { [field]: { $in: values } };
        case 'LIKE':
          return { [field]: { $regex: String(value).replace(/%/g, '.*') } };
        case 'IS NULL':
          return { [field]: null };
        case 'IS NOT NULL':
          return { [field]: { $ne: null } };
        default:
          return { [field]: value };
      }
    }

    return {};
  }

  private compileOrderBy(orderBy: PQLQuery['orderBy']): Record<string, 1 | -1> {
    const sort: Record<string, 1 | -1> = {};
    for (const clause of orderBy) {
      sort[clause.field] = clause.direction === 'DESC' ? -1 : 1;
    }
    return sort;
  }

  private compileProjection(columns: SelectColumn[]): string[] {
    if (columns.some((c) => c.type === 'star')) return [];
    return columns
      .filter((c) => c.type === 'column')
      .map((c) => c.alias ?? c.name ?? '')
      .filter(Boolean);
  }

  private applyAggregations(
    rows: Record<string, unknown>[],
    aggregations: { field: string; op: string; alias: string }[],
    groupBy?: string[]
  ): Record<string, unknown>[] {
    if (!groupBy || groupBy.length === 0) {
      const result: Record<string, unknown> = {};
      for (const agg of aggregations) {
        result[agg.alias] = this.computeAggregate(rows, agg.field, agg.op);
      }
      return [result];
    }

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = groupBy.map((f) => String(row[f])).join('::');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const results: Record<string, unknown>[] = [];
    for (const [, groupRows] of groups) {
      const result: Record<string, unknown> = {};
      for (const field of groupBy) {
        result[field] = groupRows[0]?.[field];
      }
      for (const agg of aggregations) {
        result[agg.alias] = this.computeAggregate(groupRows, agg.field, agg.op);
      }
      results.push(result);
    }
    return results;
  }

  private computeAggregate(rows: Record<string, unknown>[], field: string, op: string): unknown {
    if (op === 'COUNT') return rows.length;
    const values = rows.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return null;
    switch (op) {
      case 'SUM':
        return values.reduce((a, b) => a + b, 0);
      case 'AVG':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'MIN':
        return Math.min(...values);
      case 'MAX':
        return Math.max(...values);
      default:
        return null;
    }
  }

  private prefixKeys(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[`${prefix}.${key}`] = value;
    }
    return result;
  }
}

export function createExecutionBridge(queryFn: CollectionQueryFn): ExecutionBridge {
  return new ExecutionBridge(queryFn);
}

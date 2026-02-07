import type {
  AggregateClause,
  ComparisonOperator,
  JoinClause,
  LogicalGroup,
  ProjectionSpec,
  QueryExpression,
  SortClause,
  WhereClause,
} from './types.js';

/**
 * Type-safe query builder with chainable API.
 */
export interface QueryBuilder<T> {
  where(field: keyof T & string, operator: ComparisonOperator, value: unknown): QueryBuilder<T>;
  and(...clauses: WhereClause<T>[]): QueryBuilder<T>;
  or(...clauses: WhereClause<T>[]): QueryBuilder<T>;
  select(...fields: (keyof T & string)[]): QueryBuilder<T>;
  orderBy(field: keyof T & string, direction?: 'asc' | 'desc'): QueryBuilder<T>;
  limit(n: number): QueryBuilder<T>;
  skip(n: number): QueryBuilder<T>;
  groupBy(...fields: (keyof T & string)[]): QueryBuilder<T>;
  aggregate(field: keyof T & string, operation: AggregateClause<T>['operation'], alias: string): QueryBuilder<T>;
  join(options: JoinClause): QueryBuilder<T>;
  build(): QueryExpression<T>;
  toString(): string;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  return String(value);
}

function formatWhere<T>(clause: WhereClause<T>): string {
  return `${clause.field} ${clause.operator} ${formatValue(clause.value)}`;
}

/**
 * Creates a type-safe query builder for the given collection.
 */
export function createQueryBuilder<T>(collection: string): QueryBuilder<T> {
  const state = {
    collection,
    where: [] as WhereClause<T>[],
    logicalGroups: [] as LogicalGroup<T>[],
    sort: [] as SortClause<T>[],
    projection: null as ProjectionSpec<T> | null,
    aggregates: [] as AggregateClause<T>[],
    groupBy: null as { fields: (keyof T & string)[]; having?: WhereClause<T> } | null,
    joins: [] as JoinClause[],
    limit: null as number | null,
    skip: null as number | null,
  };

  const builder: QueryBuilder<T> = {
    where(field: keyof T & string, operator: ComparisonOperator, value: unknown): QueryBuilder<T> {
      state.where.push({ field, operator, value });
      return builder;
    },

    and(...clauses: WhereClause<T>[]): QueryBuilder<T> {
      state.logicalGroups.push({ type: 'and', clauses });
      return builder;
    },

    or(...clauses: WhereClause<T>[]): QueryBuilder<T> {
      state.logicalGroups.push({ type: 'or', clauses });
      return builder;
    },

    select(...fields: (keyof T & string)[]): QueryBuilder<T> {
      const projection: ProjectionSpec<T> = {};
      for (const f of fields) {
        (projection as Record<string, boolean>)[f as string] = true;
      }
      state.projection = projection;
      return builder;
    },

    orderBy(field: keyof T & string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<T> {
      state.sort.push({ field, direction });
      return builder;
    },

    limit(n: number): QueryBuilder<T> {
      state.limit = n;
      return builder;
    },

    skip(n: number): QueryBuilder<T> {
      state.skip = n;
      return builder;
    },

    groupBy(...fields: (keyof T & string)[]): QueryBuilder<T> {
      state.groupBy = { fields };
      return builder;
    },

    aggregate(field: keyof T & string, operation: AggregateClause<T>['operation'], alias: string): QueryBuilder<T> {
      state.aggregates.push({ field, operation, alias });
      return builder;
    },

    join(options: JoinClause): QueryBuilder<T> {
      state.joins.push(options);
      return builder;
    },

    build(): QueryExpression<T> {
      return {
        collection: state.collection,
        where: [...state.where],
        logicalGroups: [...state.logicalGroups],
        sort: [...state.sort],
        projection: state.projection ? { ...state.projection } : null,
        aggregates: [...state.aggregates],
        groupBy: state.groupBy
          ? { fields: [...state.groupBy.fields], having: state.groupBy.having }
          : null,
        joins: [...state.joins],
        limit: state.limit,
        skip: state.skip,
      };
    },

    toString(): string {
      const parts: string[] = [];

      if (state.projection) {
        const fields = Object.keys(state.projection).filter(
          (k) => (state.projection as Record<string, boolean>)[k],
        );
        parts.push(`SELECT ${fields.join(', ')}`);
      } else {
        parts.push('SELECT *');
      }

      parts.push(`FROM ${state.collection}`);

      for (const join of state.joins) {
        parts.push(`${join.type.toUpperCase()} JOIN ${join.collection} ON ${join.localField} = ${join.foreignField} AS ${join.as}`);
      }

      const whereParts: string[] = [];
      for (const w of state.where) {
        whereParts.push(formatWhere(w));
      }
      for (const group of state.logicalGroups) {
        const grouped = group.clauses.map(formatWhere).join(` ${group.type.toUpperCase()} `);
        whereParts.push(`(${grouped})`);
      }
      if (whereParts.length > 0) {
        parts.push(`WHERE ${whereParts.join(' AND ')}`);
      }

      if (state.groupBy) {
        parts.push(`GROUP BY ${state.groupBy.fields.join(', ')}`);
      }

      for (const agg of state.aggregates) {
        parts.push(`${agg.operation.toUpperCase()}(${agg.field}) AS ${agg.alias}`);
      }

      for (const s of state.sort) {
        parts.push(`ORDER BY ${s.field} ${s.direction.toUpperCase()}`);
      }

      if (state.limit !== null) {
        parts.push(`LIMIT ${state.limit}`);
      }

      if (state.skip !== null) {
        parts.push(`SKIP ${state.skip}`);
      }

      return parts.join(' ');
    },
  };

  return builder;
}

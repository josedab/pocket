/**
 * Visual Query Builder — fluent, reactive query builder for Pocket Studio.
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith'
  | 'exists' | 'regex';

export interface VisualQueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface VisualQuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface VisualQueryJoin {
  collection: string;
  localField: string;
  foreignField: string;
  type: 'inner' | 'left';
}

export interface VisualQueryAggregate {
  field: string;
  fn: string;
  alias: string;
}

export interface VisualQuerySpec {
  collection: string;
  filters: VisualQueryFilter[];
  sorts: VisualQuerySort[];
  joins: VisualQueryJoin[];
  fields?: string[];
  groupBy?: string[];
  aggregates?: VisualQueryAggregate[];
  limit?: number;
  skip?: number;
}

export interface VisualQueryState {
  spec: VisualQuerySpec;
  isValid: boolean;
  errors: string[];
  generatedCode: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptySpec(): VisualQuerySpec {
  return {
    collection: '',
    filters: [],
    sorts: [],
    joins: [],
  };
}

function validate(spec: VisualQuerySpec): string[] {
  const errors: string[] = [];
  if (!spec.collection) errors.push('Collection is required');
  for (const f of spec.filters) {
    if (!f.field) errors.push('Filter field is required');
  }
  if (spec.limit !== undefined && spec.limit < 0) {
    errors.push('Limit must be non-negative');
  }
  if (spec.skip !== undefined && spec.skip < 0) {
    errors.push('Skip must be non-negative');
  }
  return errors;
}

function generateCode(spec: VisualQuerySpec): string {
  if (!spec.collection) return '';
  const lines: string[] = [];
  lines.push(`db.collection('${spec.collection}')`);

  if (spec.fields && spec.fields.length > 0) {
    lines.push(`  .select(${JSON.stringify(spec.fields)})`);
  }
  for (const f of spec.filters) {
    lines.push(`  .where('${f.field}', '${f.operator}', ${JSON.stringify(f.value)})`);
  }
  for (const j of spec.joins) {
    lines.push(`  .join('${j.collection}', '${j.localField}', '${j.foreignField}', '${j.type}')`);
  }
  if (spec.groupBy && spec.groupBy.length > 0) {
    lines.push(`  .groupBy(${JSON.stringify(spec.groupBy)})`);
  }
  if (spec.aggregates) {
    for (const a of spec.aggregates) {
      lines.push(`  .aggregate('${a.field}', '${a.fn}', '${a.alias}')`);
    }
  }
  for (const s of spec.sorts) {
    lines.push(`  .sort('${s.field}', '${s.direction}')`);
  }
  if (spec.skip !== undefined) {
    lines.push(`  .skip(${spec.skip})`);
  }
  if (spec.limit !== undefined) {
    lines.push(`  .limit(${spec.limit})`);
  }
  lines.push('  .execute();');
  return lines.join('\n');
}

function generatePocketQL(spec: VisualQuerySpec): string {
  if (!spec.collection) return '';
  const parts: string[] = [];

  // SELECT
  if (spec.fields && spec.fields.length > 0) {
    parts.push(`SELECT ${spec.fields.join(', ')}`);
  } else {
    parts.push('SELECT *');
  }

  // FROM
  parts.push(`FROM ${spec.collection}`);

  // JOIN
  for (const j of spec.joins) {
    const joinType = j.type === 'left' ? 'LEFT JOIN' : 'JOIN';
    parts.push(`${joinType} ${j.collection} ON ${j.localField} = ${j.foreignField}`);
  }

  // WHERE
  if (spec.filters.length > 0) {
    const conditions = spec.filters.map((f) => {
      const val = typeof f.value === 'string' ? `'${f.value}'` : String(f.value);
      const opMap: Record<string, string> = {
        eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
        contains: 'CONTAINS', startsWith: 'STARTS_WITH', endsWith: 'ENDS_WITH',
        in: 'IN', nin: 'NOT IN', exists: 'EXISTS', regex: 'REGEX',
      };
      return `${f.field} ${opMap[f.operator] ?? '='} ${val}`;
    });
    parts.push(`WHERE ${conditions.join(' AND ')}`);
  }

  // GROUP BY
  if (spec.groupBy && spec.groupBy.length > 0) {
    parts.push(`GROUP BY ${spec.groupBy.join(', ')}`);
  }

  // ORDER BY
  if (spec.sorts.length > 0) {
    const sortParts = spec.sorts.map((s) => `${s.field} ${s.direction.toUpperCase()}`);
    parts.push(`ORDER BY ${sortParts.join(', ')}`);
  }

  // LIMIT / OFFSET
  if (spec.limit !== undefined) parts.push(`LIMIT ${spec.limit}`);
  if (spec.skip !== undefined) parts.push(`OFFSET ${spec.skip}`);

  return parts.join(' ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesFilter(record: any, filter: VisualQueryFilter): boolean {
  const val = record[filter.field];
  switch (filter.operator) {
    case 'eq': return val === filter.value;
    case 'neq': return val !== filter.value;
    case 'gt': return val > (filter.value as number);
    case 'gte': return val >= (filter.value as number);
    case 'lt': return val < (filter.value as number);
    case 'lte': return val <= (filter.value as number);
    case 'in': return Array.isArray(filter.value) && (filter.value as unknown[]).includes(val);
    case 'nin': return Array.isArray(filter.value) && !(filter.value as unknown[]).includes(val);
    case 'contains': return typeof val === 'string' && val.includes(filter.value as string);
    case 'startsWith': return typeof val === 'string' && val.startsWith(filter.value as string);
    case 'endsWith': return typeof val === 'string' && val.endsWith(filter.value as string);
    case 'exists': return filter.value ? val !== undefined && val !== null : val === undefined || val === null;
    case 'regex': return typeof val === 'string' && new RegExp(filter.value as string).test(val);
    default: return true;
  }
}

// ─── VisualQueryBuilder ──────────────────────────────────────────────────────

export class VisualQueryBuilder {
  private spec: VisualQuerySpec;
  private readonly _state$: BehaviorSubject<VisualQueryState>;

  constructor() {
    this.spec = emptySpec();
    this._state$ = new BehaviorSubject<VisualQueryState>(this.buildState());
  }

  setCollection(name: string): this {
    this.spec.collection = name;
    this.emitState();
    return this;
  }

  addFilter(field: string, operator: FilterOperator, value: unknown): this {
    this.spec.filters.push({ field, operator, value });
    this.emitState();
    return this;
  }

  removeFilter(index: number): this {
    if (index >= 0 && index < this.spec.filters.length) {
      this.spec.filters.splice(index, 1);
      this.emitState();
    }
    return this;
  }

  addSort(field: string, direction: 'asc' | 'desc'): this {
    this.spec.sorts.push({ field, direction });
    this.emitState();
    return this;
  }

  removeSort(index: number): this {
    if (index >= 0 && index < this.spec.sorts.length) {
      this.spec.sorts.splice(index, 1);
      this.emitState();
    }
    return this;
  }

  setLimit(limit: number): this {
    this.spec.limit = limit;
    this.emitState();
    return this;
  }

  setSkip(skip: number): this {
    this.spec.skip = skip;
    this.emitState();
    return this;
  }

  addJoin(
    collection: string,
    localField: string,
    foreignField: string,
    type: 'inner' | 'left',
  ): this {
    this.spec.joins.push({ collection, localField, foreignField, type });
    this.emitState();
    return this;
  }

  removeJoin(index: number): this {
    if (index >= 0 && index < this.spec.joins.length) {
      this.spec.joins.splice(index, 1);
      this.emitState();
    }
    return this;
  }

  selectFields(fields: string[]): this {
    this.spec.fields = [...fields];
    this.emitState();
    return this;
  }

  addGroupBy(field: string): this {
    if (!this.spec.groupBy) this.spec.groupBy = [];
    this.spec.groupBy.push(field);
    this.emitState();
    return this;
  }

  addAggregate(
    field: string,
    fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
    alias: string,
  ): this {
    if (!this.spec.aggregates) this.spec.aggregates = [];
    this.spec.aggregates.push({ field, fn, alias });
    this.emitState();
    return this;
  }

  build(): VisualQuerySpec {
    return JSON.parse(JSON.stringify(this.spec));
  }

  toCode(): string {
    return generateCode(this.spec);
  }

  toPocketQL(): string {
    return generatePocketQL(this.spec);
  }

  toJSON(): object {
    return JSON.parse(JSON.stringify(this.spec));
  }

  preview(sampleData: unknown[]): unknown[] {
    let results = [...sampleData] as Record<string, unknown>[];

    // Apply filters
    for (const filter of this.spec.filters) {
      results = results.filter((r) => matchesFilter(r, filter));
    }

    // Apply sorts
    if (this.spec.sorts.length > 0) {
      results.sort((a, b) => {
        for (const s of this.spec.sorts) {
          const aVal = a[s.field] as string | number;
          const bVal = b[s.field] as string | number;
          if (aVal < bVal) return s.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return s.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    // Apply skip
    if (this.spec.skip !== undefined && this.spec.skip > 0) {
      results = results.slice(this.spec.skip);
    }

    // Apply limit
    if (this.spec.limit !== undefined) {
      results = results.slice(0, this.spec.limit);
    }

    // Apply field selection
    if (this.spec.fields && this.spec.fields.length > 0) {
      const fields = this.spec.fields;
      results = results.map((r) => {
        const picked: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in r) picked[f] = r[f];
        }
        return picked;
      });
    }

    return results;
  }

  reset(): this {
    this.spec = emptySpec();
    this.emitState();
    return this;
  }

  get state$(): Observable<VisualQueryState> {
    return this._state$.asObservable();
  }

  destroy(): void {
    this._state$.complete();
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private buildState(): VisualQueryState {
    const errors = validate(this.spec);
    return {
      spec: JSON.parse(JSON.stringify(this.spec)),
      isValid: errors.length === 0,
      errors,
      generatedCode: generateCode(this.spec),
    };
  }

  private emitState(): void {
    this._state$.next(this.buildState());
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Create a VisualQueryBuilder instance. */
export function createVisualQueryBuilder(): VisualQueryBuilder {
  return new VisualQueryBuilder();
}

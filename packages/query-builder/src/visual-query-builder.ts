/**
 * VisualQueryBuilder — Programmatic query construction with code export.
 *
 * Powers a drag-and-drop query builder UI by providing a structured
 * query model that can be serialized, previewed, and exported as code.
 */

// ── Types ──────────────────────────────────────────────────

export interface VisualFilter {
  id: string;
  field: string;
  operator: VisualOperator;
  value: unknown;
  enabled: boolean;
}

export type VisualOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'startsWith'
  | 'exists';

export interface VisualSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface VisualQuerySpec {
  collection: string;
  filters: VisualFilter[];
  sorts: VisualSort[];
  limit: number | null;
  skip: number | null;
  projection: string[] | null;
}

export interface CodeExportResult {
  typescript: string;
  json: string;
  curl: string;
}

export interface QueryPreview {
  model: VisualQuerySpec;
  filterObject: Record<string, unknown>;
  sortObject: Record<string, 'asc' | 'desc'>;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  fieldCount: number;
}

// ── Implementation ────────────────────────────────────────

export class VisualQueryBuilder {
  private collection = '';
  private filters: VisualFilter[] = [];
  private sorts: VisualSort[] = [];
  private _limit: number | null = null;
  private _skip: number | null = null;
  private _projection: string[] | null = null;
  private filterCounter = 0;

  setCollection(name: string): this {
    this.collection = name;
    return this;
  }

  addFilter(field: string, operator: VisualOperator, value: unknown): string {
    const id = `filter_${++this.filterCounter}`;
    this.filters.push({ id, field, operator, value, enabled: true });
    return id;
  }

  removeFilter(id: string): boolean {
    const idx = this.filters.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this.filters.splice(idx, 1);
    return true;
  }

  toggleFilter(id: string): boolean {
    const filter = this.filters.find((f) => f.id === id);
    if (!filter) return false;
    filter.enabled = !filter.enabled;
    return true;
  }

  updateFilter(id: string, updates: Partial<Omit<VisualFilter, 'id'>>): boolean {
    const filter = this.filters.find((f) => f.id === id);
    if (!filter) return false;
    Object.assign(filter, updates);
    return true;
  }

  addSort(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.sorts = this.sorts.filter((s) => s.field !== field);
    this.sorts.push({ field, direction });
    return this;
  }

  removeSort(field: string): this {
    this.sorts = this.sorts.filter((s) => s.field !== field);
    return this;
  }

  setLimit(limit: number | null): this {
    this._limit = limit;
    return this;
  }
  setSkip(skip: number | null): this {
    this._skip = skip;
    return this;
  }
  setProjection(fields: string[] | null): this {
    this._projection = fields;
    return this;
  }

  /**
   * Get the current query model.
   */
  getModel(): VisualQuerySpec {
    return {
      collection: this.collection,
      filters: [...this.filters],
      sorts: [...this.sorts],
      limit: this._limit,
      skip: this._skip,
      projection: this._projection ? [...this._projection] : null,
    };
  }

  /**
   * Preview the query — see what filter/sort objects will be generated.
   */
  preview(): QueryPreview {
    const model = this.getModel();
    const filterObj = this.buildFilterObject();
    const sortObj: Record<string, 'asc' | 'desc'> = {};
    for (const s of this.sorts) sortObj[s.field] = s.direction;

    const activeFilters = this.filters.filter((f) => f.enabled).length;
    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    if (activeFilters > 3 || this.sorts.length > 1) complexity = 'moderate';
    if (activeFilters > 6) complexity = 'complex';

    return {
      model,
      filterObject: filterObj,
      sortObject: sortObj,
      estimatedComplexity: complexity,
      fieldCount: activeFilters,
    };
  }

  /**
   * Export the query as code in multiple formats.
   */
  exportCode(): CodeExportResult {
    const filter = this.buildFilterObject();
    const sort: Record<string, string> = {};
    for (const s of this.sorts) sort[s.field] = s.direction;

    const filterStr = JSON.stringify(filter, null, 2);
    const sortStr = Object.keys(sort).length > 0 ? `.sort(${JSON.stringify(sort)})` : '';
    const limitStr = this._limit ? `.limit(${this._limit})` : '';
    const skipStr = this._skip ? `.skip(${this._skip})` : '';

    const typescript = [
      `const results = await db.collection('${this.collection}')`,
      `  .find(${filterStr})`,
      sortStr ? `  ${sortStr}` : null,
      limitStr ? `  ${limitStr}` : null,
      skipStr ? `  ${skipStr}` : null,
      `  .exec();`,
    ]
      .filter(Boolean)
      .join('\n');

    const json = JSON.stringify(
      {
        collection: this.collection,
        filter,
        sort: Object.keys(sort).length > 0 ? sort : undefined,
        limit: this._limit,
        skip: this._skip,
      },
      null,
      2
    );

    const curl = `curl -X POST http://localhost:4680/api/query \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ collection: this.collection, filter, sort, limit: this._limit })}'`;

    return { typescript, json, curl };
  }

  /**
   * Reset the builder.
   */
  reset(): this {
    this.collection = '';
    this.filters = [];
    this.sorts = [];
    this._limit = null;
    this._skip = null;
    this._projection = null;
    return this;
  }

  /**
   * Load a query model into the builder.
   */
  loadModel(model: VisualQuerySpec): this {
    this.collection = model.collection;
    this.filters = [...model.filters];
    this.sorts = [...model.sorts];
    this._limit = model.limit;
    this._skip = model.skip;
    this._projection = model.projection;
    return this;
  }

  // ── Private ────────────────────────────────────────────

  private buildFilterObject(): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    for (const f of this.filters) {
      if (!f.enabled) continue;

      const opMap: Record<VisualOperator, string> = {
        eq: '$eq',
        ne: '$ne',
        gt: '$gt',
        gte: '$gte',
        lt: '$lt',
        lte: '$lte',
        in: '$in',
        contains: '$contains',
        startsWith: '$startsWith',
        exists: '$exists',
      };

      if (f.operator === 'eq') {
        filter[f.field] = f.value;
      } else {
        const existing = (filter[f.field] as Record<string, unknown>) ?? {};
        existing[opMap[f.operator]] = f.value;
        filter[f.field] = existing;
      }
    }

    return filter;
  }
}

export function createVisualQueryBuilder(): VisualQueryBuilder {
  return new VisualQueryBuilder();
}

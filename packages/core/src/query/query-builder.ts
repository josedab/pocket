import type { Observable } from 'rxjs';
import type { LiveQuery, LiveQueryOptions } from '../observable/live-query.js';
import type { PopulateSpec } from '../relations/types.js';
import type { Document } from '../types/document.js';
import type {
  CursorDirection,
  QueryExplainResult,
  QueryFilter,
  QuerySpec,
  SortDirection,
  SortSpec,
} from '../types/query.js';

/**
 * Fluent query builder for constructing type-safe database queries.
 *
 * QueryBuilder provides a chainable API for building complex queries with
 * filtering, sorting, pagination, and projection. Queries can be executed
 * once with {@link exec} or subscribed to reactively with {@link live}.
 *
 * @typeParam T - The document type being queried
 *
 * @example Basic query
 * ```typescript
 * const users = await db.collection<User>('users')
 *   .find()
 *   .where('age').greaterThan(18)
 *   .sort('name', 'asc')
 *   .exec();
 * ```
 *
 * @example Complex filtering
 * ```typescript
 * const results = await collection
 *   .find()
 *   .where('status').in(['active', 'pending'])
 *   .where('createdAt').greaterThan(lastWeek)
 *   .or(
 *     { priority: 'high' },
 *     { assignee: currentUser }
 *   )
 *   .sort('priority', 'desc')
 *   .limit(20)
 *   .exec();
 * ```
 *
 * @example Pagination
 * ```typescript
 * const page2 = await collection
 *   .find()
 *   .sort('createdAt', 'desc')
 *   .skip(20)
 *   .limit(10)
 *   .exec();
 * ```
 *
 * @example Projection
 * ```typescript
 * const names = await collection
 *   .find()
 *   .include('_id', 'name')
 *   .exec();
 * ```
 *
 * @example Live query (reactive)
 * ```typescript
 * const todos$ = collection
 *   .find()
 *   .where('completed').equals(false)
 *   .sort('priority', 'desc')
 *   .live();
 *
 * todos$.subscribe(items => {
 *   console.log('Todo count:', items.length);
 * });
 * ```
 *
 * @see {@link Collection.find} for creating queries
 * @see {@link FieldQuery} for field-level operators
 */
export class QueryBuilder<T extends Document> {
  private spec: QuerySpec<T> = {};
  private populateSpecs: PopulateSpec[] = [];
  private readonly executor: (spec: QuerySpec<T>) => Promise<T[]>;
  private readonly liveQueryFactory: () => (
    spec: QuerySpec<T>,
    options?: LiveQueryOptions
  ) => LiveQuery<T>;

  constructor(
    executor: (spec: QuerySpec<T>) => Promise<T[]>,
    liveQueryFactory: () => (spec: QuerySpec<T>, options?: LiveQueryOptions) => LiveQuery<T>
  ) {
    this.executor = executor;
    this.liveQueryFactory = liveQueryFactory;
  }

  /**
   * Start building a condition for a specific field.
   *
   * Returns a {@link FieldQuery} with type-safe comparison operators
   * for the specified field.
   *
   * @typeParam K - The field name type
   * @param field - The field to filter on
   * @returns A FieldQuery for building the condition
   *
   * @example
   * ```typescript
   * query
   *   .where('age').greaterThan(18)
   *   .where('status').in(['active', 'pending'])
   *   .where('email').contains('@company.com')
   * ```
   */
  where<K extends keyof T & string>(field: K): FieldQuery<T, T[K]> {
    return new FieldQuery<T, T[K]>(this, field);
  }

  /**
   * Add a raw filter object to the query.
   *
   * For advanced filtering scenarios not covered by {@link where}.
   * The filter is merged with any existing filters.
   *
   * @param filter - Raw filter object
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * query.filter({
   *   status: 'active',
   *   count: { $gte: 10, $lte: 100 }
   * });
   * ```
   */
  filter(filter: QueryFilter<T>): this {
    this.spec.filter = {
      ...this.spec.filter,
      ...filter,
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Add logical AND conditions to the query.
   *
   * All provided conditions must match for a document to be included.
   *
   * @param filters - Filter objects that must all match
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * query.and(
   *   { status: 'active' },
   *   { verified: true },
   *   { age: { $gte: 18 } }
   * );
   * ```
   */
  and(...filters: QueryFilter<T>[]): this {
    const existing = this.spec.filter?.$and ?? [];
    this.spec.filter = {
      ...this.spec.filter,
      $and: [...existing, ...filters],
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Add logical OR conditions to the query.
   *
   * At least one of the provided conditions must match for a document
   * to be included.
   *
   * @param filters - Filter objects where at least one must match
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * query.or(
   *   { role: 'admin' },
   *   { role: 'moderator' },
   *   { permissions: { $contains: 'manage_users' } }
   * );
   * ```
   */
  or(...filters: QueryFilter<T>[]): this {
    const existing = this.spec.filter?.$or ?? [];
    this.spec.filter = {
      ...this.spec.filter,
      $or: [...existing, ...filters],
    } as QueryFilter<T>;
    return this;
  }

  /**
   * Sort results by a field.
   *
   * Can be called multiple times to sort by multiple fields.
   * Earlier sorts take precedence.
   *
   * @param field - The field to sort by
   * @param direction - Sort direction: 'asc' (default) or 'desc'
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Sort by priority descending, then by createdAt ascending
   * query
   *   .sort('priority', 'desc')
   *   .sort('createdAt', 'asc');
   * ```
   */
  sort(field: keyof T & string, direction: SortDirection = 'asc'): this {
    const sorts = this.spec.sort ?? [];
    this.spec.sort = [...sorts, { field, direction }];
    return this;
  }

  /**
   * Sort by multiple fields at once.
   *
   * @param sorts - Array of sort specifications
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * query.sortBy([
   *   { field: 'priority', direction: 'desc' },
   *   { field: 'name', direction: 'asc' }
   * ]);
   * ```
   */
  sortBy(sorts: SortSpec<T>[]): this {
    this.spec.sort = [...(this.spec.sort ?? []), ...sorts];
    return this;
  }

  /**
   * Skip a number of documents (for pagination).
   *
   * @param count - Number of documents to skip
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Page 3 with 10 items per page
   * query.skip(20).limit(10);
   * ```
   */
  skip(count: number): this {
    this.spec.skip = count;
    return this;
  }

  /**
   * Limit the number of results returned.
   *
   * @param count - Maximum number of documents to return
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Get top 5 users
   * query.sort('score', 'desc').limit(5);
   * ```
   */
  limit(count: number): this {
    this.spec.limit = count;
    return this;
  }

  /**
   * Set cursor-based pagination.
   *
   * Cursor-based pagination is more efficient than skip/limit for large
   * datasets and provides stable pagination even when data changes.
   *
   * @param value - The cursor value (typically a document ID or field value)
   * @param options - Cursor options including direction
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Get next page after a specific document
   * const nextPage = await collection
   *   .find()
   *   .sort('createdAt', 'desc')
   *   .cursor('2024-01-15T10:00:00Z', { direction: 'after' })
   *   .limit(20)
   *   .exec();
   * ```
   *
   * @example Using document ID as cursor
   * ```typescript
   * // Paginate by ID
   * const page = await collection
   *   .find()
   *   .cursor(lastDocId, { direction: 'after', field: '_id' })
   *   .limit(10)
   *   .exec();
   * ```
   */
  cursor(value: string, options: { direction: CursorDirection; field?: string }): this {
    this.spec.cursor = {
      value,
      direction: options.direction,
      field: options.field,
    };
    return this;
  }

  /**
   * Get results after a specific document ID.
   *
   * Shorthand for `cursor(documentId, { direction: 'after', field: '_id' })`.
   *
   * @param documentId - The document ID to start after
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Get next 10 items after a known document
   * const nextPage = await collection
   *   .find()
   *   .sort('createdAt', 'desc')
   *   .after('doc-abc-123')
   *   .limit(10)
   *   .exec();
   * ```
   */
  after(documentId: string): this {
    return this.cursor(documentId, { direction: 'after', field: '_id' });
  }

  /**
   * Get results before a specific document ID.
   *
   * Shorthand for `cursor(documentId, { direction: 'before', field: '_id' })`.
   *
   * @param documentId - The document ID to get results before
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Get previous 10 items before a known document
   * const prevPage = await collection
   *   .find()
   *   .sort('createdAt', 'desc')
   *   .before('doc-xyz-789')
   *   .limit(10)
   *   .exec();
   * ```
   */
  before(documentId: string): this {
    return this.cursor(documentId, { direction: 'before', field: '_id' });
  }

  /**
   * Set field projection using include/exclude syntax.
   *
   * @param projection - Object mapping field names to 1 (include) or 0 (exclude)
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Include only specific fields
   * query.select({ name: 1, email: 1 });
   *
   * // Exclude large fields
   * query.select({ content: 0, attachments: 0 });
   * ```
   */
  select(projection: Partial<Record<keyof T, 0 | 1>>): this {
    this.spec.projection = projection;
    return this;
  }

  /**
   * Include only the specified fields in results.
   *
   * The `_id` field is always included unless explicitly excluded.
   *
   * @param fields - Field names to include
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Return only name and email
   * const summary = await query.include('name', 'email').exec();
   * ```
   */
  include(...fields: (keyof T & string)[]): this {
    const projection: Partial<Record<keyof T, 0 | 1>> = {};
    for (const field of fields) {
      projection[field] = 1;
    }
    this.spec.projection = projection;
    return this;
  }

  /**
   * Exclude the specified fields from results.
   *
   * Useful for omitting large fields when not needed.
   *
   * @param fields - Field names to exclude
   * @returns This query builder for chaining
   *
   * @example
   * ```typescript
   * // Exclude large content field
   * const list = await query.exclude('content', 'metadata').exec();
   * ```
   */
  exclude(...fields: (keyof T & string)[]): this {
    const projection: Partial<Record<keyof T, 0 | 1>> = {};
    for (const field of fields) {
      projection[field] = 0;
    }
    this.spec.projection = projection;
    return this;
  }

  /**
   * Populate related documents.
   *
   * Fetches related documents based on schema-defined relationships
   * and includes them in the result. Multiple populate calls can be
   * chained to populate multiple relations.
   *
   * @param path - Path to the relation field, or detailed populate options
   * @returns This query builder for chaining
   *
   * @example Simple population
   * ```typescript
   * // Populate the 'author' field on posts
   * const posts = await collection
   *   .find()
   *   .populate('author')
   *   .exec();
   * ```
   *
   * @example Multiple populations
   * ```typescript
   * const orders = await collection
   *   .find()
   *   .populate('customer')
   *   .populate('items')
   *   .exec();
   * ```
   *
   * @example With options
   * ```typescript
   * const orders = await collection
   *   .find()
   *   .populate({
   *     path: 'items',
   *     limit: 10,
   *     sort: { field: 'createdAt', direction: 'desc' }
   *   })
   *   .exec();
   * ```
   *
   * @example Nested population
   * ```typescript
   * const orders = await collection
   *   .find()
   *   .populate({
   *     path: 'items',
   *     populate: [{ path: 'product' }]
   *   })
   *   .exec();
   * ```
   */
  populate(pathOrOptions: PopulateSpec): this {
    this.populateSpecs.push(pathOrOptions);
    return this;
  }

  /**
   * Get the current populate specifications.
   *
   * @returns Array of populate specifications
   */
  getPopulateSpecs(): PopulateSpec[] {
    return [...this.populateSpecs];
  }

  /**
   * Get the underlying query specification.
   *
   * Useful for debugging or passing to other APIs.
   *
   * @returns A copy of the query specification
   */
  getSpec(): QuerySpec<T> {
    return { ...this.spec };
  }

  /**
   * Execute the query and return matching documents.
   *
   * This is a one-time query. For reactive updates, use {@link live}.
   *
   * @returns Promise resolving to array of matching documents
   *
   * @example
   * ```typescript
   * const users = await db.collection('users')
   *   .find()
   *   .where('active').equals(true)
   *   .exec();
   * ```
   */
  async exec(): Promise<T[]> {
    return this.executor(this.spec);
  }

  /**
   * Execute the query and return the first matching document.
   *
   * Equivalent to `.limit(1).exec()[0]`.
   *
   * @returns Promise resolving to the first match, or `null` if none
   *
   * @example
   * ```typescript
   * const admin = await query.where('role').equals('admin').first();
   * ```
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).exec();
    return results[0] ?? null;
  }

  /**
   * Create a live query that updates automatically.
   *
   * Returns an RxJS Observable that emits the current results whenever
   * the underlying data changes. Uses EventReduce optimization by default
   * to minimize re-queries.
   *
   * @param options - Live query options (debounce, EventReduce settings)
   * @returns Observable that emits arrays of matching documents
   *
   * @example React integration
   * ```typescript
   * function UserList() {
   *   const [users, setUsers] = useState<User[]>([]);
   *
   *   useEffect(() => {
   *     const sub = db.collection<User>('users')
   *       .find()
   *       .where('active').equals(true)
   *       .sort('name')
   *       .live()
   *       .subscribe(setUsers);
   *
   *     return () => sub.unsubscribe();
   *   }, []);
   *
   *   return <ul>{users.map(u => <li key={u._id}>{u.name}</li>)}</ul>;
   * }
   * ```
   *
   * @example With debouncing
   * ```typescript
   * // Debounce rapid changes (e.g., during typing)
   * query.live({ debounceMs: 100 });
   * ```
   */
  live(options?: LiveQueryOptions): Observable<T[]> {
    const factory = this.liveQueryFactory();
    const liveQuery = factory(this.spec, options);
    return liveQuery.observable();
  }

  /**
   * Explain the query execution plan without running the query.
   *
   * Returns detailed information about how the query will be executed,
   * including which indexes will be used, estimated scan counts, and
   * suggestions for performance improvements.
   *
   * @returns Promise resolving to the query explanation
   *
   * @example Analyzing query performance
   * ```typescript
   * const explain = await collection
   *   .find()
   *   .where('status').equals('active')
   *   .where('createdAt').greaterThan(lastMonth)
   *   .sort('priority', 'desc')
   *   .explain();
   *
   * console.log('Query plan:', explain.plan);
   * console.log('Index used:', explain.plan.indexName ?? 'none (full scan)');
   * console.log('Estimated documents to scan:', explain.plan.estimatedScan);
   *
   * if (explain.suggestions?.length) {
   *   console.log('Suggestions:');
   *   explain.suggestions.forEach(s => console.log('  -', s));
   * }
   * ```
   *
   * @example Checking if index is used
   * ```typescript
   * const { plan } = await query.explain();
   *
   * if (!plan.indexName) {
   *   console.warn('Query will perform a full collection scan!');
   *   console.log('Consider creating an index on:', Object.keys(spec.filter ?? {}));
   * }
   * ```
   */
  explain(): QueryExplainResult {
    // Build query plan based on spec
    const plan = this.buildQueryPlan();
    const suggestions = this.generateSuggestions(plan);

    return {
      plan,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Execute the query and return results with execution statistics.
   *
   * Similar to {@link exec} but also returns timing and scan statistics.
   * Useful for performance analysis and debugging.
   *
   * @returns Promise resolving to results with execution stats
   *
   * @example
   * ```typescript
   * const result = await collection
   *   .find()
   *   .where('status').equals('active')
   *   .execWithStats();
   *
   * console.log(`Found ${result.documents.length} documents`);
   * console.log(`Execution time: ${result.execution.totalTimeMs}ms`);
   * console.log(`Documents scanned: ${result.execution.documentsScanned}`);
   * ```
   */
  async execWithStats(): Promise<{ documents: T[]; execution: QueryExplainResult['execution'] }> {
    const startTime = performance.now();
    const documents = await this.executor(this.spec);
    const endTime = performance.now();

    const plan = this.buildQueryPlan();

    return {
      documents,
      execution: {
        totalTimeMs: Math.round((endTime - startTime) * 100) / 100,
        documentsScanned: documents.length, // Approximate - actual may vary
        indexHits: plan.indexName ? documents.length : 0,
        documentsReturned: documents.length,
        usedIndex: plan.indexName !== null,
        indexName: plan.indexName ?? undefined,
      },
    };
  }

  /**
   * Build a query plan based on the current specification.
   * @internal
   */
  private buildQueryPlan(): QueryExplainResult['plan'] {
    const steps: QueryExplainResult['plan']['steps'] = [];
    let indexName: string | null = null;
    let indexCovers = false;
    let estimatedScan = 1000; // Default estimate
    let sortUsingIndex = false;

    // Analyze filter to determine if index can be used
    const filterFields = this.spec.filter
      ? Object.keys(this.spec.filter).filter((k) => !k.startsWith('$'))
      : [];

    // Check for potential index usage (simplified - real implementation would check actual indexes)
    if (filterFields.length > 0) {
      // Assume a simple index might exist on the first filter field
      const primaryFilterField = filterFields[0];
      if (primaryFilterField) {
        // In a real implementation, we'd check against actual indexes
        // For now, we'll indicate the field that would benefit from an index
        steps.push({
          type: 'filter',
          description: `Filter on field "${primaryFilterField}"`,
          estimatedCost: 0.5,
        });

        // Check if this looks like an indexed field (e.g., _id or common patterns)
        if (primaryFilterField === '_id') {
          indexName = '_id_';
          indexCovers = true;
          estimatedScan = 1;
        }
      }
    }

    // Check if sort can use an index
    if (this.spec.sort && this.spec.sort.length > 0) {
      const sortField = this.spec.sort[0]?.field;
      if (sortField === '_id' || (indexName && filterFields[0] === sortField)) {
        sortUsingIndex = true;
      }
    }

    // Add collection scan or index scan step
    if (indexName) {
      steps.unshift({
        type: 'index-scan',
        description: `Scan index "${indexName}"`,
        estimatedCost: 0.2,
      });
      estimatedScan = Math.floor(estimatedScan * 0.1);
    } else {
      steps.unshift({
        type: 'collection-scan',
        description: 'Full collection scan',
        estimatedCost: 1.0,
      });
    }

    // Add sort step if sorting
    if (this.spec.sort && this.spec.sort.length > 0) {
      const sortFields = this.spec.sort.map((s) => s.field).join(', ');
      steps.push({
        type: 'sort',
        description: `Sort by ${sortFields}`,
        estimatedCost: sortUsingIndex ? 0.1 : 0.8,
      });
    }

    // Add skip step if skipping
    if (this.spec.skip && this.spec.skip > 0) {
      steps.push({
        type: 'skip',
        description: `Skip ${this.spec.skip} documents`,
        estimatedCost: 0.1,
      });
    }

    // Add limit step if limiting
    if (this.spec.limit && this.spec.limit > 0) {
      steps.push({
        type: 'limit',
        description: `Limit to ${this.spec.limit} documents`,
        estimatedCost: 0.05,
      });
      estimatedScan = Math.min(estimatedScan, this.spec.limit * 10);
    }

    return {
      indexName,
      indexCovers,
      estimatedScan,
      sortUsingIndex,
      steps,
    };
  }

  /**
   * Generate suggestions for improving query performance.
   * @internal
   */
  private generateSuggestions(plan: QueryExplainResult['plan']): string[] {
    const suggestions: string[] = [];

    // Suggest index if doing full scan with filters
    if (!plan.indexName && this.spec.filter) {
      const filterFields = Object.keys(this.spec.filter).filter((k) => !k.startsWith('$'));
      if (filterFields.length > 0) {
        suggestions.push(
          `Consider creating an index on [${filterFields.join(', ')}] to improve query performance`
        );
      }
    }

    // Suggest compound index for sort
    if (this.spec.sort && this.spec.sort.length > 0 && !plan.sortUsingIndex) {
      const sortFields = this.spec.sort.map((s) => s.field);
      const filterFields = this.spec.filter
        ? Object.keys(this.spec.filter).filter((k) => !k.startsWith('$'))
        : [];
      const allFields = [...new Set([...filterFields, ...sortFields])];
      suggestions.push(
        `Consider creating a compound index on [${allFields.join(', ')}] to avoid in-memory sorting`
      );
    }

    // Warn about skip-based pagination for large offsets
    if (this.spec.skip && this.spec.skip > 1000) {
      suggestions.push(
        'Large skip values can be slow. Consider using cursor-based pagination with .after() or .cursor() instead'
      );
    }

    // Warn about missing limit
    if (!this.spec.limit && !this.spec.cursor) {
      suggestions.push(
        'Consider adding .limit() to avoid fetching all documents when only a subset is needed'
      );
    }

    return suggestions;
  }

  /**
   * Internal: Add a field condition to the filter
   */
  _addCondition(field: string, condition: unknown): this {
    this.spec.filter = {
      ...this.spec.filter,
      [field]: condition,
    } as QueryFilter<T>;
    return this;
  }
}

/**
 * Field-specific query builder with type-safe comparison operators.
 *
 * Created by {@link QueryBuilder.where}, provides operators appropriate
 * for the field's type (comparisons, string matching, array operations).
 *
 * @typeParam T - The document type
 * @typeParam V - The field value type
 *
 * @example Comparison operators
 * ```typescript
 * query.where('age').greaterThan(18)
 * query.where('price').between(10, 100)
 * query.where('status').in(['active', 'pending'])
 * ```
 *
 * @example String operators
 * ```typescript
 * query.where('email').contains('@company.com')
 * query.where('name').startsWith('Dr.')
 * query.where('code').matches(/^[A-Z]{3}-\d{4}$/)
 * ```
 *
 * @example Array operators
 * ```typescript
 * query.where('tags').all(['javascript', 'react'])
 * query.where('items').size(3)
 * ```
 */
export class FieldQuery<T extends Document, V> {
  private readonly builder: QueryBuilder<T>;
  private readonly field: keyof T & string;

  constructor(builder: QueryBuilder<T>, field: keyof T & string) {
    this.builder = builder;
    this.field = field;
  }

  /**
   * Match documents where the field equals the value.
   *
   * @param value - The value to match
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('status').equals('active')
   * ```
   */
  equals(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, value);
  }

  /**
   * Alias for {@link equals}.
   */
  eq(value: V): QueryBuilder<T> {
    return this.equals(value);
  }

  /**
   * Match documents where the field does not equal the value.
   *
   * @param value - The value to not match
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('status').notEquals('deleted')
   * ```
   */
  notEquals(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $ne: value });
  }

  /**
   * Alias for {@link notEquals}.
   */
  ne(value: V): QueryBuilder<T> {
    return this.notEquals(value);
  }

  /**
   * Match documents where the field is greater than the value.
   *
   * @param value - The minimum value (exclusive)
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('age').greaterThan(18)
   * query.where('createdAt').greaterThan(lastWeek)
   * ```
   */
  greaterThan(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gt: value });
  }

  /**
   * Alias for {@link greaterThan}.
   */
  gt(value: V): QueryBuilder<T> {
    return this.greaterThan(value);
  }

  /**
   * Match documents where the field is greater than or equal to the value.
   *
   * @param value - The minimum value (inclusive)
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('quantity').greaterThanOrEqual(1)
   * ```
   */
  greaterThanOrEqual(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gte: value });
  }

  /**
   * Alias for {@link greaterThanOrEqual}.
   */
  gte(value: V): QueryBuilder<T> {
    return this.greaterThanOrEqual(value);
  }

  /**
   * Match documents where the field is less than the value.
   *
   * @param value - The maximum value (exclusive)
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('price').lessThan(100)
   * ```
   */
  lessThan(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $lt: value });
  }

  /**
   * Alias for {@link lessThan}.
   */
  lt(value: V): QueryBuilder<T> {
    return this.lessThan(value);
  }

  /**
   * Match documents where the field is less than or equal to the value.
   *
   * @param value - The maximum value (inclusive)
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('rating').lessThanOrEqual(5)
   * ```
   */
  lessThanOrEqual(value: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $lte: value });
  }

  /**
   * Alias for {@link lessThanOrEqual}.
   */
  lte(value: V): QueryBuilder<T> {
    return this.lessThanOrEqual(value);
  }

  /**
   * Match documents where the field value is in the provided array.
   *
   * @param values - Array of allowed values
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('status').in(['active', 'pending', 'review'])
   * query.where('category').in(allowedCategories)
   * ```
   */
  in(values: V[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $in: values });
  }

  /**
   * Match documents where the field value is not in the provided array.
   *
   * @param values - Array of disallowed values
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('status').notIn(['deleted', 'archived'])
   * ```
   */
  notIn(values: V[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $nin: values });
  }

  /**
   * Match documents where the field is between two values (inclusive).
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('price').between(10, 100)
   * query.where('date').between(startOfMonth, endOfMonth)
   * ```
   */
  between(min: V, max: V): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $gte: min, $lte: max });
  }

  /**
   * Match documents where the field exists and is not null.
   *
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('email').exists()
   * ```
   */
  exists(): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $ne: null });
  }

  /**
   * Match documents where the field is null or undefined.
   *
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('deletedAt').notExists()
   * ```
   */
  notExists(): QueryBuilder<T> {
    return this.builder._addCondition(this.field, null);
  }

  // String-specific methods

  /**
   * Match documents where the string field matches a regex pattern.
   *
   * @param pattern - Regular expression or pattern string
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('phone').matches(/^\d{3}-\d{4}$/)
   * query.where('code').matches('^[A-Z]{3}')
   * ```
   */
  matches(pattern: RegExp | string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $regex: pattern });
  }

  /**
   * Match documents where the string field starts with a prefix.
   *
   * @param prefix - The prefix to match
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('name').startsWith('Dr.')
   * ```
   */
  startsWith(prefix: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $startsWith: prefix });
  }

  /**
   * Match documents where the string field ends with a suffix.
   *
   * @param suffix - The suffix to match
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('email').endsWith('@company.com')
   * ```
   */
  endsWith(suffix: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $endsWith: suffix });
  }

  /**
   * Match documents where the string field contains a substring.
   *
   * @param substring - The substring to find
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('description').contains('important')
   * ```
   */
  contains(substring: string): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $contains: substring });
  }

  // Array-specific methods

  /**
   * Match documents where the array field contains all specified values.
   *
   * @param values - Values that must all be present
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('tags').all(['javascript', 'typescript', 'react'])
   * ```
   */
  all(values: unknown[]): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $all: values });
  }

  /**
   * Match documents where the array field has the specified length.
   *
   * @param length - Required array length
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('items').size(3)
   * ```
   */
  size(length: number): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $size: length });
  }

  /**
   * Match documents where at least one array element matches the condition.
   *
   * @param condition - Condition that at least one element must match
   * @returns The query builder for chaining
   *
   * @example
   * ```typescript
   * query.where('items').elemMatch({ price: { $gt: 100 }, inStock: true })
   * ```
   */
  elemMatch(condition: Record<string, unknown>): QueryBuilder<T> {
    return this.builder._addCondition(this.field, { $elemMatch: condition });
  }
}

/**
 * Create a new query builder instance.
 *
 * This is an internal factory function. Users should access query builders
 * through {@link Collection.find}.
 *
 * @param executor - Function to execute queries
 * @param liveQueryFactory - Factory for creating live queries
 * @returns A new QueryBuilder instance
 *
 * @internal
 */
export function createQueryBuilder<T extends Document>(
  executor: (spec: QuerySpec<T>) => Promise<T[]>,
  liveQueryFactory: () => (spec: QuerySpec<T>, options?: LiveQueryOptions) => LiveQuery<T>
): QueryBuilder<T> {
  return new QueryBuilder(executor, liveQueryFactory);
}

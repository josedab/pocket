/**
 * Data Mesh Federation — query across multiple Pocket databases
 * with automatic routing, cross-DB joins, and result merging.
 */

/** A registered database in the mesh. */
export interface MeshDatabase {
  readonly id: string;
  readonly name: string;
  readonly collections: readonly string[];
  readonly location: 'local' | 'remote';
  readonly endpoint?: string;
  readonly priority?: number;
}

/** A federated query targeting multiple databases. */
export interface FederatedMeshQuery {
  readonly collection: string;
  readonly filter?: Record<string, unknown>;
  readonly sort?: Record<string, unknown>;
  readonly limit?: number;
  readonly databases?: readonly string[];
}

/** A cross-database join specification. */
export interface CrossJoinSpec {
  readonly left: { database: string; collection: string; field: string };
  readonly right: { database: string; collection: string; field: string };
  readonly type: 'inner' | 'left' | 'full';
}

/** Result of a federated query. */
export interface MeshQueryResult<T = Record<string, unknown>> {
  readonly documents: readonly (T & { _sourceDatabase: string })[];
  readonly totalCount: number;
  readonly sources: readonly { database: string; count: number; durationMs: number }[];
  readonly durationMs: number;
}

/** Database query executor interface. */
export interface MeshQueryExecutor {
  query<T>(collection: string, filter?: Record<string, unknown>, limit?: number): Promise<T[]>;
  getCollections(): Promise<string[]>;
}

export class DataMeshRegistry {
  private readonly databases = new Map<string, MeshDatabase>();
  private readonly executors = new Map<string, MeshQueryExecutor>();

  /** Register a database in the mesh. */
  register(db: MeshDatabase, executor: MeshQueryExecutor): void {
    this.databases.set(db.id, db);
    this.executors.set(db.id, executor);
  }

  /** Unregister a database from the mesh. */
  unregister(id: string): void {
    this.databases.delete(id);
    this.executors.delete(id);
  }

  /** Find which databases contain a given collection. */
  findDatabasesForCollection(collection: string): readonly MeshDatabase[] {
    return Array.from(this.databases.values())
      .filter((db) => db.collections.includes(collection))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /** Execute a federated query across all matching databases. */
  async query<T extends Record<string, unknown>>(
    meshQuery: FederatedMeshQuery
  ): Promise<MeshQueryResult<T>> {
    const start = performance.now();

    // Find target databases
    let targets: MeshDatabase[];
    if (meshQuery.databases) {
      targets = meshQuery.databases
        .map((id) => this.databases.get(id))
        .filter((db): db is MeshDatabase => db !== undefined);
    } else {
      targets = [...this.findDatabasesForCollection(meshQuery.collection)];
    }

    if (targets.length === 0) {
      return { documents: [], totalCount: 0, sources: [], durationMs: 0 };
    }

    // Execute in parallel across all target databases
    const queryPromises = targets.map(async (db) => {
      const executor = this.executors.get(db.id);
      if (!executor) return { database: db.id, docs: [] as T[], durationMs: 0 };

      const qStart = performance.now();
      const docs = await executor.query<T>(meshQuery.collection, meshQuery.filter, meshQuery.limit);
      return { database: db.id, docs, durationMs: performance.now() - qStart };
    });

    const results = await Promise.all(queryPromises);

    // Merge results
    const allDocs: (T & { _sourceDatabase: string })[] = [];
    const sources: { database: string; count: number; durationMs: number }[] = [];

    for (const result of results) {
      for (const doc of result.docs) {
        allDocs.push({ ...doc, _sourceDatabase: result.database });
      }
      sources.push({
        database: result.database,
        count: result.docs.length,
        durationMs: result.durationMs,
      });
    }

    // Apply limit across merged results
    const limited = meshQuery.limit ? allDocs.slice(0, meshQuery.limit) : allDocs;

    return {
      documents: limited,
      totalCount: allDocs.length,
      sources,
      durationMs: performance.now() - start,
    };
  }

  /** Execute a cross-database join. */
  async join<L extends Record<string, unknown>, R extends Record<string, unknown>>(
    spec: CrossJoinSpec
  ): Promise<readonly { left: L; right: R | null }[]> {
    const leftExecutor = this.executors.get(spec.left.database);
    const rightExecutor = this.executors.get(spec.right.database);
    if (!leftExecutor || !rightExecutor) return [];

    const [leftDocs, rightDocs] = await Promise.all([
      leftExecutor.query<L>(spec.left.collection),
      rightExecutor.query<R>(spec.right.collection),
    ]);

    // Build right-side index
    const rightIndex = new Map<string, R>();
    for (const doc of rightDocs) {
      const key = String(doc[spec.right.field]);
      rightIndex.set(key, doc);
    }

    // Execute join
    const results: { left: L; right: R | null }[] = [];
    const matchedRight = new Set<string>();

    for (const leftDoc of leftDocs) {
      const key = String(leftDoc[spec.left.field]);
      const rightDoc = rightIndex.get(key) ?? null;
      if (rightDoc) matchedRight.add(key);

      if (spec.type === 'inner' && !rightDoc) continue;
      results.push({ left: leftDoc, right: rightDoc });
    }

    // For full join, add unmatched right docs
    if (spec.type === 'full') {
      for (const [key, rightDoc] of rightIndex) {
        if (!matchedRight.has(key)) {
          results.push({ left: {} as L, right: rightDoc });
        }
      }
    }

    return results;
  }

  /** List all registered databases. */
  listDatabases(): readonly MeshDatabase[] {
    return Array.from(this.databases.values());
  }

  /** Get schema catalog across all databases. */
  getCatalog(): Record<string, readonly string[]> {
    const catalog: Record<string, string[]> = {};
    for (const db of this.databases.values()) {
      catalog[db.id] = [...db.collections];
    }
    return catalog;
  }
}

export function createDataMeshRegistry(): DataMeshRegistry {
  return new DataMeshRegistry();
}

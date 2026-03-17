import type { Observable } from 'rxjs';
import { ObservableValue } from '../observable/observable.js';
import { generateId } from '../types/document.js';

// ── Types ──────────────────────────────────────────────────────────

export interface Space {
  id: string;
  name: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  collections: string[];
  memberCount: number;
}

export interface SpaceMember {
  spaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: Date;
}

export interface SpaceManagerConfig {
  maxSpaces?: number;
  maxMembersPerSpace?: number;
  allowCrossSpaceQueries?: boolean;
}

export interface SpaceStats {
  totalSpaces: number;
  totalMembers: number;
  collectionsPerSpace: Map<string, number>;
}

export interface SpaceQuery {
  spaceId: string;
  collection: string;
  filter?: Record<string, unknown>;
}

/**
 * Result from a cross-space query, including source space metadata
 */
export interface CrossSpaceResult<T = Record<string, unknown>> {
  /** The document */
  document: T;
  /** The space this document belongs to */
  spaceId: string;
  /** The space name */
  spaceName: string;
}

/**
 * Options for cross-space queries
 */
export interface CrossSpaceQueryOptions {
  /** Collection to query across spaces */
  collection: string;
  /** Optional filter to apply to each space's query */
  filter?: Record<string, unknown>;
  /** Limit results to these specific space IDs (queries all spaces if omitted) */
  spaceIds?: string[];
  /** Maximum total results across all spaces */
  limit?: number;
}

/**
 * Resolver function that executes a query against a resolved collection name.
 * The SpaceManager delegates actual data access to the consumer via this function.
 */
export type CrossSpaceQueryResolver<T = Record<string, unknown>> = (
  resolvedCollectionName: string,
  filter?: Record<string, unknown>
) => Promise<T[]>;

// ── SpaceManager ───────────────────────────────────────────────────

export class SpaceManager {
  private readonly config: Required<SpaceManagerConfig>;
  private readonly spacesMap = new Map<string, Space>();
  private readonly members = new Map<string, SpaceMember[]>();
  private readonly spaces$$ = new ObservableValue<Space[]>([]);

  /** Observable stream of the current space list. */
  readonly spaces$: Observable<Space[]>;

  constructor(config: SpaceManagerConfig = {}) {
    this.config = {
      maxSpaces: config.maxSpaces ?? Infinity,
      maxMembersPerSpace: config.maxMembersPerSpace ?? Infinity,
      allowCrossSpaceQueries: config.allowCrossSpaceQueries ?? false,
    };
    this.spaces$ = this.spaces$$.asObservable();
  }

  // ── Space CRUD ─────────────────────────────────────────────────

  createSpace(name: string, ownerId: string, metadata?: Record<string, unknown>): Space {
    if (this.spacesMap.size >= this.config.maxSpaces) {
      throw new Error(`Maximum number of spaces (${this.config.maxSpaces}) reached`);
    }

    const id = generateId();
    const now = new Date();

    const space: Space = {
      id,
      name,
      createdAt: now,
      metadata,
      collections: [],
      memberCount: 1,
    };

    this.spacesMap.set(id, space);

    const ownerMember: SpaceMember = {
      spaceId: id,
      userId: ownerId,
      role: 'owner',
      joinedAt: now,
    };
    this.members.set(id, [ownerMember]);

    this.emitSpaces();
    return space;
  }

  deleteSpace(spaceId: string): boolean {
    const deleted = this.spacesMap.delete(spaceId);
    if (deleted) {
      this.members.delete(spaceId);
      this.emitSpaces();
    }
    return deleted;
  }

  getSpace(spaceId: string): Space | undefined {
    return this.spacesMap.get(spaceId);
  }

  listSpaces(): Space[] {
    return [...this.spacesMap.values()];
  }

  renameSpace(spaceId: string, newName: string): void {
    const space = this.spacesMap.get(spaceId);
    if (!space) {
      throw new Error(`Space "${spaceId}" not found`);
    }
    space.name = newName;
    this.emitSpaces();
  }

  // ── Members ────────────────────────────────────────────────────

  addMember(spaceId: string, userId: string, role: SpaceMember['role'] = 'member'): SpaceMember {
    const space = this.spacesMap.get(spaceId);
    if (!space) {
      throw new Error(`Space "${spaceId}" not found`);
    }

    const spaceMembers = this.members.get(spaceId) ?? [];

    if (spaceMembers.length >= this.config.maxMembersPerSpace) {
      throw new Error(`Maximum members per space (${this.config.maxMembersPerSpace}) reached`);
    }

    if (spaceMembers.some((m) => m.userId === userId)) {
      throw new Error(`User "${userId}" is already a member of space "${spaceId}"`);
    }

    const member: SpaceMember = {
      spaceId,
      userId,
      role,
      joinedAt: new Date(),
    };

    spaceMembers.push(member);
    this.members.set(spaceId, spaceMembers);
    space.memberCount = spaceMembers.length;
    this.emitSpaces();

    return member;
  }

  removeMember(spaceId: string, userId: string): boolean {
    const spaceMembers = this.members.get(spaceId);
    if (!spaceMembers) return false;

    const index = spaceMembers.findIndex((m) => m.userId === userId);
    if (index === -1) return false;

    spaceMembers.splice(index, 1);

    const space = this.spacesMap.get(spaceId);
    if (space) {
      space.memberCount = spaceMembers.length;
      this.emitSpaces();
    }

    return true;
  }

  getMembers(spaceId: string): SpaceMember[] {
    return [...(this.members.get(spaceId) ?? [])];
  }

  getMemberRole(spaceId: string, userId: string): SpaceMember['role'] | null {
    const spaceMembers = this.members.get(spaceId);
    if (!spaceMembers) return null;
    const member = spaceMembers.find((m) => m.userId === userId);
    return member?.role ?? null;
  }

  // ── Collections ────────────────────────────────────────────────

  registerCollection(spaceId: string, collectionName: string): void {
    const space = this.spacesMap.get(spaceId);
    if (!space) {
      throw new Error(`Space "${spaceId}" not found`);
    }
    if (!space.collections.includes(collectionName)) {
      space.collections.push(collectionName);
      this.emitSpaces();
    }
  }

  getSpaceCollections(spaceId: string): string[] {
    const space = this.spacesMap.get(spaceId);
    return space ? [...space.collections] : [];
  }

  resolveCollectionName(spaceId: string, collection: string): string {
    return `space__${spaceId}__${collection}`;
  }

  // ── Cross-Space Queries ─────────────────────────────────────────

  /**
   * Query a collection across multiple spaces, returning results with space metadata.
   *
   * Requires `allowCrossSpaceQueries` to be enabled in the config.
   * The actual data access is delegated to the provided resolver function,
   * which receives the resolved (namespaced) collection name for each space.
   *
   * @param options - Cross-space query options
   * @param resolver - Function that executes the query against a resolved collection name
   * @returns Array of results with space metadata
   *
   * @example
   * ```typescript
   * const manager = createSpaceManager({ allowCrossSpaceQueries: true });
   *
   * const results = await manager.queryAcrossSpaces(
   *   { collection: 'todos', filter: { completed: false } },
   *   async (resolvedName, filter) => {
   *     return db.collection(resolvedName).find(filter ?? {}).exec();
   *   }
   * );
   *
   * for (const { document, spaceName } of results) {
   *   console.log(`[${spaceName}]`, document);
   * }
   * ```
   */
  async queryAcrossSpaces<T = Record<string, unknown>>(
    options: CrossSpaceQueryOptions,
    resolver: CrossSpaceQueryResolver<T>
  ): Promise<CrossSpaceResult<T>[]> {
    if (!this.config.allowCrossSpaceQueries) {
      throw new Error(
        'Cross-space queries are not enabled. Set allowCrossSpaceQueries: true in SpaceManagerConfig.'
      );
    }

    // Determine which spaces to query
    const targetSpaces: Space[] = [];
    if (options.spaceIds) {
      for (const id of options.spaceIds) {
        const space = this.spacesMap.get(id);
        if (space?.collections.includes(options.collection)) {
          targetSpaces.push(space);
        }
      }
    } else {
      const spaces = Array.from(this.spacesMap.values());
      for (const space of spaces) {
        if (space.collections.includes(options.collection)) {
          targetSpaces.push(space);
        }
      }
    }

    if (targetSpaces.length === 0) {
      return [];
    }

    // Query each space in parallel
    const queryPromises = targetSpaces.map(async (space) => {
      const resolvedName = this.resolveCollectionName(space.id, options.collection);
      const docs = await resolver(resolvedName, options.filter);
      return docs.map((document) => ({
        document,
        spaceId: space.id,
        spaceName: space.name,
      }));
    });

    const spaceResults = await Promise.all(queryPromises);
    let allResults = spaceResults.flat();

    // Apply global limit if specified
    if (options.limit !== undefined && allResults.length > options.limit) {
      allResults = allResults.slice(0, options.limit);
    }

    return allResults;
  }

  /**
   * Find all spaces that contain a specific collection.
   *
   * @param collectionName - The collection name to search for
   * @returns Array of spaces that have this collection registered
   */
  findSpacesWithCollection(collectionName: string): Space[] {
    const result: Space[] = [];
    const spaces = Array.from(this.spacesMap.values());
    for (const space of spaces) {
      if (space.collections.includes(collectionName)) {
        result.push({ ...space, collections: [...space.collections] });
      }
    }
    return result;
  }

  // ── Stats ──────────────────────────────────────────────────────

  getStats(): SpaceStats {
    let totalMembers = 0;
    const collectionsPerSpace = new Map<string, number>();

    for (const [id, space] of this.spacesMap) {
      totalMembers += space.memberCount;
      collectionsPerSpace.set(id, space.collections.length);
    }

    return {
      totalSpaces: this.spacesMap.size,
      totalMembers,
      collectionsPerSpace,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  dispose(): void {
    this.spaces$$.destroy();
    this.spacesMap.clear();
    this.members.clear();
  }

  // ── Internal ───────────────────────────────────────────────────

  private emitSpaces(): void {
    this.spaces$$.next([...this.spacesMap.values()]);
  }
}

// ── Factory ────────────────────────────────────────────────────────

export function createSpaceManager(config?: SpaceManagerConfig): SpaceManager {
  return new SpaceManager(config);
}

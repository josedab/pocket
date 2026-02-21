import { generateId } from '../types/document.js';
import { ObservableValue } from '../observable/observable.js';
import type { Observable } from 'rxjs';

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

  createSpace(
    name: string,
    ownerId: string,
    metadata?: Record<string, unknown>,
  ): Space {
    if (this.spacesMap.size >= this.config.maxSpaces) {
      throw new Error(
        `Maximum number of spaces (${this.config.maxSpaces}) reached`,
      );
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

  addMember(
    spaceId: string,
    userId: string,
    role: SpaceMember['role'] = 'member',
  ): SpaceMember {
    const space = this.spacesMap.get(spaceId);
    if (!space) {
      throw new Error(`Space "${spaceId}" not found`);
    }

    const spaceMembers = this.members.get(spaceId) ?? [];

    if (spaceMembers.length >= this.config.maxMembersPerSpace) {
      throw new Error(
        `Maximum members per space (${this.config.maxMembersPerSpace}) reached`,
      );
    }

    if (spaceMembers.some((m) => m.userId === userId)) {
      throw new Error(
        `User "${userId}" is already a member of space "${spaceId}"`,
      );
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

export function createSpaceManager(
  config?: SpaceManagerConfig,
): SpaceManager {
  return new SpaceManager(config);
}

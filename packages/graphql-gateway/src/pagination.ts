/**
 * @module pagination
 *
 * Pagination support for the GraphQL gateway.
 * Provides Relay-style cursor-based pagination, offset-based pagination,
 * and helpers for generating Connection / Edge / PageInfo types.
 *
 * @example
 * ```typescript
 * import { createPaginationHelper } from '@pocket/graphql-gateway';
 *
 * const pagination = createPaginationHelper();
 *
 * // Cursor-based (Relay-style)
 * const connection = pagination.createConnection(items, {
 *   first: 10,
 *   after: 'Y3Vyc29yOjU=',
 *   totalCount: 42,
 * });
 *
 * // Offset-based
 * const page = pagination.createOffsetPage(items, {
 *   offset: 20,
 *   limit: 10,
 *   totalCount: 42,
 * });
 *
 * // Generate GraphQL SDL types
 * const sdl = pagination.generateConnectionTypes('User');
 * ```
 */

import type { GraphQLTypeDef, GraphQLFieldDef } from './types.js';

/** Standard Relay PageInfo type. */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/** A single edge in a Relay connection. */
export interface Edge<T> {
  node: T;
  cursor: string;
}

/** A Relay-style connection result. */
export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount: number;
}

/** Arguments for cursor-based pagination. */
export interface CursorPaginationArgs {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
  totalCount?: number;
}

/** An offset-based page result. */
export interface OffsetPage<T> {
  items: T[];
  totalCount: number;
  offset: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Arguments for offset-based pagination. */
export interface OffsetPaginationArgs {
  offset?: number;
  limit?: number;
  totalCount?: number;
}

/** Configuration for the pagination helper. */
export interface PaginationConfig {
  /** Default page size when none is specified (default: 25). */
  defaultPageSize?: number;
  /** Maximum page size allowed (default: 100). */
  maxPageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Provides cursor-based and offset-based pagination for query results.
 */
export class PaginationHelper {
  private readonly config: Required<PaginationConfig>;

  constructor(config: PaginationConfig = {}) {
    this.config = {
      defaultPageSize: config.defaultPageSize ?? DEFAULT_PAGE_SIZE,
      maxPageSize: config.maxPageSize ?? MAX_PAGE_SIZE,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Cursor helpers                                                      */
  /* ------------------------------------------------------------------ */

  /** Encode an integer offset into an opaque cursor string. */
  encodeCursor(offset: number): string {
    return Buffer.from(`cursor:${offset}`).toString('base64url');
  }

  /** Decode an opaque cursor string back to an integer offset. */
  decodeCursor(cursor: string): number {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      if (parts[0] !== 'cursor' || parts.length !== 2) {
        throw new Error('invalid format');
      }
      const offset = parseInt(parts[1]!, 10);
      if (Number.isNaN(offset) || offset < 0) {
        throw new Error('invalid offset');
      }
      return offset;
    } catch {
      throw new Error(`Pagination: invalid cursor "${cursor}"`);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Relay-style cursor pagination                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Create a Relay-style {@link Connection} from an array of items.
   *
   * @param items - The full (or pre-sliced) result set.
   * @param args  - Cursor pagination arguments.
   */
  createConnection<T>(
    items: T[],
    args: CursorPaginationArgs = {},
  ): Connection<T> {
    const totalCount = args.totalCount ?? items.length;
    let startIndex = 0;
    let endIndex = items.length;

    // forward pagination: first / after
    if (args.after != null) {
      startIndex = this.decodeCursor(args.after) + 1;
    }

    const first = this.clampPageSize(args.first);
    if (first != null) {
      endIndex = Math.min(startIndex + first, items.length);
    }

    // backward pagination: last / before
    if (args.before != null) {
      endIndex = Math.min(this.decodeCursor(args.before), endIndex);
    }

    if (args.last != null) {
      const last = this.clampPageSize(args.last)!;
      startIndex = Math.max(endIndex - last, startIndex);
    }

    // Clamp bounds
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(items.length, endIndex);

    const sliced = items.slice(startIndex, endIndex);

    const edges: Edge<T>[] = sliced.map((node, idx) => ({
      node,
      cursor: this.encodeCursor(startIndex + idx),
    }));

    const pageInfo: PageInfo = {
      hasNextPage: endIndex < totalCount,
      hasPreviousPage: startIndex > 0,
      startCursor: edges.length > 0 ? edges[0]!.cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1]!.cursor : null,
    };

    return { edges, pageInfo, totalCount };
  }

  /* ------------------------------------------------------------------ */
  /*  Offset-based pagination                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Create an offset-based {@link OffsetPage} from an array of items.
   *
   * @param items - The full result set (pagination is applied via slice).
   * @param args  - Offset pagination arguments.
   */
  createOffsetPage<T>(
    items: T[],
    args: OffsetPaginationArgs = {},
  ): OffsetPage<T> {
    const totalCount = args.totalCount ?? items.length;
    const offset = Math.max(args.offset ?? 0, 0);
    const limit = this.clampPageSize(args.limit) ?? this.config.defaultPageSize;

    const sliced = items.slice(offset, offset + limit);

    return {
      items: sliced,
      totalCount,
      offset,
      limit,
      hasNextPage: offset + limit < totalCount,
      hasPreviousPage: offset > 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  SDL / type generation                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Generate the Connection, Edge, and PageInfo GraphQL type definitions
   * for a given type name.
   */
  generateConnectionTypes(typeName: string): GraphQLTypeDef[] {
    const pageInfoType: GraphQLTypeDef = {
      name: 'PageInfo',
      description: 'Pagination metadata following the Relay specification.',
      fields: [
        { name: 'hasNextPage', type: 'Boolean', required: true },
        { name: 'hasPreviousPage', type: 'Boolean', required: true },
        { name: 'startCursor', type: 'String', required: false },
        { name: 'endCursor', type: 'String', required: false },
      ],
    };

    const edgeFields: GraphQLFieldDef[] = [
      { name: 'node', type: typeName, required: true },
      { name: 'cursor', type: 'String', required: true },
    ];

    const edgeType: GraphQLTypeDef = {
      name: `${typeName}Edge`,
      description: `An edge in a ${typeName} connection.`,
      fields: edgeFields,
    };

    const connectionFields: GraphQLFieldDef[] = [
      { name: 'edges', type: `${typeName}Edge`, required: true, isList: true },
      { name: 'pageInfo', type: 'PageInfo', required: true },
      { name: 'totalCount', type: 'Int', required: true },
    ];

    const connectionType: GraphQLTypeDef = {
      name: `${typeName}Connection`,
      description: `A connection to a list of ${typeName} items.`,
      fields: connectionFields,
    };

    return [pageInfoType, edgeType, connectionType];
  }

  /**
   * Generate a GraphQL SDL string for the Connection, Edge, and PageInfo
   * types for a given type name.
   */
  generateConnectionSDL(typeName: string): string {
    const types = this.generateConnectionTypes(typeName);
    const parts: string[] = [];

    for (const typeDef of types) {
      const lines: string[] = [];
      if (typeDef.description) {
        lines.push(`"""${typeDef.description}"""`);
      }
      lines.push(`type ${typeDef.name} {`);
      for (const field of typeDef.fields) {
        const typeStr = field.isList
          ? `[${field.type}${field.required ? '!' : ''}]!`
          : `${field.type}${field.required ? '!' : ''}`;
        lines.push(`  ${field.name}: ${typeStr}`);
      }
      lines.push('}');
      parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
  }

  /** Return the current configuration (read-only snapshot). */
  getConfig(): Readonly<Required<PaginationConfig>> {
    return { ...this.config };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private clampPageSize(size: number | undefined): number | undefined {
    if (size == null) return undefined;
    return Math.min(Math.max(size, 1), this.config.maxPageSize);
  }
}

/** Factory function to create a {@link PaginationHelper}. */
export function createPaginationHelper(
  config: PaginationConfig = {},
): PaginationHelper {
  return new PaginationHelper(config);
}

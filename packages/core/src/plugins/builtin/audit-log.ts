import type { Document } from '../../types/document.js';
import type { DeleteContext, InsertContext, PluginDefinition, UpdateContext } from '../types.js';

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  operation: 'insert' | 'update' | 'delete';
  collection: string;
  documentId: string;
  userId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Audit log storage interface
 */
export interface AuditLogStorage {
  append(entry: AuditLogEntry): Promise<void>;
  query(options: AuditLogQueryOptions): Promise<AuditLogEntry[]>;
  clear(): Promise<void>;
}

/**
 * Audit log query options
 */
export interface AuditLogQueryOptions {
  collection?: string;
  documentId?: string;
  operation?: 'insert' | 'update' | 'delete';
  userId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * Audit log plugin options
 */
export interface AuditLogPluginOptions {
  /** Storage for audit logs */
  storage: AuditLogStorage;
  /** Function to get current user ID */
  getUserId?: () => string | undefined;
  /** Collections to audit (empty = all) */
  collections?: string[];
  /** Whether to include document values in logs */
  includeValues?: boolean;
  /** Additional metadata to include in each log entry */
  getMetadata?: () => Record<string, unknown>;
}

/**
 * Generate unique ID
 */
function generateAuditId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create an audit log plugin
 */
export function createAuditLogPlugin(options: AuditLogPluginOptions): PluginDefinition {
  const { storage, getUserId, collections, includeValues = false, getMetadata } = options;

  const shouldAudit = (collection: string): boolean => {
    if (!collections || collections.length === 0) {
      return true;
    }
    return collections.includes(collection);
  };

  return {
    name: 'audit-log',
    version: '1.0.0',
    priority: -100, // Run after other plugins

    afterInsert: async (document: Document, context: InsertContext) => {
      if (!shouldAudit(context.collection)) return;

      const entry: AuditLogEntry = {
        id: generateAuditId(),
        timestamp: context.timestamp,
        operation: 'insert',
        collection: context.collection,
        documentId: document._id,
        userId: getUserId?.(),
        newValue: includeValues ? document : undefined,
        metadata: getMetadata?.(),
      };

      await storage.append(entry);
    },

    afterUpdate: async (document: Document, context: UpdateContext) => {
      if (!shouldAudit(context.collection)) return;

      const entry: AuditLogEntry = {
        id: generateAuditId(),
        timestamp: context.timestamp,
        operation: 'update',
        collection: context.collection,
        documentId: context.documentId,
        userId: getUserId?.(),
        previousValue: includeValues ? context.existingDocument : undefined,
        newValue: includeValues ? document : undefined,
        metadata: getMetadata?.(),
      };

      await storage.append(entry);
    },

    afterDelete: async (context: DeleteContext) => {
      if (!shouldAudit(context.collection)) return;

      const entry: AuditLogEntry = {
        id: generateAuditId(),
        timestamp: context.timestamp,
        operation: 'delete',
        collection: context.collection,
        documentId: context.documentId,
        userId: getUserId?.(),
        previousValue: includeValues ? context.existingDocument : undefined,
        metadata: getMetadata?.(),
      };

      await storage.append(entry);
    },
  };
}

/**
 * In-memory audit log storage (for development/testing)
 */
export class InMemoryAuditLogStorage implements AuditLogStorage {
  private entries: AuditLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);

    // Trim if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  async query(options: AuditLogQueryOptions): Promise<AuditLogEntry[]> {
    let results = this.entries;

    if (options.collection) {
      results = results.filter((e) => e.collection === options.collection);
    }

    if (options.documentId) {
      results = results.filter((e) => e.documentId === options.documentId);
    }

    if (options.operation) {
      results = results.filter((e) => e.operation === options.operation);
    }

    if (options.userId) {
      results = results.filter((e) => e.userId === options.userId);
    }

    if (options.startTime !== undefined) {
      results = results.filter((e) => e.timestamp >= options.startTime!);
    }

    if (options.endTime !== undefined) {
      results = results.filter((e) => e.timestamp <= options.endTime!);
    }

    // Sort by timestamp descending (newest first)
    results = results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  getEntryCount(): number {
    return this.entries.length;
  }
}

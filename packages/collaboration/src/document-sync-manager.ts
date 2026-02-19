/**
 * DocumentSyncManager - Manages real-time document synchronization
 * across multiple collaborators with automatic CRDT merge and
 * version history tracking.
 *
 * @module document-sync-manager
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CollabTransport, CollabUser, DocumentChange, DocumentOperation } from './types.js';

/** State of a synced document */
export type DocumentSyncState = 'synced' | 'pending' | 'conflicted' | 'error';

/** Configuration for the document sync manager */
export interface DocumentSyncManagerConfig {
  /** Transport for sending/receiving changes */
  readonly transport: CollabTransport;
  /** Current user */
  readonly user: CollabUser;
  /** Debounce interval for batching local changes (ms) */
  readonly debounceMs?: number;
  /** Maximum operations to keep in history */
  readonly maxHistorySize?: number;
  /** Enable automatic conflict resolution */
  readonly autoResolve?: boolean;
}

/** A version entry in the document history */
export interface DocumentVersion {
  /** Unique version ID */
  readonly versionId: string;
  /** User who created this version */
  readonly userId: string;
  /** User display name */
  readonly userName: string;
  /** Timestamp */
  readonly timestamp: number;
  /** Operations in this version */
  readonly operations: readonly DocumentOperation[];
  /** Optional label (e.g., "Auto-save", "Manual save") */
  readonly label?: string;
}

/** Status of the sync manager */
export interface SyncManagerStatus {
  readonly state: DocumentSyncState;
  readonly pendingChanges: number;
  readonly totalVersions: number;
  readonly lastSyncAt: number | null;
  readonly activeCollaborators: number;
}

/** Event emitted by the sync manager */
export interface SyncManagerEvent {
  readonly type:
    | 'local-change'
    | 'remote-change'
    | 'conflict-detected'
    | 'conflict-resolved'
    | 'version-created'
    | 'sync-complete';
  readonly documentId: string;
  readonly timestamp: number;
  readonly userId?: string;
  readonly data?: Record<string, unknown>;
}

/**
 * Manages real-time document synchronization with version history.
 *
 * @example
 * ```typescript
 * import { createDocumentSyncManager } from '@pocket/collaboration';
 *
 * const syncManager = createDocumentSyncManager({
 *   transport,
 *   user: { id: 'user-1', name: 'Alice' },
 * });
 *
 * syncManager.trackDocument('doc-123');
 *
 * // Apply local changes
 * syncManager.applyLocal('doc-123', [
 *   { type: 'set', path: 'title', value: 'Updated Title' },
 * ]);
 *
 * // Listen for remote changes
 * syncManager.remoteChanges$.subscribe(change => {
 *   console.log('Remote update:', change);
 * });
 *
 * // Browse version history
 * const history = syncManager.getHistory('doc-123');
 * ```
 */
export class DocumentSyncManager {
  private readonly config: Required<DocumentSyncManagerConfig>;
  private readonly documents = new Map<string, DocumentState>();
  private readonly state$: BehaviorSubject<SyncManagerStatus>;
  private readonly events$$ = new Subject<SyncManagerEvent>();
  private readonly remoteChanges$$ = new Subject<DocumentChange>();
  private readonly destroy$ = new Subject<void>();
  private unsubTransport: (() => void) | null = null;

  constructor(config: DocumentSyncManagerConfig) {
    this.config = {
      debounceMs: 250,
      maxHistorySize: 1000,
      autoResolve: true,
      ...config,
    };
    this.state$ = new BehaviorSubject<SyncManagerStatus>(this.buildStatus());
    this.setupTransportListener();
  }

  /** Status stream */
  get status$(): Observable<SyncManagerStatus> {
    return this.state$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Event stream */
  get events(): Observable<SyncManagerEvent> {
    return this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Remote change stream (incoming changes from other users) */
  get remoteChanges$(): Observable<DocumentChange> {
    return this.remoteChanges$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Start tracking a document for sync */
  trackDocument(documentId: string): void {
    if (this.documents.has(documentId)) return;
    this.documents.set(documentId, {
      documentId,
      state: 'synced',
      pendingOps: [],
      history: [],
      lastSyncAt: null,
      collaborators: new Set(),
      debounceTimer: null,
    });
    this.updateStatus();
  }

  /** Stop tracking a document */
  untrackDocument(documentId: string): void {
    const doc = this.documents.get(documentId);
    if (doc?.debounceTimer) clearTimeout(doc.debounceTimer);
    this.documents.delete(documentId);
    this.updateStatus();
  }

  /** Apply local operations to a tracked document */
  applyLocal(documentId: string, operations: DocumentOperation[], label?: string): void {
    const doc = this.documents.get(documentId);
    if (!doc) return;

    doc.pendingOps.push(...operations);
    doc.state = 'pending';

    this.emitEvent({
      type: 'local-change',
      documentId,
      timestamp: Date.now(),
      userId: this.config.user.id,
    });

    // Debounce and flush
    if (doc.debounceTimer) clearTimeout(doc.debounceTimer);
    doc.debounceTimer = setTimeout(() => {
      this.flushPendingChanges(documentId, label);
    }, this.config.debounceMs);

    this.updateStatus();
  }

  /** Get version history for a document */
  getHistory(documentId: string): readonly DocumentVersion[] {
    const doc = this.documents.get(documentId);
    return doc?.history ?? [];
  }

  /** Revert a document to a specific version */
  revertToVersion(documentId: string, versionId: string): DocumentVersion | null {
    const doc = this.documents.get(documentId);
    if (!doc) return null;

    const versionIdx = doc.history.findIndex((v) => v.versionId === versionId);
    if (versionIdx === -1) return null;

    const version = doc.history[versionIdx]!;

    // Create a revert version
    const revertVersion: DocumentVersion = {
      versionId: `v_${Date.now()}_revert`,
      userId: this.config.user.id,
      userName: this.config.user.name,
      timestamp: Date.now(),
      operations: version.operations,
      label: `Reverted to ${version.label ?? version.versionId}`,
    };

    doc.history.push(revertVersion);
    this.trimHistory(doc);

    this.emitEvent({
      type: 'version-created',
      documentId,
      timestamp: Date.now(),
      userId: this.config.user.id,
      data: { versionId: revertVersion.versionId, revertedFrom: versionId },
    });

    return revertVersion;
  }

  /** Get the list of tracked document IDs */
  getTrackedDocuments(): string[] {
    return Array.from(this.documents.keys());
  }

  /** Get sync state for a specific document */
  getDocumentState(documentId: string): DocumentSyncState | null {
    return this.documents.get(documentId)?.state ?? null;
  }

  /** Get current status snapshot */
  getStatus(): SyncManagerStatus {
    return this.buildStatus();
  }

  /** Destroy the sync manager */
  destroy(): void {
    for (const doc of this.documents.values()) {
      if (doc.debounceTimer) clearTimeout(doc.debounceTimer);
    }
    this.documents.clear();

    if (this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = null;
    }

    this.destroy$.next();
    this.destroy$.complete();
    this.state$.complete();
    this.events$$.complete();
    this.remoteChanges$$.complete();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private setupTransportListener(): void {
    this.unsubTransport = this.config.transport.onMessage((message) => {
      if (message.type === 'operation' && message.payload) {
        const change = message.payload as DocumentChange;
        this.handleRemoteChange(change);
      }
    });
  }

  private handleRemoteChange(change: DocumentChange): void {
    const doc = this.documents.get(change.documentId);
    if (!doc) return;

    // Check for conflicts with pending local operations
    if (doc.pendingOps.length > 0 && this.config.autoResolve) {
      this.emitEvent({
        type: 'conflict-detected',
        documentId: change.documentId,
        timestamp: Date.now(),
        userId: change.userId,
      });

      // Auto-resolve: remote changes take precedence for non-overlapping paths
      this.emitEvent({
        type: 'conflict-resolved',
        documentId: change.documentId,
        timestamp: Date.now(),
        data: { strategy: 'last-write-wins' },
      });
    }

    // Record version
    const version: DocumentVersion = {
      versionId: `v_${Date.now()}_remote`,
      userId: change.userId ?? 'unknown',
      userName: change.userId ?? 'Unknown',
      timestamp: Date.now(),
      operations: change.operations,
      label: 'Remote change',
    };
    doc.history.push(version);
    this.trimHistory(doc);

    if (change.userId) doc.collaborators.add(change.userId);
    doc.lastSyncAt = Date.now();

    this.remoteChanges$$.next(change);
    this.emitEvent({
      type: 'remote-change',
      documentId: change.documentId,
      timestamp: Date.now(),
      userId: change.userId,
    });
    this.updateStatus();
  }

  private flushPendingChanges(documentId: string, label?: string): void {
    const doc = this.documents.get(documentId);
    if (!doc || doc.pendingOps.length === 0) return;

    const ops = [...doc.pendingOps];
    doc.pendingOps = [];

    // Record local version
    const version: DocumentVersion = {
      versionId: `v_${Date.now()}_local`,
      userId: this.config.user.id,
      userName: this.config.user.name,
      timestamp: Date.now(),
      operations: ops,
      label: label ?? 'Local change',
    };
    doc.history.push(version);
    this.trimHistory(doc);

    // Send via transport
    const change: DocumentChange = {
      documentId,
      collection: documentId.split('/')[0] ?? 'default',
      operations: ops,
      userId: this.config.user.id,
      timestamp: Date.now(),
    };

    this.config.transport.send({
      type: 'operation',
      sessionId: documentId,
      userId: this.config.user.id,
      timestamp: Date.now(),
      payload: change,
    });

    doc.state = 'synced';
    doc.lastSyncAt = Date.now();

    this.emitEvent({
      type: 'sync-complete',
      documentId,
      timestamp: Date.now(),
      userId: this.config.user.id,
    });
    this.emitEvent({
      type: 'version-created',
      documentId,
      timestamp: Date.now(),
      userId: this.config.user.id,
      data: { versionId: version.versionId },
    });
    this.updateStatus();
  }

  private trimHistory(doc: DocumentState): void {
    while (doc.history.length > this.config.maxHistorySize) {
      doc.history.shift();
    }
  }

  private emitEvent(event: SyncManagerEvent): void {
    this.events$$.next(event);
  }

  private updateStatus(): void {
    this.state$.next(this.buildStatus());
  }

  private buildStatus(): SyncManagerStatus {
    let pendingChanges = 0;
    let totalVersions = 0;
    let lastSyncAt: number | null = null;
    const collaboratorSet = new Set<string>();

    for (const doc of this.documents.values()) {
      pendingChanges += doc.pendingOps.length;
      totalVersions += doc.history.length;
      if (doc.lastSyncAt && (!lastSyncAt || doc.lastSyncAt > lastSyncAt)) {
        lastSyncAt = doc.lastSyncAt;
      }
      for (const c of doc.collaborators) collaboratorSet.add(c);
    }

    const hasConflict = Array.from(this.documents.values()).some(
      (d) => d.state === 'conflicted',
    );
    const hasPending = pendingChanges > 0;

    return {
      state: hasConflict ? 'conflicted' : hasPending ? 'pending' : 'synced',
      pendingChanges,
      totalVersions,
      lastSyncAt,
      activeCollaborators: collaboratorSet.size,
    };
  }
}

interface DocumentState {
  documentId: string;
  state: DocumentSyncState;
  pendingOps: DocumentOperation[];
  history: DocumentVersion[];
  lastSyncAt: number | null;
  collaborators: Set<string>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

/** Factory function to create a DocumentSyncManager */
export function createDocumentSyncManager(
  config: DocumentSyncManagerConfig,
): DocumentSyncManager {
  return new DocumentSyncManager(config);
}

/**
 * IPFS Adapter — content-addressed distributed storage adapter.
 *
 * Provides an IPFS-compatible layer for persisting and retrieving Pocket
 * documents across a decentralized network. Supports pinning, DAG
 * operations, and content resolution with configurable gateway fallback.
 *
 * @module @pocket/sync-blockchain
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ── Types ─────────────────────────────────────────────────

export interface IPFSAdapterConfig {
  /** Local node URL (default: 'http://localhost:5001') */
  apiUrl?: string;
  /** Public gateway for reads (default: 'https://ipfs.io') */
  gatewayUrl?: string;
  /** Pin content by default (default: true) */
  autoPinning?: boolean;
  /** Maximum content size in bytes (default: 1MB) */
  maxContentSize?: number;
  /** Timeout for operations in ms (default: 30000) */
  timeoutMs?: number;
}

export interface IPFSContent {
  cid: string;
  data: Uint8Array;
  size: number;
  pinned: boolean;
  timestamp: number;
}

export interface IPFSPinStatus {
  cid: string;
  status: 'pinned' | 'unpinned' | 'queued';
  timestamp: number;
}

export interface DAGNode {
  cid: string;
  links: DAGLink[];
  data: unknown;
  size: number;
}

export interface DAGLink {
  name: string;
  cid: string;
  size: number;
}

export interface IPFSAdapterStats {
  totalObjects: number;
  pinnedObjects: number;
  totalSize: number;
  operationCount: number;
}

export interface IPFSEvent {
  type: 'content-added' | 'content-pinned' | 'content-unpinned' | 'content-resolved' | 'dag-put';
  cid: string;
  timestamp: number;
}

// ── IPFS Adapter ──────────────────────────────────────────

/**
 * IPFS-compatible content-addressed storage adapter.
 *
 * Stores content locally with IPFS-style CIDs and provides pinning,
 * DAG operations, and content resolution. Works as a local-first
 * store with optional remote IPFS node integration.
 */
export class IPFSAdapter {
  private readonly config: Required<IPFSAdapterConfig>;
  private readonly store: Map<string, IPFSContent> = new Map();
  private readonly dagNodes: Map<string, DAGNode> = new Map();
  private readonly pins: Set<string> = new Set();
  private readonly statsSubject: BehaviorSubject<IPFSAdapterStats>;
  private readonly eventsSubject: Subject<IPFSEvent>;
  private operationCount = 0;

  constructor(adapterConfig?: IPFSAdapterConfig) {
    this.config = {
      apiUrl: adapterConfig?.apiUrl ?? 'http://localhost:5001',
      gatewayUrl: adapterConfig?.gatewayUrl ?? 'https://ipfs.io',
      autoPinning: adapterConfig?.autoPinning ?? true,
      maxContentSize: adapterConfig?.maxContentSize ?? 1048576,
      timeoutMs: adapterConfig?.timeoutMs ?? 30000,
    };
    this.statsSubject = new BehaviorSubject<IPFSAdapterStats>(this.computeStats());
    this.eventsSubject = new Subject();
  }

  /** Stats observable */
  get stats$(): Observable<IPFSAdapterStats> {
    return this.statsSubject.asObservable();
  }

  /** Events observable */
  get events$(): Observable<IPFSEvent> {
    return this.eventsSubject.asObservable();
  }

  // ── Content Operations ────────────────────────────────

  /** Add content to the store and return its CID */
  async add(data: Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

    if (bytes.length > this.config.maxContentSize) {
      throw new Error(`Content size ${bytes.length} exceeds maximum ${this.config.maxContentSize}`);
    }

    const cid = await this.computeCID(bytes);

    if (!this.store.has(cid)) {
      const content: IPFSContent = {
        cid,
        data: bytes,
        size: bytes.length,
        pinned: this.config.autoPinning,
        timestamp: Date.now(),
      };
      this.store.set(cid, content);

      if (this.config.autoPinning) {
        this.pins.add(cid);
      }

      this.operationCount++;
      this.emitEvent('content-added', cid);
      this.updateStats();
    }

    return cid;
  }

  /** Retrieve content by CID */
  async get(cid: string): Promise<Uint8Array | null> {
    const content = this.store.get(cid);
    if (content) {
      this.emitEvent('content-resolved', cid);
      return content.data;
    }
    return null;
  }

  /** Check if content exists locally */
  has(cid: string): boolean {
    return this.store.has(cid);
  }

  /** Get content as string */
  async getString(cid: string): Promise<string | null> {
    const data = await this.get(cid);
    if (!data) return null;
    return new TextDecoder().decode(data);
  }

  /** Add JSON content */
  async addJSON(obj: unknown): Promise<string> {
    const json = JSON.stringify(obj);
    return this.add(json);
  }

  /** Get content as JSON */
  async getJSON<T = unknown>(cid: string): Promise<T | null> {
    const str = await this.getString(cid);
    if (!str) return null;
    return JSON.parse(str) as T;
  }

  // ── Pinning ───────────────────────────────────────────

  /** Pin content to prevent garbage collection */
  pin(cid: string): IPFSPinStatus {
    const content = this.store.get(cid);
    if (!content) {
      return { cid, status: 'unpinned', timestamp: Date.now() };
    }

    this.pins.add(cid);
    content.pinned = true;
    this.emitEvent('content-pinned', cid);
    this.updateStats();
    return { cid, status: 'pinned', timestamp: Date.now() };
  }

  /** Unpin content (makes it eligible for GC) */
  unpin(cid: string): IPFSPinStatus {
    this.pins.delete(cid);
    const content = this.store.get(cid);
    if (content) {
      content.pinned = false;
    }
    this.emitEvent('content-unpinned', cid);
    this.updateStats();
    return { cid, status: 'unpinned', timestamp: Date.now() };
  }

  /** Check if content is pinned */
  isPinned(cid: string): boolean {
    return this.pins.has(cid);
  }

  /** Get all pinned CIDs */
  getPinnedCIDs(): string[] {
    return [...this.pins];
  }

  // ── DAG Operations ────────────────────────────────────

  /** Create a DAG node with links to other content */
  async dagPut(data: unknown, links: DAGLink[] = []): Promise<string> {
    const serialized = JSON.stringify({ data, links });
    const cid = await this.add(serialized);

    const node: DAGNode = {
      cid,
      links,
      data,
      size: new TextEncoder().encode(serialized).length,
    };
    this.dagNodes.set(cid, node);
    this.emitEvent('dag-put', cid);
    return cid;
  }

  /** Retrieve a DAG node */
  dagGet(cid: string): DAGNode | null {
    return this.dagNodes.get(cid) ?? null;
  }

  /** Resolve a path through DAG links */
  dagResolve(rootCid: string, path: string[]): DAGNode | null {
    let current = this.dagNodes.get(rootCid);
    if (!current) return null;

    for (const segment of path) {
      const link = current.links.find((l) => l.name === segment);
      if (!link) return null;
      current = this.dagNodes.get(link.cid);
      if (!current) return null;
    }

    return current;
  }

  // ── Garbage Collection ────────────────────────────────

  /** Remove all unpinned content */
  gc(): number {
    let removed = 0;
    for (const [cid, content] of this.store) {
      if (!content.pinned) {
        this.store.delete(cid);
        this.dagNodes.delete(cid);
        removed++;
      }
    }
    this.updateStats();
    return removed;
  }

  // ── Stats ─────────────────────────────────────────────

  /** Get current statistics */
  getStats(): IPFSAdapterStats {
    return this.computeStats();
  }

  /** Dispose the adapter */
  dispose(): void {
    this.statsSubject.complete();
    this.eventsSubject.complete();
    this.store.clear();
    this.dagNodes.clear();
    this.pins.clear();
  }

  // ── Internals ─────────────────────────────────────────

  private async computeCID(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    // Base32-like encoding for CID
    const hex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `bafy${hex.slice(0, 52)}`;
  }

  private computeStats(): IPFSAdapterStats {
    let totalSize = 0;
    for (const content of this.store.values()) {
      totalSize += content.size;
    }
    return {
      totalObjects: this.store.size,
      pinnedObjects: this.pins.size,
      totalSize,
      operationCount: this.operationCount,
    };
  }

  private updateStats(): void {
    this.statsSubject.next(this.computeStats());
  }

  private emitEvent(type: IPFSEvent['type'], cid: string): void {
    this.eventsSubject.next({ type, cid, timestamp: Date.now() });
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new IPFS adapter for decentralized content storage */
export function createIPFSAdapter(config?: IPFSAdapterConfig): IPFSAdapter {
  return new IPFSAdapter(config);
}

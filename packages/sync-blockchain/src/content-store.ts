/**
 * Content-Addressed Storage for @pocket/sync-blockchain.
 *
 * Stores documents by their content hash (SHA-256), enabling
 * deduplication, integrity verification, and efficient sync.
 *
 * ## How It Works
 *
 * ```
 * Document → serialize → SHA-256 hash → CID → store(cid, bytes)
 * ```
 *
 * Content is immutable once stored - the same data always produces
 * the same CID, making it safe to share and verify across peers.
 *
 * @example
 * ```typescript
 * const store = createContentStore();
 * const cid = await store.put(myData);
 * const data = await store.get(cid);
 * ```
 *
 * @module @pocket/sync-blockchain/content-store
 */

import { BehaviorSubject, Subject } from 'rxjs';

import type { CID, PinningConfig, StorageConfig } from './types.js';
import { DEFAULT_PINNING_CONFIG, DEFAULT_STORAGE_CONFIG } from './types.js';

/** Internal representation of a stored block. */
interface StoredBlock {
  readonly cid: CID;
  readonly data: Uint8Array;
  readonly pinned: boolean;
  readonly createdAt: number;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
}

/**
 * Content-addressed storage engine.
 *
 * Stores and retrieves data blocks by their content hash. Supports
 * pinning for persistence and garbage collection for unpinned content.
 *
 * @example
 * ```typescript
 * const store = createContentStore();
 *
 * // Store data and get its CID
 * const cid = await store.put(new TextEncoder().encode('hello'));
 *
 * // Retrieve by CID
 * const data = await store.get(cid.hash);
 *
 * // Pin for persistence
 * store.pin(cid.hash);
 *
 * // Run garbage collection
 * const freed = store.gc();
 * ```
 */
export class ContentStore {
  private readonly blocks = new Map<string, StoredBlock>();
  private readonly pinningConfig: PinningConfig;
  private readonly storageConfig: StorageConfig;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private readonly destroy$ = new Subject<void>();

  /** Observable count of stored blocks. */
  readonly blockCount$ = new BehaviorSubject<number>(0);

  /** Observable total storage usage in bytes. */
  readonly storageUsage$ = new BehaviorSubject<number>(0);

  constructor(
    pinningConfig: Partial<PinningConfig> = {},
    storageConfig: Partial<StorageConfig> = {},
  ) {
    this.pinningConfig = { ...DEFAULT_PINNING_CONFIG, ...pinningConfig };
    this.storageConfig = { ...DEFAULT_STORAGE_CONFIG, ...storageConfig };

    if (this.storageConfig.enableAutoGc) {
      this.gcTimer = setInterval(() => this.gc(), this.storageConfig.gcIntervalMs);
    }
  }

  /**
   * Compute the SHA-256 hash of data and return it as a hex string.
   */
  async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate a CID for the given data.
   */
  async generateCID(data: Uint8Array, codec: CID['codec'] = 'json'): Promise<CID> {
    const hash = await this.computeHash(data);
    return { hash, algorithm: 'sha-256', codec, version: 1 };
  }

  /**
   * Validate that a CID matches the given data.
   */
  async validateCID(cid: CID, data: Uint8Array): Promise<boolean> {
    const computed = await this.computeHash(data);
    return computed === cid.hash;
  }

  /**
   * Store data and return its CID.
   * If the data already exists, returns the existing CID without duplication.
   */
  async put(data: Uint8Array, codec: CID['codec'] = 'json'): Promise<CID> {
    const cid = await this.generateCID(data, codec);

    if (this.blocks.has(cid.hash)) {
      return cid;
    }

    const totalSize = this.storageUsage$.getValue() + data.byteLength;
    if (totalSize > this.storageConfig.maxStorageBytes) {
      this.gc();
      const sizeAfterGc = this.storageUsage$.getValue() + data.byteLength;
      if (sizeAfterGc > this.storageConfig.maxStorageBytes) {
        throw new Error(
          `Storage limit exceeded: ${sizeAfterGc} > ${this.storageConfig.maxStorageBytes} bytes`,
        );
      }
    }

    const block: StoredBlock = {
      cid,
      data: new Uint8Array(data),
      pinned: this.pinningConfig.autoPinNew,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
    };

    this.blocks.set(cid.hash, block);
    this.updateStats();

    return cid;
  }

  /**
   * Retrieve data by its content hash.
   * Returns `null` if the content is not found.
   */
  get(hash: string): Uint8Array | null {
    const block = this.blocks.get(hash);
    if (!block) {
      return null;
    }

    // Update access metadata (cast to mutable for internal tracking)
    const updated: StoredBlock = {
      ...block,
      lastAccessedAt: Date.now(),
      accessCount: block.accessCount + 1,
    };
    this.blocks.set(hash, updated);

    return new Uint8Array(block.data);
  }

  /**
   * Check if content exists in the store.
   */
  has(hash: string): boolean {
    return this.blocks.has(hash);
  }

  /**
   * Delete content by its hash. Pinned content will not be deleted
   * unless `force` is set to `true`.
   */
  delete(hash: string, force = false): boolean {
    const block = this.blocks.get(hash);
    if (!block) {
      return false;
    }
    if (block.pinned && !force) {
      return false;
    }
    this.blocks.delete(hash);
    this.updateStats();
    return true;
  }

  /**
   * Pin content for persistence (prevents garbage collection).
   */
  pin(hash: string): boolean {
    const block = this.blocks.get(hash);
    if (!block) {
      return false;
    }

    const pinnedCount = this.getPinnedCount();
    if (pinnedCount >= this.pinningConfig.maxPinned) {
      throw new Error(`Pin limit reached: ${this.pinningConfig.maxPinned}`);
    }

    this.blocks.set(hash, { ...block, pinned: true });
    return true;
  }

  /**
   * Unpin content, allowing it to be garbage collected.
   */
  unpin(hash: string): boolean {
    const block = this.blocks.get(hash);
    if (!block) {
      return false;
    }
    this.blocks.set(hash, { ...block, pinned: false });
    return true;
  }

  /**
   * Check if content is pinned.
   */
  isPinned(hash: string): boolean {
    const block = this.blocks.get(hash);
    return block?.pinned ?? false;
  }

  /**
   * Serialize data to a Uint8Array for storage.
   */
  serialize(data: unknown): Uint8Array {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json);
  }

  /**
   * Deserialize a Uint8Array back to a value.
   */
  deserialize<T = unknown>(data: Uint8Array): T {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json) as T;
  }

  /**
   * Run garbage collection, removing unpinned content based on eviction strategy.
   * Returns the number of bytes freed.
   */
  gc(): number {
    const unpinned: StoredBlock[] = [];
    for (const block of this.blocks.values()) {
      if (!block.pinned) {
        unpinned.push(block);
      }
    }

    if (unpinned.length === 0) {
      return 0;
    }

    const currentUsage = this.storageUsage$.getValue();
    if (currentUsage <= this.storageConfig.maxStorageBytes * 0.8) {
      return 0;
    }

    // Sort based on eviction strategy
    switch (this.pinningConfig.evictionStrategy) {
      case 'lru':
        unpinned.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        break;
      case 'lfu':
        unpinned.sort((a, b) => a.accessCount - b.accessCount);
        break;
      case 'fifo':
        unpinned.sort((a, b) => a.createdAt - b.createdAt);
        break;
    }

    let freedBytes = 0;
    const targetUsage = this.storageConfig.maxStorageBytes * 0.7;

    for (const block of unpinned) {
      if (currentUsage - freedBytes <= targetUsage) {
        break;
      }
      this.blocks.delete(block.cid.hash);
      freedBytes += block.data.byteLength;
    }

    this.updateStats();
    return freedBytes;
  }

  /**
   * Get all stored CID hashes.
   */
  getAllHashes(): string[] {
    return Array.from(this.blocks.keys());
  }

  /**
   * Get the number of pinned blocks.
   */
  getPinnedCount(): number {
    let count = 0;
    for (const block of this.blocks.values()) {
      if (block.pinned) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.gcTimer !== null) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.blockCount$.complete();
    this.storageUsage$.complete();
    this.blocks.clear();
  }

  private updateStats(): void {
    this.blockCount$.next(this.blocks.size);
    let totalBytes = 0;
    for (const block of this.blocks.values()) {
      totalBytes += block.data.byteLength;
    }
    this.storageUsage$.next(totalBytes);
  }
}

/**
 * Create a new ContentStore instance.
 *
 * @example
 * ```typescript
 * const store = createContentStore({
 *   pinning: { autoPinNew: true, maxPinned: 5000 },
 *   storage: { maxStorageBytes: 50 * 1024 * 1024 },
 * });
 * ```
 */
export function createContentStore(
  config: { pinning?: Partial<PinningConfig>; storage?: Partial<StorageConfig> } = {},
): ContentStore {
  return new ContentStore(config.pinning, config.storage);
}

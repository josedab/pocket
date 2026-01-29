/**
 * @pocket/storage-opfs - Origin Private File System Storage Adapter
 *
 * This package provides high-performance file-based storage using the
 * browser's Origin Private File System (OPFS) API. Ideal for large datasets
 * and SQLite-based storage backends.
 *
 * ## Features
 *
 * - **High Performance**: Synchronous file access in Web Workers
 * - **Large Datasets**: No practical size limits (file system based)
 * - **SQLite Ready**: Perfect backend for running SQLite in the browser
 * - **Origin Isolated**: Private to your origin, not visible to users
 * - **WAL Support**: Write-Ahead Logging for durability
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createOPFSStorage } from '@pocket/storage-opfs';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createOPFSStorage({
 *     workerUrl: '/workers/opfs-worker.js',
 *     useWorker: true
 *   })
 * });
 * ```
 *
 * ## Worker Setup
 *
 * For optimal performance, OPFS operations should run in a Web Worker.
 * Create a worker file that handles OPFS operations:
 *
 * ```typescript
 * // opfs-worker.js
 * import { handleOPFSRequest } from '@pocket/storage-opfs/worker';
 *
 * self.onmessage = (event) => handleOPFSRequest(event);
 * ```
 *
 * ## Browser Support
 *
 * - Chrome 86+ (full support)
 * - Edge 86+ (full support)
 * - Firefox 111+ (full support)
 * - Safari 15.2+ (partial support)
 *
 * @packageDocumentation
 * @module @pocket/storage-opfs
 *
 * @see {@link createOPFSStorage} for the main factory function
 * @see {@link OPFSAdapter} for the adapter class
 */

export * from './adapter.js';
export * from './wal.js';

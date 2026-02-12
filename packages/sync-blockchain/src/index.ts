/**
 * @pocket/sync-blockchain - Decentralized P2P Sync with Blockchain Audit Trails
 *
 * This package provides decentralized synchronization for Pocket databases
 * using content-addressed storage (IPFS-style) with immutable blockchain
 * audit trails.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                         Client Application                          │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                       P2P Sync Engine                                │
 * │                                                                      │
 * │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
 * │  │ Content      │  │ Merkle DAG      │  │ Identity              │  │
 * │  │ Store        │  │ (history graph) │  │ Manager               │  │
 * │  │ (CAS)        │  │                 │  │ (DID + signing)       │  │
 * │  └──────────────┘  └─────────────────┘  └───────────────────────┘  │
 * │                                                                      │
 * │  ┌──────────────────────────────────────────────────────────────┐   │
 * │  │                    Audit Chain                                │   │
 * │  │  ┌─────────────────────┐    ┌────────────────────────────┐   │   │
 * │  │  │  Immutable Log      │    │  Compliance Export         │   │   │
 * │  │  │  (append-only)      │    │  (query + verify)          │   │   │
 * │  │  └─────────────────────┘    └────────────────────────────┘   │   │
 * │  └──────────────────────────────────────────────────────────────┘   │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                    ┌────────────┼────────────┐
 *                    ▼            ▼            ▼
 *               [Peer A]    [Peer B]    [HTTP Fallback]
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createContentStore,
 *   createMerkleDAG,
 *   createIdentityManager,
 *   createP2PSync,
 *   createAuditChain,
 * } from '@pocket/sync-blockchain';
 *
 * // Set up content-addressed storage
 * const store = createContentStore();
 *
 * // Create Merkle DAG for version history
 * const dag = createMerkleDAG(store);
 *
 * // Set up identity management
 * const identity = createIdentityManager();
 * const keyPair = await identity.generateKeyPair();
 * const did = identity.createDID(keyPair);
 *
 * // Start P2P sync
 * const sync = createP2PSync(store, dag, identity, {
 *   collections: ['todos', 'notes'],
 * });
 * await sync.start();
 *
 * // Create audit chain
 * const audit = createAuditChain();
 * ```
 *
 * @packageDocumentation
 * @module @pocket/sync-blockchain
 */

export * from './types.js';

export {
  ContentStore,
  createContentStore,
} from './content-store.js';

export {
  MerkleDAG,
  createMerkleDAG,
} from './merkle-dag.js';

export {
  IdentityManager,
  createIdentityManager,
} from './identity.js';

export {
  P2PSync,
  createP2PSync,
} from './p2p-sync.js';

export {
  AuditChain,
  createAuditChain,
} from './audit-chain.js';

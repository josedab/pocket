/**
 * @pocket/distributed-query - Distributed query execution for Pocket
 *
 * @example
 * ```typescript
 * import { createDistributedQueryEngine } from '@pocket/distributed-query';
 *
 * // Create an engine with custom configuration
 * const engine = createDistributedQueryEngine({
 *   maxFanout: 5,
 *   timeoutMs: 10_000,
 *   retryAttempts: 3,
 * }, 'node-local');
 *
 * // Register peer nodes
 * engine.registerNode({
 *   id: 'node-1',
 *   status: 'active',
 *   lastSeen: Date.now(),
 *   capabilities: ['aggregation'],
 *   dataRanges: [{ collection: 'orders' }],
 * });
 *
 * // Execute a distributed query
 * const result = engine.execute({
 *   id: 'q-1',
 *   collection: 'orders',
 *   filter: { status: 'completed' },
 *   aggregation: { function: 'sum', field: 'total' },
 *   limit: 100,
 * });
 *
 * console.log(result.data);
 * console.log(result.aggregationResult);
 * console.log(engine.getStats());
 * ```
 */

// Types
export type {
  AggregationSpec,
  DataRange,
  DistributedQuery,
  DistributedQueryConfig,
  NodeInfo,
  NodeMessage,
  QueryResult,
  SubQuery,
} from './types.js';

export { DEFAULT_DISTRIBUTED_CONFIG } from './types.js';

// Node Registry
export { NodeRegistry, createNodeRegistry } from './node-registry.js';

// Query Decomposer
export { QueryDecomposer, createQueryDecomposer } from './query-decomposer.js';

// Result Aggregator
export { ResultAggregator, createResultAggregator } from './result-aggregator.js';

// Distributed Query Engine
export type { EngineStats } from './distributed-query-engine.js';

export {
  DistributedQueryEngine,
  createDistributedQueryEngine,
} from './distributed-query-engine.js';

// P2P Transport
export type {
  P2PTransportConfig,
  PeerConnectionState,
  TransportMessage,
  PeerInfo as TransportPeerInfo,
  TransportStats,
  TransportType,
} from './p2p-transport.js';

export { P2PTransport, createP2PTransport } from './p2p-transport.js';

// Gossip Protocol
export type {
  GossipConfig,
  GossipMessage,
  GossipPayload,
  GossipState,
  GossipStats,
} from './gossip-protocol.js';

export { GossipProtocol, createGossipProtocol } from './gossip-protocol.js';

// Sync Mesh
export type {
  MeshChange,
  MeshStats,
  MeshStatus,
  MeshTopology,
  SyncMeshConfig,
} from './sync-mesh.js';

export { SyncMesh, createSyncMesh } from './sync-mesh.js';

// Query Planner
export { QueryPlanner, createQueryPlanner } from './query-planner.js';
export type { PlannerConfig, QueryPlan, SubPlan } from './query-planner.js';

// P2P Channel
export { P2PChannel, createP2PChannel } from './p2p-channel.js';
export type { P2PChannelConfig, P2PMessage } from './p2p-channel.js';

// Result Merger
export { ResultMerger, createResultMerger } from './result-merger.js';
export type { MergedResult, MergerConfig, PartialResult } from './result-merger.js';

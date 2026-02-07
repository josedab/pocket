import { describe, it, expect, beforeEach } from 'vitest';
import { QueryDecomposer, createQueryDecomposer } from '../query-decomposer.js';
import type { DistributedQuery, DistributedQueryConfig, NodeInfo } from '../types.js';
import { DEFAULT_DISTRIBUTED_CONFIG } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: overrides.id ?? 'node-1',
    status: overrides.status ?? 'active',
    lastSeen: overrides.lastSeen ?? Date.now(),
    capabilities: overrides.capabilities ?? [],
    dataRanges: overrides.dataRanges,
  };
}

function makeQuery(overrides: Partial<DistributedQuery> = {}): DistributedQuery {
  return {
    id: overrides.id ?? 'q-1',
    collection: overrides.collection ?? 'orders',
    filter: overrides.filter,
    aggregation: overrides.aggregation,
    sort: overrides.sort,
    limit: overrides.limit,
    timeout: overrides.timeout,
  };
}

/* ================================================================== */
/*  QueryDecomposer                                                    */
/* ================================================================== */

describe('QueryDecomposer', () => {
  let decomposer: QueryDecomposer;

  beforeEach(() => {
    decomposer = createQueryDecomposer(DEFAULT_DISTRIBUTED_CONFIG);
  });

  it('should decompose a query across multiple nodes', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })];

    const subQueries = decomposer.decompose(makeQuery(), nodes);
    expect(subQueries).toHaveLength(3);
    expect(subQueries.every((sq) => sq.status === 'pending')).toBe(true);
    expect(subQueries.map((sq) => sq.nodeId)).toEqual(['n1', 'n2', 'n3']);
  });

  it('should respect maxFanout limit', () => {
    const config: DistributedQueryConfig = { ...DEFAULT_DISTRIBUTED_CONFIG, maxFanout: 2 };
    const limited = createQueryDecomposer(config);

    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })];

    const subQueries = limited.decompose(makeQuery(), nodes);
    expect(subQueries).toHaveLength(2);
  });

  it('should select nodes by collection data range', () => {
    const nodes = [
      makeNode({ id: 'n1', dataRanges: [{ collection: 'orders' }] }),
      makeNode({ id: 'n2', dataRanges: [{ collection: 'users' }] }),
      makeNode({ id: 'n3', dataRanges: [{ collection: 'orders' }] }),
    ];

    const subQueries = decomposer.decompose(makeQuery({ collection: 'orders' }), nodes);
    expect(subQueries).toHaveLength(2);
    expect(subQueries.map((sq) => sq.nodeId)).toEqual(expect.arrayContaining(['n1', 'n3']));
  });

  it('should handle no available nodes', () => {
    const subQueries = decomposer.decompose(makeQuery(), []);
    expect(subQueries).toHaveLength(0);
  });

  it('should exclude inactive nodes', () => {
    const nodes = [
      makeNode({ id: 'n1', status: 'active' }),
      makeNode({ id: 'n2', status: 'inactive' }),
    ];

    const subQueries = decomposer.decompose(makeQuery(), nodes);
    expect(subQueries).toHaveLength(1);
    expect(subQueries[0]!.nodeId).toBe('n1');
  });

  it('should prefer nodes with key ranges', () => {
    const nodes = [
      makeNode({ id: 'n1', dataRanges: [{ collection: 'orders' }] }),
      makeNode({
        id: 'n2',
        dataRanges: [{ collection: 'orders', keyRange: { min: 'a', max: 'z' } }],
      }),
    ];

    const selected = decomposer.selectNodes(makeQuery({ collection: 'orders' }), nodes);
    // n2 should be ranked first (higher score due to key range)
    expect(selected[0]!.id).toBe('n2');
  });
});

import { describe, expect, it } from 'vitest';
import { P2PChannel, createP2PChannel } from '../p2p-channel.js';
import { QueryPlanner, createQueryPlanner } from '../query-planner.js';
import type { PartialResult } from '../result-merger.js';
import { ResultMerger, createResultMerger } from '../result-merger.js';
import type { DistributedQuery, NodeInfo } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides?: Partial<NodeInfo>): NodeInfo {
  return {
    id,
    status: 'active',
    lastSeen: Date.now(),
    capabilities: [],
    ...overrides,
  };
}

function makeQuery(overrides?: Partial<DistributedQuery>): DistributedQuery {
  return {
    id: 'q-1',
    collection: 'orders',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// QueryPlanner
// ---------------------------------------------------------------------------

describe('QueryPlanner', () => {
  it('creates via factory function', () => {
    const planner = createQueryPlanner();
    expect(planner).toBeInstanceOf(QueryPlanner);
  });

  it('returns local-only plan when no active nodes', () => {
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery(), [], 'local');

    expect(plan.strategy).toBe('local-only');
    expect(plan.subPlans).toHaveLength(1);
    expect(plan.subPlans[0]!.nodeId).toBe('local');
    expect(plan.subPlans[0]!.dataLocality).toBe('local');
  });

  it('returns empty sub-plans when no nodes and no localNodeId', () => {
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery(), []);

    expect(plan.strategy).toBe('local-only');
    expect(plan.subPlans).toHaveLength(0);
  });

  it('creates scatter-gather plan with multiple active nodes and filter', () => {
    const nodes = [
      makeNode('n1', { dataRanges: [{ collection: 'orders' }] }),
      makeNode('n2', { dataRanges: [{ collection: 'orders' }] }),
    ];
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery({ filter: { status: 'open' } }), nodes);

    expect(plan.strategy).toBe('scatter-gather');
    expect(plan.subPlans.length).toBeGreaterThanOrEqual(2);
  });

  it('creates targeted plan when only one node has matching data', () => {
    const nodes = [
      makeNode('n1', { dataRanges: [{ collection: 'orders' }] }),
      makeNode('n2', { dataRanges: [{ collection: 'users' }] }),
    ];
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery(), nodes);

    expect(plan.strategy).toBe('targeted');
  });

  it('creates broadcast plan for aggregation queries', () => {
    const nodes = [
      makeNode('n1', { dataRanges: [{ collection: 'orders' }] }),
      makeNode('n2', { dataRanges: [{ collection: 'orders' }] }),
    ];
    const planner = new QueryPlanner();
    const plan = planner.plan(
      makeQuery({ aggregation: { function: 'sum', field: 'total' } }),
      nodes
    );

    expect(plan.strategy).toBe('broadcast');
  });

  it('respects maxFanout configuration', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode(`n${i}`, { dataRanges: [{ collection: 'orders' }] })
    );
    const planner = new QueryPlanner({ maxFanout: 3 });
    const plan = planner.plan(makeQuery({ filter: { x: 1 } }), nodes);

    expect(plan.subPlans.length).toBeLessThanOrEqual(3);
  });

  it('prioritizes local node when preferLocalExecution is true', () => {
    const nodes = [
      makeNode('remote-1', { dataRanges: [{ collection: 'orders' }] }),
      makeNode('local-1', { dataRanges: [{ collection: 'orders' }] }),
    ];
    const planner = new QueryPlanner({ preferLocalExecution: true });
    const plan = planner.plan(makeQuery({ filter: { a: 1 } }), nodes, 'local-1');

    expect(plan.subPlans[0]!.nodeId).toBe('local-1');
    expect(plan.subPlans[0]!.dataLocality).toBe('local');
  });

  it('scores nodes higher for matching capabilities', () => {
    const n1 = makeNode('n1', {
      capabilities: ['aggregation'],
      dataRanges: [{ collection: 'orders' }],
    });
    const n2 = makeNode('n2', {
      capabilities: [],
      dataRanges: [{ collection: 'orders' }],
    });
    const planner = new QueryPlanner({ preferLocalExecution: false });
    const plan = planner.plan(makeQuery({ aggregation: { function: 'count', field: 'id' } }), [
      n1,
      n2,
    ]);

    const n1Plan = plan.subPlans.find((sp) => sp.nodeId === 'n1')!;
    const n2Plan = plan.subPlans.find((sp) => sp.nodeId === 'n2')!;
    expect(n1Plan.priority).toBeGreaterThan(n2Plan.priority);
  });

  it('explain returns a human-readable string', () => {
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery(), [makeNode('n1')], 'n1');

    const explanation = planner.explain(plan);
    expect(explanation).toContain('Query Plan: q-1');
    expect(explanation).toContain('Strategy:');
    expect(explanation).toContain('Node: n1');
  });

  it('estimates latency higher when remote nodes are involved', () => {
    const nodes = [
      makeNode('n1', { dataRanges: [{ collection: 'orders' }] }),
      makeNode('n2', { dataRanges: [{ collection: 'orders' }] }),
    ];
    const planner = new QueryPlanner({ latencyWeightMs: 100 });

    const remotePlan = planner.plan(makeQuery({ filter: { x: 1 } }), nodes, 'other');
    const localPlan = planner.plan(makeQuery({ filter: { x: 1 } }), nodes, 'n1');

    expect(remotePlan.estimatedLatencyMs).toBeGreaterThanOrEqual(localPlan.estimatedLatencyMs);
  });

  it('filters out inactive nodes', () => {
    const nodes = [
      makeNode('n1', { status: 'active', dataRanges: [{ collection: 'orders' }] }),
      makeNode('n2', { status: 'inactive', dataRanges: [{ collection: 'orders' }] }),
    ];
    const planner = new QueryPlanner();
    const plan = planner.plan(makeQuery(), nodes);

    const nodeIds = plan.subPlans.map((sp) => sp.nodeId);
    expect(nodeIds).toContain('n1');
    expect(nodeIds).not.toContain('n2');
  });
});

// ---------------------------------------------------------------------------
// P2PChannel
// ---------------------------------------------------------------------------

describe('P2PChannel', () => {
  it('creates via factory function', () => {
    const channel = createP2PChannel({ nodeId: 'test', enableBroadcastChannel: false });
    expect(channel).toBeInstanceOf(P2PChannel);
    channel.destroy();
  });

  it('starts with no peers', () => {
    const channel = new P2PChannel({ nodeId: 'n1', enableBroadcastChannel: false });
    expect(channel.getPeers()).toEqual([]);
    channel.destroy();
  });

  it('registers and unregisters message handlers', () => {
    const channel = new P2PChannel({ nodeId: 'n1', enableBroadcastChannel: false });
    let called = false;
    const unsubscribe = channel.onMessage('test', () => {
      called = true;
    });

    // No external message delivery mechanism in Node.js, just verify handler registration
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(called).toBe(false);
    channel.destroy();
  });

  it('does not throw when sending after destroy', () => {
    const channel = new P2PChannel({ nodeId: 'n1', enableBroadcastChannel: false });
    channel.destroy();
    expect(() => channel.send('test', { data: 1 })).not.toThrow();
  });

  it('exposes messages as observable', () => {
    const channel = new P2PChannel({ nodeId: 'n1', enableBroadcastChannel: false });
    expect(channel.messages).toBeDefined();
    expect(typeof channel.messages.subscribe).toBe('function');
    channel.destroy();
  });

  it('gracefully handles missing BroadcastChannel', () => {
    // In Node.js, BroadcastChannel may not exist — should not throw
    expect(() => new P2PChannel({ nodeId: 'n1' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ResultMerger
// ---------------------------------------------------------------------------

describe('ResultMerger', () => {
  it('creates via factory function', () => {
    const merger = createResultMerger();
    expect(merger).toBeInstanceOf(ResultMerger);
  });

  it('merges results from multiple nodes', () => {
    const merger = new ResultMerger();
    const partials: PartialResult[] = [
      { nodeId: 'n1', data: [{ id: '1', name: 'a' }], executionMs: 10, isFinal: true },
      { nodeId: 'n2', data: [{ id: '2', name: 'b' }], executionMs: 15, isFinal: true },
    ];

    const result = merger.merge(partials);
    expect(result.data).toHaveLength(2);
    expect(result.respondedNodes).toEqual(['n1', 'n2']);
    expect(result.failedNodes).toHaveLength(0);
    expect(result.totalCount).toBe(2);
  });

  it('tracks failed nodes separately', () => {
    const merger = new ResultMerger();
    const partials: PartialResult[] = [
      { nodeId: 'n1', data: [{ id: '1' }], executionMs: 10, isFinal: true },
      { nodeId: 'n2', data: [], error: 'timeout', executionMs: 5000, isFinal: true },
    ];

    const result = merger.merge(partials);
    expect(result.respondedNodes).toEqual(['n1']);
    expect(result.failedNodes).toEqual([{ nodeId: 'n2', error: 'timeout' }]);
    expect(result.data).toHaveLength(1);
  });

  it('deduplicates by configured field', () => {
    const merger = new ResultMerger({ deduplicateBy: 'id' });
    const partials: PartialResult[] = [
      {
        nodeId: 'n1',
        data: [
          { id: '1', val: 'a' },
          { id: '2', val: 'b' },
        ],
        executionMs: 5,
        isFinal: true,
      },
      {
        nodeId: 'n2',
        data: [
          { id: '1', val: 'a' },
          { id: '3', val: 'c' },
        ],
        executionMs: 5,
        isFinal: true,
      },
    ];

    const result = merger.merge(partials);
    expect(result.data).toHaveLength(3);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('sorts results ascending', () => {
    const merger = new ResultMerger({ sortBy: 'name', sortDirection: 'asc' });
    const partials: PartialResult[] = [
      {
        nodeId: 'n1',
        data: [{ name: 'charlie' }, { name: 'alpha' }],
        executionMs: 5,
        isFinal: true,
      },
      { nodeId: 'n2', data: [{ name: 'bravo' }], executionMs: 5, isFinal: true },
    ];

    const result = merger.merge(partials);
    expect(result.data.map((d) => d['name'])).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('sorts results descending', () => {
    const merger = new ResultMerger({ sortBy: 'score', sortDirection: 'desc' });
    const partials: PartialResult[] = [
      { nodeId: 'n1', data: [{ score: 10 }, { score: 30 }], executionMs: 5, isFinal: true },
      { nodeId: 'n2', data: [{ score: 20 }], executionMs: 5, isFinal: true },
    ];

    const result = merger.merge(partials);
    expect(result.data.map((d) => d['score'])).toEqual([30, 20, 10]);
  });

  it('applies limit', () => {
    const merger = new ResultMerger({ limit: 2 });
    const partials: PartialResult[] = [
      {
        nodeId: 'n1',
        data: [{ id: '1' }, { id: '2' }, { id: '3' }],
        executionMs: 5,
        isFinal: true,
      },
    ];

    const result = merger.merge(partials);
    expect(result.data).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('returns empty when quorum not met', () => {
    const merger = new ResultMerger({ quorumSize: 3 });
    const partials: PartialResult[] = [
      { nodeId: 'n1', data: [{ id: '1' }], executionMs: 5, isFinal: true },
      { nodeId: 'n2', data: [], error: 'failed', executionMs: 5, isFinal: true },
    ];

    const result = merger.merge(partials);
    expect(result.data).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it('merges incrementally', () => {
    const merger = new ResultMerger();
    const existing = merger.merge<Record<string, unknown>>([
      { nodeId: 'n1', data: [{ id: '1' }], executionMs: 5, isFinal: true },
    ]);

    const updated = merger.mergeIncremental(existing, {
      nodeId: 'n2',
      data: [{ id: '2' }],
      executionMs: 3,
      isFinal: true,
    });

    expect(updated.data).toHaveLength(2);
    expect(updated.respondedNodes).toContain('n1');
    expect(updated.respondedNodes).toContain('n2');
  });

  it('handles empty partials', () => {
    const merger = new ResultMerger();
    const result = merger.merge([]);

    expect(result.data).toHaveLength(0);
    expect(result.respondedNodes).toHaveLength(0);
    expect(result.failedNodes).toHaveLength(0);
  });
});

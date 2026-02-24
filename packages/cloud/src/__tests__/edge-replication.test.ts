import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EdgeReplicationManager } from '../edge-replication.js';
import { createCDNRouter, createEdgeReplicationManager } from '../index.js';

describe('EdgeReplicationManager', () => {
  let manager: EdgeReplicationManager;

  beforeEach(() => {
    manager = createEdgeReplicationManager({
      primaryRegion: 'us-east-1',
      replicaRegions: ['eu-west-1', 'ap-northeast-1'],
      consistency: 'eventual',
      maxStalenessMs: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  it('should initialize with syncing replicas', () => {
    const status = manager.getStatus();
    expect(status.primaryRegion).toBe('us-east-1');
    expect(status.replicas).toHaveLength(2);
    expect(status.replicas[0]!.state).toBe('syncing');
  });

  it('should start and mark replicas healthy', () => {
    manager.start();
    const status = manager.getStatus();
    expect(status.replicas.every((r) => r.state === 'healthy')).toBe(true);
    expect(status.overallHealth).toBe('healthy');
  });

  it('should validate tier limits', () => {
    expect(manager.validateTier('free')).toEqual({ valid: false, maxAllowed: 0 });
    expect(manager.validateTier('pro')).toEqual({ valid: true, maxAllowed: 2 });
    expect(manager.validateTier('enterprise')).toEqual({ valid: true, maxAllowed: 5 });
  });

  it('should find closest replica', () => {
    manager.start();
    const closest = manager.getClosestReplica('eu-central-1');
    expect(closest).toBe('eu-west-1'); // eu-west-1 is closest to eu-central-1
  });

  it('should check read consistency for eventual', () => {
    manager.start();
    expect(manager.isReadConsistent('eu-west-1')).toBe(true);
    expect(manager.isReadConsistent('us-east-1')).toBe(true); // primary always consistent
  });

  it('should handle failover', () => {
    manager.start();
    const success = manager.failover('eu-west-1');
    expect(success).toBe(true);
    const status = manager.getStatus();
    expect(status.primaryRegion).toBe('eu-west-1');
    expect(status.replicas).toHaveLength(1); // eu-west-1 promoted, only ap-northeast-1 left
  });

  it('should record replication events', () => {
    manager.start();
    manager.recordReplication('eu-west-1', 100);
    const status = manager.getStatus();
    const euReplica = status.replicas.find((r) => r.region === 'eu-west-1');
    expect(euReplica?.documentsReplicated).toBe(100);
  });

  it('should emit events via observable', () => {
    const events: string[] = [];
    const sub = manager.events.subscribe((e) => events.push(e.type));
    manager.start();
    sub.unsubscribe();
    expect(events).toContain('replica-synced');
  });
});

describe('CDNRouter', () => {
  let manager: EdgeReplicationManager;

  beforeEach(() => {
    manager = createEdgeReplicationManager({
      primaryRegion: 'us-east-1',
      replicaRegions: ['eu-west-1', 'ap-northeast-1'],
      consistency: 'eventual',
    });
    manager.start();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('should route to closest replica by region hint', () => {
    const router = createCDNRouter({ replicationManager: manager });
    const decision = router.route({ region: 'eu-central-1' });
    expect(decision.targetRegion).toBe('eu-west-1');
    expect(decision.fromCache).toBe(false);
  });

  it('should route to primary for strong consistency', () => {
    const router = createCDNRouter({ replicationManager: manager });
    const decision = router.route({ region: 'eu-central-1' }, 'strong');
    expect(decision.targetRegion).toBe('us-east-1');
    expect(decision.reason).toContain('Strong consistency');
  });

  it('should cache routing decisions', () => {
    const router = createCDNRouter({ replicationManager: manager });
    router.route({ region: 'ap-southeast-1' });
    const cached = router.route({ region: 'ap-southeast-1' });
    expect(cached.fromCache).toBe(true);
  });

  it('should route by coordinates', () => {
    const router = createCDNRouter({ replicationManager: manager });
    // Tokyo coordinates should route to ap-northeast-1
    const decision = router.route({ latitude: 35.6, longitude: 139.7 });
    expect(decision.targetRegion).toBe('ap-northeast-1');
  });

  it('should invalidate cache', () => {
    const router = createCDNRouter({ replicationManager: manager });
    router.route({ region: 'eu-west-1' });
    router.invalidateCache();
    const decision = router.route({ region: 'eu-west-1' });
    expect(decision.fromCache).toBe(false);
  });
});

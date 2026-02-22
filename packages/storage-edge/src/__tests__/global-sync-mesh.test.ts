import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GlobalSyncMesh,
  createGlobalSyncMesh,
  type ReplicationEvent,
} from '../global-sync-mesh.js';

describe('GlobalSyncMesh', () => {
  let mesh: GlobalSyncMesh;

  beforeEach(() => {
    mesh = createGlobalSyncMesh({
      primaryRegion: 'us-east',
      replicaRegions: ['eu-west', 'ap-northeast'],
      strategy: 'full',
    });
  });

  afterEach(() => {
    mesh.destroy();
  });

  describe('initialization', () => {
    it('should initialize with correct region count', () => {
      const regions = mesh.getRegions();
      expect(regions).toHaveLength(3);
    });

    it('should mark primary region correctly', () => {
      const primary = mesh.getRegions().find((r) => r.isPrimary);
      expect(primary?.region).toBe('us-east');
    });

    it('should initialize replicas as offline', () => {
      const replicas = mesh.getRegions().filter((r) => !r.isPrimary);
      expect(replicas.every((r) => r.status === 'offline')).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('should start and mark all regions active', async () => {
      await mesh.start();
      const regions = mesh.getRegions();
      expect(regions.every((r) => r.status === 'active')).toBe(true);
    });

    it('should stop and mark all regions offline', async () => {
      await mesh.start();
      await mesh.stop();
      const regions = mesh.getRegions();
      expect(regions.every((r) => r.status === 'offline')).toBe(true);
    });
  });

  describe('routing', () => {
    it('should route reads to matching region', async () => {
      await mesh.start();
      const decision = mesh.routeRead('eu-west');
      expect(decision.targetRegion).toBe('eu-west');
      expect(decision.reason).toContain('match');
    });

    it('should route reads to lowest latency when no match', async () => {
      await mesh.start();
      const decision = mesh.routeRead('sa-east');
      expect(decision.targetRegion).toBeTruthy();
      expect(decision.estimatedLatencyMs).toBeGreaterThan(0);
    });

    it('should route reads to primary as fallback when all offline', () => {
      const decision = mesh.routeRead('us-east');
      expect(decision.targetRegion).toBe('us-east');
    });

    it('should always route writes to primary', async () => {
      await mesh.start();
      const decision = mesh.routeWrite();
      expect(decision.targetRegion).toBe('us-east');
      expect(decision.reason).toContain('primary');
    });
  });

  describe('region management', () => {
    it('should add a new replica region', () => {
      mesh.addRegion('sa-east');
      expect(mesh.getRegions()).toHaveLength(4);
    });

    it('should ignore duplicate region adds', () => {
      mesh.addRegion('eu-west');
      expect(mesh.getRegions()).toHaveLength(3);
    });

    it('should remove a replica region', () => {
      const removed = mesh.removeRegion('eu-west');
      expect(removed).toBe(true);
      expect(mesh.getRegions()).toHaveLength(2);
    });

    it('should not remove primary region', () => {
      const removed = mesh.removeRegion('us-east');
      expect(removed).toBe(false);
      expect(mesh.getRegions()).toHaveLength(3);
    });
  });

  describe('replication', () => {
    it('should replicate to a target region', async () => {
      await mesh.start();
      await mesh.replicateTo('eu-west', 100);
      const region = mesh.getRegions().find((r) => r.region === 'eu-west')!;
      expect(region.documentCount).toBe(100);
      expect(region.status).toBe('active');
    });

    it('should emit replication events', async () => {
      const events: ReplicationEvent[] = [];
      mesh.events$.subscribe((e) => events.push(e));
      await mesh.start();
      await mesh.replicateTo('eu-west', 50);
      expect(events.some((e) => e.type === 'sync-started')).toBe(true);
      expect(events.some((e) => e.type === 'sync-completed')).toBe(true);
    });
  });

  describe('CDN cache', () => {
    it('should emit cache invalidation events', async () => {
      const m = createGlobalSyncMesh({
        primaryRegion: 'us-east',
        replicaRegions: ['eu-west'],
        strategy: 'full',
        cdnCacheEnabled: true,
      });
      const events: ReplicationEvent[] = [];
      m.events$.subscribe((e) => events.push(e));
      m.invalidateCache('todos');
      expect(events.some((e) => e.type === 'cache-invalidated')).toBe(true);
      m.destroy();
    });

    it('should not emit cache events when CDN disabled', () => {
      const events: ReplicationEvent[] = [];
      mesh.events$.subscribe((e) => events.push(e));
      mesh.invalidateCache('todos');
      expect(events.some((e) => e.type === 'cache-invalidated')).toBe(false);
    });
  });

  describe('metrics', () => {
    it('should report aggregate metrics', async () => {
      await mesh.start();
      const metrics = mesh.getMetrics();
      expect(metrics.totalRegions).toBe(3);
      expect(metrics.activeRegions).toBe(3);
      expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

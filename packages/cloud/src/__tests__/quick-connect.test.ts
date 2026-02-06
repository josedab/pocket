import { describe, it, expect } from 'vitest';
import { connectToCloud } from '../quick-connect.js';
import type { CloudConnectionEvent, CloudStatus } from '../index.js';

describe('connectToCloud', () => {
  it('should connect with just an API key', () => {
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });

    expect(cloud.status).toBe('connected');
    expect(cloud.projectId).toBeDefined();
    expect(cloud.region).toBe('us-east-1');
    expect(cloud.isConnected()).toBe(true);

    cloud.disconnect();
  });

  it('should use custom project ID and region', () => {
    const cloud = connectToCloud({
      apiKey: 'pk_live_abc123xyz',
      projectId: 'proj_custom',
      region: 'eu-west-1',
    });

    expect(cloud.projectId).toBe('proj_custom');
    expect(cloud.region).toBe('eu-west-1');

    cloud.disconnect();
  });

  it('should detect tier from API key', () => {
    const liveCloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });
    expect(liveCloud.tier).toBe('pro');
    liveCloud.disconnect();

    const testCloud = connectToCloud({ apiKey: 'pk_test_abc123xyz' });
    expect(testCloud.tier).toBe('free');
    testCloud.disconnect();
  });

  it('should throw on invalid API key', () => {
    expect(() => connectToCloud({ apiKey: '' })).toThrow('Invalid API key');
    expect(() => connectToCloud({ apiKey: 'short' })).toThrow('Invalid API key');
  });

  it('should support pause and resume', () => {
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });

    cloud.pause();
    expect(cloud.isConnected()).toBe(false);

    cloud.resume();
    expect(cloud.isConnected()).toBe(true);

    cloud.disconnect();
  });

  it('should emit status changes', async () => {
    const statuses: CloudStatus[] = [];
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });

    cloud.status$.subscribe((s) => statuses.push(s));

    await cloud.disconnect();

    expect(statuses).toContain('connected');
    expect(statuses).toContain('disconnected');
  });

  it('should emit connection events', async () => {
    const events: CloudConnectionEvent[] = [];
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });

    cloud.events$.subscribe((e) => events.push(e));

    cloud.pause();
    cloud.resume();
    await cloud.disconnect();

    // The 'connected' event fires synchronously before subscription,
    // so we check for pause/resume/disconnect events
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'disconnected')).toBe(true);
  });

  it('should track usage', () => {
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });

    const usage = cloud.getUsage();
    expect(usage.syncOperations).toBeGreaterThanOrEqual(1);
    expect(usage.connectedSince).toBeGreaterThan(0);
    expect(usage.lastSyncAt).toBeGreaterThan(0);

    cloud.disconnect();
  });

  it('should report disconnected after disconnect', async () => {
    const cloud = connectToCloud({ apiKey: 'pk_live_abc123xyz' });
    await cloud.disconnect();

    expect(cloud.status).toBe('disconnected');
    expect(cloud.isConnected()).toBe(false);
  });
});

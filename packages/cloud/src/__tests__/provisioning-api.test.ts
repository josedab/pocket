import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProvisioningAPI,
  createProvisioningAPI,
  type ProjectPlan,
  type ProjectInfo,
  type ProvisioningUsageMetrics,
  type PlanQuotas,
  type ProvisioningEvent,
} from '../provisioning-api.js';

// ── ProvisioningAPI ─────────────────────────────────────────────────────────

describe('ProvisioningAPI', () => {
  let api: ProvisioningAPI;

  beforeEach(() => {
    api = createProvisioningAPI({ accountToken: 'acct_test_123' });
  });

  afterEach(() => {
    api.destroy();
  });

  it('should create a project with default free plan', async () => {
    const project = await api.createProject('my-app');

    expect(project.name).toBe('my-app');
    expect(project.plan).toBe('free');
    expect(project.status).toBe('active');
    expect(project.id).toMatch(/^proj_/);
    expect(project.apiKey).toMatch(/^pk_live_/);
    expect(project.createdAt).toBeGreaterThan(0);
  });

  it('should create a project with a specified plan', async () => {
    const project = await api.createProject('enterprise-app', 'enterprise');

    expect(project.plan).toBe('enterprise');
    expect(project.name).toBe('enterprise-app');
  });

  it('should list all created projects', async () => {
    await api.createProject('app-one');
    await api.createProject('app-two', 'pro');

    const projects = await api.listProjects();

    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toContain('app-one');
    expect(projects.map((p) => p.name)).toContain('app-two');
  });

  it('should delete a project', async () => {
    const project = await api.createProject('to-delete');
    await api.deleteProject(project.id);

    const projects = await api.listProjects();
    expect(projects).toHaveLength(0);
  });

  it('should throw when deleting a non-existent project', async () => {
    await expect(api.deleteProject('proj_nonexistent')).rejects.toThrow(
      'Project not found',
    );
  });

  it('should return usage metrics for a project', async () => {
    const project = await api.createProject('usage-test');
    const usage = await api.getUsage(project.id);

    expect(usage.syncOps).toBe(0);
    expect(usage.storage).toBe(0);
    expect(usage.bandwidth).toBe(0);
    expect(usage.measuredAt).toBeGreaterThan(0);
  });

  it('should return quotas matching the project plan', async () => {
    const freeProject = await api.createProject('free-app');
    const proProject = await api.createProject('pro-app', 'pro');

    const freeQuotas = await api.getQuotas(freeProject.id);
    const proQuotas = await api.getQuotas(proProject.id);

    expect(freeQuotas.maxSyncOps).toBe(10_000);
    expect(proQuotas.maxSyncOps).toBe(1_000_000);
    expect(proQuotas.maxStorage).toBeGreaterThan(freeQuotas.maxStorage);
    expect(freeQuotas.maxConnections).toBe(5);
    expect(proQuotas.maxConnections).toBe(100);
  });

  it('should rotate the API key for a project', async () => {
    const project = await api.createProject('key-rotate');
    const originalKey = project.apiKey;

    const updated = await api.rotateApiKey(project.id);

    expect(updated.apiKey).not.toBe(originalKey);
    expect(updated.apiKey).toMatch(/^pk_live_/);
    expect(updated.id).toBe(project.id);
  });

  it('should throw when rotating key for a non-existent project', async () => {
    await expect(api.rotateApiKey('proj_nonexistent')).rejects.toThrow(
      'Project not found',
    );
  });

  it('should throw when creating a project with empty name', async () => {
    await expect(api.createProject('')).rejects.toThrow(
      'Project name is required',
    );
  });

  it('should emit events for project lifecycle actions', async () => {
    const events: ProvisioningEvent[] = [];
    api.events$.subscribe((e) => events.push(e));

    const project = await api.createProject('events-test');
    await api.rotateApiKey(project.id);
    await api.deleteProject(project.id);

    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('project.created');
    expect(events[1]!.type).toBe('key.rotated');
    expect(events[2]!.type).toBe('project.deleted');
  });
});

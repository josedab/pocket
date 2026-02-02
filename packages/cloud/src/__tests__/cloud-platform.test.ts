import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectManager, createProjectManager } from '../project-manager.js';
import { UsageAnalytics, createUsageAnalytics } from '../usage-analytics.js';

// ── Project Manager ────────────────────────────────────────────────

describe('ProjectManager', () => {
  let pm: ProjectManager;

  beforeEach(() => {
    pm = createProjectManager();
  });

  it('should create a project', () => {
    const project = pm.createProject('my-app', 'pro');
    expect(project.name).toBe('my-app');
    expect(project.tier).toBe('pro');
    expect(project.id).toMatch(/^proj_/);
  });

  it('should list projects', () => {
    pm.createProject('app-1');
    pm.createProject('app-2');
    expect(pm.listProjects().length).toBe(2);
  });

  it('should get and delete projects', () => {
    const project = pm.createProject('app');
    expect(pm.getProject(project.id)).toBeDefined();
    expect(pm.deleteProject(project.id)).toBe(true);
    expect(pm.getProject(project.id)).toBeUndefined();
  });

  it('should add environments', () => {
    const project = pm.createProject('app');
    const env = pm.addEnvironment(project.id, {
      name: 'production',
      type: 'production',
      region: 'us-east-1',
    });
    expect(env).toBeDefined();
    expect(env!.type).toBe('production');
    expect(env!.apiKeyPrefix).toBe('pk_live_');

    const devEnv = pm.addEnvironment(project.id, {
      name: 'development',
      type: 'development',
      region: 'us-west-2',
    });
    expect(devEnv!.apiKeyPrefix).toBe('pk_test_');
    expect(pm.getEnvironments(project.id).length).toBe(2);
  });

  it('should return null for invalid project environment', () => {
    expect(pm.addEnvironment('nonexistent', { name: 'dev', type: 'development', region: 'us-east-1' })).toBeNull();
  });

  it('should manage team members', () => {
    const project = pm.createProject('app');
    const member = pm.addTeamMember(project.id, 'alice@example.com', 'admin');
    expect(member).toBeDefined();
    expect(member!.role).toBe('admin');

    // Duplicate should return null
    expect(pm.addTeamMember(project.id, 'alice@example.com', 'developer')).toBeNull();

    expect(pm.removeTeamMember(project.id, 'alice@example.com')).toBe(true);
    expect(pm.removeTeamMember(project.id, 'alice@example.com')).toBe(false);
  });

  it('should manage deployments', () => {
    const project = pm.createProject('app');
    const dep = pm.createDeployment(project.id, 'production', '1.0.0', ['Added auth']);
    expect(dep).toBeDefined();
    expect(dep!.status).toBe('pending');

    pm.updateDeploymentStatus(project.id, dep!.id, 'deployed');
    const deployments = pm.getDeployments(project.id);
    expect(deployments[0]!.status).toBe('deployed');
    expect(deployments[0]!.completedAt).toBeGreaterThan(0);
  });

  it('should upgrade tier', () => {
    const project = pm.createProject('app', 'free');
    expect(pm.upgradeTier(project.id, 'enterprise')).toBe(true);
    expect(pm.getProject(project.id)!.tier).toBe('enterprise');
  });
});

// ── Usage Analytics ────────────────────────────────────────────────

describe('UsageAnalytics', () => {
  let analytics: UsageAnalytics;

  beforeEach(() => {
    analytics = createUsageAnalytics('free');
  });

  it('should record data points', () => {
    analytics.record({ operations: 100, bytesTransferred: 5000, activeConnections: 3, errors: 0 });
    analytics.record({ operations: 200, bytesTransferred: 10000, activeConnections: 5, errors: 1 });

    const totals = analytics.getTotals();
    expect(totals.operations).toBe(300);
    expect(totals.bytes).toBe(15000);
    expect(totals.errors).toBe(1);
    expect(totals.peakConnections).toBe(5);
  });

  it('should produce usage summary', () => {
    analytics.record({ operations: 100, bytesTransferred: 5000, activeConnections: 3, errors: 2 });
    analytics.record({ operations: 200, bytesTransferred: 10000, activeConnections: 5, errors: 0 });

    const summary = analytics.getSummary();
    expect(summary.totalOperations).toBe(300);
    expect(summary.totalBytesTransferred).toBe(15000);
    expect(summary.totalErrors).toBe(2);
    expect(summary.peakConnections).toBe(5);
    expect(summary.dataPoints).toBe(2);
  });

  it('should return empty summary when no data', () => {
    const summary = analytics.getSummary();
    expect(summary.totalOperations).toBe(0);
    expect(summary.dataPoints).toBe(0);
  });

  it('should generate operation warning alert', () => {
    // Free tier limit is 10,000
    analytics.record({ operations: 8500, bytesTransferred: 0, activeConnections: 1, errors: 0 });
    const alerts = analytics.checkAlerts();
    const opAlert = alerts.find((a) => a.metric === 'operations');
    expect(opAlert).toBeDefined();
    expect(opAlert!.type).toBe('warning');
  });

  it('should generate critical alert near limit', () => {
    analytics.record({ operations: 9600, bytesTransferred: 0, activeConnections: 1, errors: 0 });
    const alerts = analytics.checkAlerts();
    const opAlert = alerts.find((a) => a.metric === 'operations');
    expect(opAlert).toBeDefined();
    expect(opAlert!.type).toBe('critical');
  });

  it('should detect high error rate', () => {
    analytics.record({ operations: 100, bytesTransferred: 0, activeConnections: 1, errors: 11 });
    const alerts = analytics.checkAlerts();
    const errAlert = alerts.find((a) => a.metric === 'errors');
    expect(errAlert).toBeDefined();
    expect(errAlert!.type).toBe('critical');
  });

  it('should detect connection limit warning', () => {
    // Free tier max connections is 5
    analytics.record({ operations: 1, bytesTransferred: 0, activeConnections: 5, errors: 0 });
    const alerts = analytics.checkAlerts();
    const connAlert = alerts.find((a) => a.metric === 'connections');
    expect(connAlert).toBeDefined();
  });

  it('should keep alert history', () => {
    analytics.record({ operations: 9600, bytesTransferred: 0, activeConnections: 1, errors: 0 });
    analytics.checkAlerts();
    expect(analytics.getAlertHistory().length).toBeGreaterThan(0);
  });

  it('should reset all data', () => {
    analytics.record({ operations: 100, bytesTransferred: 5000, activeConnections: 3, errors: 0 });
    analytics.reset();
    expect(analytics.getTotals().operations).toBe(0);
    expect(analytics.getDataPoints().length).toBe(0);
  });

  it('should not generate alerts for enterprise tier', () => {
    const enterprise = createUsageAnalytics('enterprise');
    enterprise.record({ operations: 999999, bytesTransferred: 0, activeConnections: 500, errors: 0 });
    const alerts = enterprise.checkAlerts();
    const opAlerts = alerts.filter((a) => a.metric === 'operations' || a.metric === 'connections');
    expect(opAlerts.length).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { ProvisionProgress } from '../auto-provision.js';
import { AutoProvisionPipeline, createAutoProvisionPipeline } from '../auto-provision.js';

describe('AutoProvisionPipeline', () => {
  let pipeline: AutoProvisionPipeline;

  beforeEach(() => {
    pipeline = createAutoProvisionPipeline({
      apiKey: 'pk_live_abc123xyz789',
    });
  });

  it('should execute all provisioning steps successfully', async () => {
    const result = await pipeline.execute();

    expect(result.success).toBe(true);
    expect(result.projectId).toMatch(/^proj_/);
    expect(result.region).toBeTruthy();
    expect(result.tier).toBe('pro');
    expect(result.endpoints.websocket).toContain('wss://');
    expect(result.endpoints.http).toContain('https://');
    expect(result.endpoints.api).toContain('/api/v1');
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.provisionedAt).toBeGreaterThan(0);
  });

  it('should report progress for each step', async () => {
    const progress: ProvisionProgress[] = [];
    pipeline.progress$.subscribe((p) => progress.push(p));

    await pipeline.execute();

    expect(progress.length).toBeGreaterThanOrEqual(6);
    expect(progress[0]!.percentComplete).toBe(0);
    expect(progress[progress.length - 1]!.percentComplete).toBeGreaterThan(50);
  });

  it('should skip region detection when region is provided', async () => {
    const p = createAutoProvisionPipeline({
      apiKey: 'pk_live_abc123xyz789',
      region: 'eu-west-1',
    });

    const result = await p.execute();

    expect(result.region).toBe('eu-west-1');
    const detectStep = result.steps.find((s) => s.name === 'detect-region');
    expect(detectStep?.status).toBe('skipped');
  });

  it('should assign free tier for test API keys', async () => {
    const p = createAutoProvisionPipeline({
      apiKey: 'pk_test_abc123xyz789',
    });

    const result = await p.execute();
    expect(result.tier).toBe('free');
  });

  it('should throw on second execution', async () => {
    await pipeline.execute();
    await expect(pipeline.execute()).rejects.toThrow('already been executed');
  });

  it('should reject invalid API keys', async () => {
    const p = createAutoProvisionPipeline({ apiKey: 'bad' });
    const result = await p.execute();
    expect(result.success).toBe(false);
    const validateStep = result.steps.find((s) => s.name === 'validate-key');
    expect(validateStep?.status).toBe('failed');
  });

  it('should configure specified collections', async () => {
    const p = createAutoProvisionPipeline({
      apiKey: 'pk_live_abc123xyz789',
      collections: ['todos', 'notes', 'users'],
    });

    const result = await p.execute();
    expect(result.collections).toEqual(['todos', 'notes', 'users']);
  });

  it('should default to _default collection when none specified', async () => {
    const result = await pipeline.execute();
    expect(result.collections).toContain('_default');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { HostedService } from '../hosted-service.js';
import { createHostedService, HOSTED_TIER_LIMITS } from '../index.js';

describe('HostedService', () => {
  let svc: HostedService;
  afterEach(() => svc?.destroy());

  it('should sign up a new account', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'user@test.com' });
    expect(account.id).toMatch(/^acct-/);
    expect(account.email).toBe('user@test.com');
    expect(account.tier).toBe('free');
    expect(account.apiKey).toMatch(/^pk_test_/);
  });

  it('should create pro API keys for pro tier', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'pro@test.com', tier: 'pro' });
    expect(account.apiKey).toMatch(/^pk_live_/);
  });

  it('should create projects under account', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com' });
    const project = svc.createProject(account.id, 'my-app');
    expect(project).not.toBeNull();
    expect(project!.name).toBe('my-app');
    expect(project!.status).toBe('active');
    expect(svc.getProjects(account.id)).toHaveLength(1);
  });

  it('should enforce project limits per tier', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com', tier: 'free' });
    for (let i = 0; i < HOSTED_TIER_LIMITS.free.maxProjects; i++) {
      expect(svc.createProject(account.id, `proj-${i}`)).not.toBeNull();
    }
    expect(svc.createProject(account.id, 'over-limit')).toBeNull();
  });

  it('should meter operations and enforce limits', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com', tier: 'free' });

    const result1 = svc.recordOperation(account.id, 5000);
    expect(result1.allowed).toBe(true);
    expect(result1.currentOps).toBe(5000);

    const result2 = svc.recordOperation(account.id, 6000);
    expect(result2.allowed).toBe(false);
    expect(result2.reason).toContain('Exceeded');
  });

  it('should track usage percentage', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com', tier: 'free' });

    const result = svc.recordOperation(account.id, 5000);
    expect(result.percentUsed).toBe(50);
  });

  it('should upgrade tier', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com', tier: 'free' });
    expect(svc.upgradeTier(account.id, 'pro')).toBe(true);
    expect(svc.getAccount(account.id)?.tier).toBe('pro');
  });

  it('should find account by API key', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com' });
    const found = svc.getAccountByApiKey(account.apiKey);
    expect(found?.id).toBe(account.id);
  });

  it('should suspend projects', () => {
    svc = createHostedService();
    const account = svc.signup({ email: 'u@test.com' });
    const project = svc.createProject(account.id, 'app');
    expect(svc.suspendProject(project!.id)).toBe(true);
    expect(svc.getProjects(account.id)[0]?.status).toBe('suspended');
  });

  it('should emit events via observable', () => {
    svc = createHostedService();
    const events: string[] = [];
    const sub = svc.events.subscribe((e) => events.push(e.type));
    svc.signup({ email: 'u@test.com' });
    sub.unsubscribe();
    expect(events).toContain('signup');
  });

  it('should return error for unknown account', () => {
    svc = createHostedService();
    const result = svc.recordOperation('unknown', 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not found');
  });
});

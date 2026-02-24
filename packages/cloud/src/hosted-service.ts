/**
 * Hosted Service API — manages signup, project lifecycle, and
 * usage metering for the Pocket Hosted (SaaS) offering.
 */

import { BehaviorSubject, Subject } from 'rxjs';

/** Hosted account tiers. */
export type HostedTier = 'free' | 'pro' | 'enterprise';

/** Tier limits for the hosted service. */
export interface TierLimits {
  readonly maxOpsPerMonth: number;
  readonly maxStorageMb: number;
  readonly maxProjects: number;
  readonly maxCollectionsPerProject: number;
  readonly realtimeEnabled: boolean;
  readonly edgeReplication: boolean;
  readonly slaGuarantee: boolean;
}

export const HOSTED_TIER_LIMITS: Record<HostedTier, TierLimits> = {
  free: {
    maxOpsPerMonth: 10_000,
    maxStorageMb: 100,
    maxProjects: 3,
    maxCollectionsPerProject: 10,
    realtimeEnabled: true,
    edgeReplication: false,
    slaGuarantee: false,
  },
  pro: {
    maxOpsPerMonth: 1_000_000,
    maxStorageMb: 10_000,
    maxProjects: 20,
    maxCollectionsPerProject: 100,
    realtimeEnabled: true,
    edgeReplication: true,
    slaGuarantee: false,
  },
  enterprise: {
    maxOpsPerMonth: Infinity,
    maxStorageMb: Infinity,
    maxProjects: Infinity,
    maxCollectionsPerProject: Infinity,
    realtimeEnabled: true,
    edgeReplication: true,
    slaGuarantee: true,
  },
};

/** Hosted account. */
export interface HostedAccount {
  readonly id: string;
  readonly email: string;
  readonly tier: HostedTier;
  readonly createdAt: number;
  readonly apiKey: string;
}

/** Hosted project. */
export interface HostedProject {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly region: string;
  readonly collections: readonly string[];
  readonly createdAt: number;
  readonly status: 'active' | 'suspended' | 'deleted';
}

/** Usage metrics for metering. */
export interface UsageMeter {
  readonly accountId: string;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly opsCount: number;
  readonly storageMb: number;
  readonly bandwidthMb: number;
}

/** Signup input. */
export interface SignupInput {
  readonly email: string;
  readonly tier?: HostedTier;
}

/** Usage check result. */
export interface UsageCheckResult {
  readonly allowed: boolean;
  readonly currentOps: number;
  readonly limit: number;
  readonly percentUsed: number;
  readonly reason?: string;
}

/** Hosted service event. */
export interface HostedServiceEvent {
  readonly type:
    | 'signup'
    | 'project-created'
    | 'project-suspended'
    | 'tier-upgraded'
    | 'usage-warning'
    | 'usage-exceeded';
  readonly accountId: string;
  readonly timestamp: number;
  readonly details?: string;
}

export class HostedService {
  private readonly accounts = new Map<string, HostedAccount>();
  private readonly projects = new Map<string, HostedProject>();
  private readonly usage = new Map<string, UsageMeter>();
  private readonly events$ = new Subject<HostedServiceEvent>();
  private readonly stats$ = new BehaviorSubject({ accounts: 0, projects: 0 });
  private accountCounter = 0;
  private projectCounter = 0;

  /** Sign up a new account. */
  signup(input: SignupInput): HostedAccount {
    const id = `acct-${++this.accountCounter}`;
    const apiKey = `pk_${input.tier === 'pro' ? 'live' : 'test'}_${generateKey()}`;

    const account: HostedAccount = {
      id,
      email: input.email,
      tier: input.tier ?? 'free',
      createdAt: Date.now(),
      apiKey,
    };

    this.accounts.set(id, account);
    this.usage.set(id, {
      accountId: id,
      periodStart: Date.now(),
      periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      opsCount: 0,
      storageMb: 0,
      bandwidthMb: 0,
    });

    this.emitEvent('signup', id);
    this.emitStats();
    return account;
  }

  /** Create a project under an account. */
  createProject(accountId: string, name: string, region = 'us-east-1'): HostedProject | null {
    const account = this.accounts.get(accountId);
    if (!account) return null;

    const limits = HOSTED_TIER_LIMITS[account.tier];
    const accountProjects = Array.from(this.projects.values()).filter(
      (p) => p.accountId === accountId && p.status === 'active'
    );

    if (accountProjects.length >= limits.maxProjects) return null;

    const project: HostedProject = {
      id: `proj-${++this.projectCounter}`,
      accountId,
      name,
      region,
      collections: [],
      createdAt: Date.now(),
      status: 'active',
    };

    this.projects.set(project.id, project);
    this.emitEvent('project-created', accountId, `Project: ${name}`);
    this.emitStats();
    return project;
  }

  /** Record an operation for usage metering. */
  recordOperation(accountId: string, count = 1): UsageCheckResult {
    const account = this.accounts.get(accountId);
    if (!account)
      return {
        allowed: false,
        currentOps: 0,
        limit: 0,
        percentUsed: 0,
        reason: 'Account not found',
      };

    const limits = HOSTED_TIER_LIMITS[account.tier];
    const meter = this.usage.get(accountId);
    if (!meter)
      return { allowed: false, currentOps: 0, limit: 0, percentUsed: 0, reason: 'No usage meter' };

    const newOps = meter.opsCount + count;
    this.usage.set(accountId, { ...meter, opsCount: newOps });

    const percentUsed =
      limits.maxOpsPerMonth === Infinity ? 0 : (newOps / limits.maxOpsPerMonth) * 100;

    if (percentUsed >= 90 && percentUsed < 100) {
      this.emitEvent('usage-warning', accountId, `${percentUsed.toFixed(0)}% of limit`);
    }

    if (newOps > limits.maxOpsPerMonth) {
      this.emitEvent('usage-exceeded', accountId);
      return {
        allowed: false,
        currentOps: newOps,
        limit: limits.maxOpsPerMonth,
        percentUsed: 100,
        reason: `Exceeded ${limits.maxOpsPerMonth} ops/month limit`,
      };
    }

    return { allowed: true, currentOps: newOps, limit: limits.maxOpsPerMonth, percentUsed };
  }

  /** Upgrade an account's tier. */
  upgradeTier(accountId: string, newTier: HostedTier): boolean {
    const account = this.accounts.get(accountId);
    if (!account) return false;
    this.accounts.set(accountId, { ...account, tier: newTier });
    this.emitEvent('tier-upgraded', accountId, `Upgraded to ${newTier}`);
    return true;
  }

  /** Get account by ID. */
  getAccount(accountId: string): HostedAccount | undefined {
    return this.accounts.get(accountId);
  }

  /** Get account by API key. */
  getAccountByApiKey(apiKey: string): HostedAccount | undefined {
    return Array.from(this.accounts.values()).find((a) => a.apiKey === apiKey);
  }

  /** Get projects for an account. */
  getProjects(accountId: string): readonly HostedProject[] {
    return Array.from(this.projects.values()).filter((p) => p.accountId === accountId);
  }

  /** Get usage meter for an account. */
  getUsage(accountId: string): UsageMeter | undefined {
    return this.usage.get(accountId);
  }

  /** Suspend a project (e.g., for quota violation). */
  suspendProject(projectId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    this.projects.set(projectId, { ...project, status: 'suspended' });
    this.emitEvent('project-suspended', project.accountId, `Project: ${project.name}`);
    return true;
  }

  /** Observable of service events. */
  get events() {
    return this.events$.asObservable();
  }

  /** Observable of aggregate stats. */
  get stats() {
    return this.stats$.asObservable();
  }

  destroy(): void {
    this.events$.complete();
    this.stats$.complete();
  }

  private emitEvent(type: HostedServiceEvent['type'], accountId: string, details?: string): void {
    this.events$.next({ type, accountId, timestamp: Date.now(), details });
  }

  private emitStats(): void {
    this.stats$.next({ accounts: this.accounts.size, projects: this.projects.size });
  }
}

function generateKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 24; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
  return key;
}

export function createHostedService(): HostedService {
  return new HostedService();
}

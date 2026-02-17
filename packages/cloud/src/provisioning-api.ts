/**
 * ProvisioningAPI — managed cloud provisioning service layer.
 *
 * Provides project lifecycle management including creation, deletion,
 * usage monitoring, quota enforcement, and API key rotation.
 *
 * @module provisioning-api
 */

import { Subject, takeUntil, type Observable } from 'rxjs';
import { TIER_LIMITS } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Project plan tiers available for provisioning.
 */
export type ProjectPlan = 'free' | 'pro' | 'enterprise';

/**
 * Information about a provisioned project.
 */
export interface ProjectInfo {
  /** Unique project identifier */
  id: string;
  /** Human-readable project name */
  name: string;
  /** Current plan tier */
  plan: ProjectPlan;
  /** API key for authenticating with this project */
  apiKey: string;
  /** Timestamp when the project was created */
  createdAt: number;
  /** Current project status */
  status: 'active' | 'suspended' | 'deleted';
}

/**
 * Usage metrics for a provisioned project.
 */
export interface ProvisioningUsageMetrics {
  /** Number of sync operations consumed */
  syncOps: number;
  /** Storage consumed in bytes */
  storage: number;
  /** Bandwidth consumed in bytes */
  bandwidth: number;
  /** Timestamp of the metrics snapshot */
  measuredAt: number;
}

/**
 * Plan quota limits for a project.
 */
export interface PlanQuotas {
  /** Maximum sync operations per billing period */
  maxSyncOps: number;
  /** Maximum storage in bytes */
  maxStorage: number;
  /** Maximum bandwidth in bytes per billing period */
  maxBandwidth: number;
  /** Maximum concurrent connections */
  maxConnections: number;
}

/**
 * Configuration for the ProvisioningAPI.
 */
export interface ProvisioningConfig {
  /** Base URL for the Pocket Cloud API */
  apiEndpoint?: string;
  /** Account-level authentication token */
  accountToken: string;
  /** Default region for new projects */
  defaultRegion?: string;
}

/**
 * Event emitted by the provisioning API.
 */
export interface ProvisioningEvent {
  type: 'project.created' | 'project.deleted' | 'key.rotated';
  projectId: string;
  timestamp: number;
}

// ── Quota mapping ────────────────────────────────────────────────────────────

const PLAN_QUOTAS: Record<ProjectPlan, PlanQuotas> = {
  free: {
    maxSyncOps: TIER_LIMITS.free.maxOperations,
    maxStorage: TIER_LIMITS.free.maxStorageBytes,
    maxBandwidth: 1 * 1024 * 1024 * 1024, // 1 GB
    maxConnections: TIER_LIMITS.free.maxConnections,
  },
  pro: {
    maxSyncOps: TIER_LIMITS.pro.maxOperations,
    maxStorage: TIER_LIMITS.pro.maxStorageBytes,
    maxBandwidth: 100 * 1024 * 1024 * 1024, // 100 GB
    maxConnections: TIER_LIMITS.pro.maxConnections,
  },
  enterprise: {
    maxSyncOps: TIER_LIMITS.enterprise.maxOperations,
    maxStorage: TIER_LIMITS.enterprise.maxStorageBytes,
    maxBandwidth: Infinity,
    maxConnections: TIER_LIMITS.enterprise.maxConnections,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateApiKey(): string {
  return `pk_live_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// ── ProvisioningAPI ──────────────────────────────────────────────────────────

/**
 * Managed cloud provisioning service for Pocket Cloud.
 *
 * Handles project lifecycle, API key management, usage monitoring,
 * and quota enforcement.
 *
 * @example
 * ```typescript
 * import { createProvisioningAPI } from '@pocket/cloud';
 *
 * const api = createProvisioningAPI({ accountToken: 'acct_xxx' });
 * const project = await api.createProject('my-app', 'pro');
 *
 * const usage = await api.getUsage(project.id);
 * const quotas = await api.getQuotas(project.id);
 *
 * api.destroy();
 * ```
 */
export class ProvisioningAPI {
  private readonly config: ProvisioningConfig;
  private readonly projects = new Map<string, ProjectInfo>();
  private readonly usage = new Map<string, ProvisioningUsageMetrics>();
  private readonly destroy$ = new Subject<void>();
  private readonly events$$ = new Subject<ProvisioningEvent>();

  /** Observable stream of provisioning events. */
  readonly events$: Observable<ProvisioningEvent>;

  constructor(config: ProvisioningConfig) {
    this.config = config;
    this.events$ = this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Provision a new project with an API key.
   *
   * @param name - Human-readable project name
   * @param plan - Plan tier (defaults to 'free')
   * @returns The newly created project info
   */
  async createProject(name: string, plan: ProjectPlan = 'free'): Promise<ProjectInfo> {
    if (!name || name.trim().length === 0) {
      throw new Error('Project name is required');
    }

    const project: ProjectInfo = {
      id: generateId('proj'),
      name: name.trim(),
      plan,
      apiKey: generateApiKey(),
      createdAt: Date.now(),
      status: 'active',
    };

    this.projects.set(project.id, project);
    this.usage.set(project.id, {
      syncOps: 0,
      storage: 0,
      bandwidth: 0,
      measuredAt: Date.now(),
    });

    this.events$$.next({
      type: 'project.created',
      projectId: project.id,
      timestamp: Date.now(),
    });

    return project;
  }

  /**
   * Deprovision a project.
   *
   * @param projectId - ID of the project to delete
   */
  async deleteProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.status = 'deleted';
    this.projects.delete(projectId);
    this.usage.delete(projectId);

    this.events$$.next({
      type: 'project.deleted',
      projectId,
      timestamp: Date.now(),
    });
  }

  /**
   * List all projects for the account.
   *
   * @returns Array of project info objects
   */
  async listProjects(): Promise<ProjectInfo[]> {
    return Array.from(this.projects.values());
  }

  /**
   * Get usage metrics for a project.
   *
   * @param projectId - ID of the project
   * @returns Current usage metrics
   */
  async getUsage(projectId: string): Promise<ProvisioningUsageMetrics> {
    const metrics = this.usage.get(projectId);
    if (!metrics) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return { ...metrics, measuredAt: Date.now() };
  }

  /**
   * Rotate the API key for a project.
   *
   * @param projectId - ID of the project
   * @returns Updated project info with the new API key
   */
  async rotateApiKey(projectId: string): Promise<ProjectInfo> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.apiKey = generateApiKey();

    this.events$$.next({
      type: 'key.rotated',
      projectId,
      timestamp: Date.now(),
    });

    return { ...project };
  }

  /**
   * Get plan quota limits for a project.
   *
   * @param projectId - ID of the project
   * @returns Quota limits for the project's plan
   */
  async getQuotas(projectId: string): Promise<PlanQuotas> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return { ...PLAN_QUOTAS[project.plan] };
  }

  /**
   * Permanently destroy the API instance and release resources.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
    this.projects.clear();
    this.usage.clear();
  }

  /**
   * Get the current provisioning configuration.
   */
  getConfig(): ProvisioningConfig {
    return { ...this.config };
  }
}

/**
 * Create a ProvisioningAPI instance.
 *
 * @param config - Provisioning configuration
 * @returns A new ProvisioningAPI instance
 *
 * @example
 * ```typescript
 * const api = createProvisioningAPI({
 *   accountToken: 'acct_xxxxxxxx',
 *   apiEndpoint: 'https://cloud.pocket-db.dev',
 * });
 *
 * const project = await api.createProject('my-app', 'pro');
 * ```
 */
export function createProvisioningAPI(config: ProvisioningConfig): ProvisioningAPI {
  return new ProvisioningAPI(config);
}

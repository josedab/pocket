/**
 * CloudProvisioner - Automatic project provisioning for Pocket Cloud.
 *
 * Handles one-command project setup: creates project, generates API keys,
 * configures sync endpoints, and validates connectivity.
 */

import { CloudClient } from './cloud-client.js';
import { CloudDashboard } from './cloud-dashboard.js';
import type { CloudConfig, CloudProject, CloudEndpoint, ApiKeyInfo, CloudRegion, CloudTier } from './types.js';
import { DEFAULT_CLOUD_REGION } from './types.js';

export interface ProvisionOptions {
  /** Project name */
  name: string;
  /** Target region */
  region?: CloudRegion;
  /** Service tier */
  tier?: CloudTier;
  /** Auto-generate API keys */
  generateKeys?: boolean;
  /** Validate connectivity after provisioning */
  validateConnectivity?: boolean;
  /** Collections to pre-configure for sync */
  collections?: string[];
  /** Tags for project metadata */
  tags?: Record<string, string>;
}

export interface ProvisionResult {
  /** The created project */
  project: CloudProject;
  /** Generated API keys (if requested) */
  keys: {
    live?: ApiKeyInfo;
    test?: ApiKeyInfo;
  };
  /** Discovered sync endpoint */
  endpoint: CloudEndpoint;
  /** Connectivity validation result */
  connectivity: {
    checked: boolean;
    healthy: boolean;
    latencyMs: number | null;
  };
  /** Ready-to-use CloudConfig */
  config: CloudConfig;
}

export class CloudProvisioner {
  private readonly dashboard: CloudDashboard;
  private readonly adminConfig: CloudConfig;

  constructor(adminConfig: CloudConfig) {
    this.adminConfig = adminConfig;
    this.dashboard = new CloudDashboard(adminConfig);
  }

  /**
   * Provision a new project with full setup in a single call.
   */
  async provision(options: ProvisionOptions): Promise<ProvisionResult> {
    // Step 1: Create the project
    const project = await this.dashboard.createProject({
      name: options.name,
      region: options.region ?? DEFAULT_CLOUD_REGION,
      tier: options.tier ?? 'free',
      tags: options.tags,
    });

    // Step 2: Generate API keys if requested
    const keys: ProvisionResult['keys'] = {};
    if (options.generateKeys !== false) {
      const liveKey = await this.dashboard.createApiKey({
        name: `${options.name} - Live`,
        type: 'live',
        permissions: ['sync:read', 'sync:write', 'data:read', 'data:write'],
      });
      keys.live = liveKey;

      const testKey = await this.dashboard.createApiKey({
        name: `${options.name} - Test`,
        type: 'test',
        permissions: ['sync:read', 'sync:write', 'data:read', 'data:write'],
      });
      keys.test = testKey;
    }

    // Step 3: Build config for the new project
    const config: CloudConfig = {
      projectId: project.id,
      apiKey: keys.live?.key ?? this.adminConfig.apiKey,
      region: project.region,
      tier: project.tier,
    };

    // Step 4: Discover endpoint
    const client = new CloudClient(config);
    let endpoint: CloudEndpoint;
    try {
      endpoint = await client.getEndpoint();
    } finally {
      client.destroy();
    }

    // Step 5: Validate connectivity if requested
    let connectivity: ProvisionResult['connectivity'] = {
      checked: false,
      healthy: false,
      latencyMs: null,
    };

    if (options.validateConnectivity !== false) {
      connectivity = await this.checkConnectivity(endpoint);
    }

    return {
      project,
      keys,
      endpoint,
      connectivity,
      config,
    };
  }

  /**
   * Deprovision (delete) a project and all its resources.
   */
  async deprovision(projectId: string): Promise<void> {
    await this.dashboard.deleteProject(projectId);
  }

  /**
   * Check connectivity to a cloud endpoint.
   */
  async checkConnectivity(endpoint: CloudEndpoint): Promise<ProvisionResult['connectivity']> {
    const start = Date.now();
    try {
      const response = await globalThis.fetch(endpoint.httpUrl + '/health', {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - start;
      return {
        checked: true,
        healthy: response.ok,
        latencyMs,
      };
    } catch {
      return {
        checked: true,
        healthy: false,
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * List all provisioned projects.
   */
  async listProjects(): Promise<CloudProject[]> {
    return this.dashboard.listProjects();
  }
}

export function createCloudProvisioner(adminConfig: CloudConfig): CloudProvisioner {
  return new CloudProvisioner(adminConfig);
}

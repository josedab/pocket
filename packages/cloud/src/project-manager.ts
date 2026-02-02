/**
 * Cloud Project Manager — manage projects, environments, and deployments.
 */

import type { CloudTier, CloudRegion } from './types.js';

export interface ProjectEnvironment {
  id: string;
  name: string;
  type: 'development' | 'staging' | 'production';
  region: CloudRegion;
  createdAt: number;
  active: boolean;
  apiKeyPrefix: string;
}

export interface DeploymentRecord {
  id: string;
  projectId: string;
  environment: string;
  version: string;
  status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'rolled-back';
  createdAt: number;
  completedAt: number | null;
  changes: string[];
}

export interface ProjectTeamMember {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'viewer';
  addedAt: number;
}

export interface ManagedProject {
  id: string;
  name: string;
  tier: CloudTier;
  environments: ProjectEnvironment[];
  teamMembers: ProjectTeamMember[];
  deployments: DeploymentRecord[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Manages cloud projects: environments, team members, and deployments.
 *
 * @example
 * ```typescript
 * const pm = new ProjectManager();
 * pm.createProject('my-app', 'pro');
 * pm.addEnvironment('my-app', { name: 'prod', type: 'production', region: 'us-east-1' });
 * pm.addTeamMember('my-app', 'alice@example.com', 'admin');
 * ```
 */
export class ProjectManager {
  private readonly projects = new Map<string, ManagedProject>();

  /**
   * Create a new project.
   */
  createProject(name: string, tier: CloudTier = 'free'): ManagedProject {
    const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const project: ManagedProject = {
      id,
      name,
      tier,
      environments: [],
      teamMembers: [],
      deployments: [],
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(id, project);
    return project;
  }

  /**
   * Get a project by ID.
   */
  getProject(id: string): ManagedProject | undefined {
    return this.projects.get(id);
  }

  /**
   * List all projects.
   */
  listProjects(): ManagedProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Delete a project.
   */
  deleteProject(id: string): boolean {
    return this.projects.delete(id);
  }

  /**
   * Add an environment to a project.
   */
  addEnvironment(
    projectId: string,
    env: { name: string; type: ProjectEnvironment['type']; region: CloudRegion },
  ): ProjectEnvironment | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const environment: ProjectEnvironment = {
      id: `env_${Date.now().toString(36)}`,
      name: env.name,
      type: env.type,
      region: env.region,
      createdAt: Date.now(),
      active: true,
      apiKeyPrefix: env.type === 'production' ? 'pk_live_' : 'pk_test_',
    };

    project.environments.push(environment);
    project.updatedAt = Date.now();
    return environment;
  }

  /**
   * Get environments for a project.
   */
  getEnvironments(projectId: string): ProjectEnvironment[] {
    return this.projects.get(projectId)?.environments ?? [];
  }

  /**
   * Add a team member to a project.
   */
  addTeamMember(
    projectId: string,
    email: string,
    role: ProjectTeamMember['role'],
  ): ProjectTeamMember | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const existing = project.teamMembers.find((m) => m.email === email);
    if (existing) return null;

    const member: ProjectTeamMember = {
      id: `mem_${Date.now().toString(36)}`,
      email,
      role,
      addedAt: Date.now(),
    };

    project.teamMembers.push(member);
    project.updatedAt = Date.now();
    return member;
  }

  /**
   * Remove a team member.
   */
  removeTeamMember(projectId: string, email: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    const idx = project.teamMembers.findIndex((m) => m.email === email);
    if (idx < 0) return false;
    project.teamMembers.splice(idx, 1);
    project.updatedAt = Date.now();
    return true;
  }

  /**
   * Record a deployment.
   */
  createDeployment(
    projectId: string,
    environment: string,
    version: string,
    changes: string[] = [],
  ): DeploymentRecord | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const deployment: DeploymentRecord = {
      id: `dep_${Date.now().toString(36)}`,
      projectId,
      environment,
      version,
      status: 'pending',
      createdAt: Date.now(),
      completedAt: null,
      changes,
    };

    project.deployments.push(deployment);
    project.updatedAt = Date.now();
    return deployment;
  }

  /**
   * Update deployment status.
   */
  updateDeploymentStatus(
    projectId: string,
    deploymentId: string,
    status: DeploymentRecord['status'],
  ): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    const dep = project.deployments.find((d) => d.id === deploymentId);
    if (!dep) return false;
    dep.status = status;
    if (status === 'deployed' || status === 'failed' || status === 'rolled-back') {
      dep.completedAt = Date.now();
    }
    return true;
  }

  /**
   * Get deployment history for a project.
   */
  getDeployments(projectId: string): DeploymentRecord[] {
    return this.projects.get(projectId)?.deployments ?? [];
  }

  /**
   * Upgrade project tier.
   */
  upgradeTier(projectId: string, tier: CloudTier): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    project.tier = tier;
    project.updatedAt = Date.now();
    return true;
  }
}

/**
 * Create a ProjectManager instance.
 */
export function createProjectManager(): ProjectManager {
  return new ProjectManager();
}

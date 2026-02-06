/**
 * @pocket/cli - Deploy Rollback
 *
 * Tracks deployment history and provides rollback capabilities
 * for reverting to previous deployments.
 *
 * @module @pocket/cli/commands/deploy
 *
 * @example Roll back to a previous deployment
 * ```typescript
 * import { recordDeployment, rollback, getDeploymentHistory } from '@pocket/cli';
 *
 * // Record a deployment
 * recordDeployment({
 *   target: 'cloudflare',
 *   version: '1.2.0',
 *   commitSha: 'abc1234',
 * });
 *
 * // Roll back to previous version
 * const result = rollback({ target: 'cloudflare', toVersion: '1.1.0' });
 * console.log(result.script);
 * ```
 */

import type { DeployTarget } from './config-generator.js';

/**
 * Options for recording a deployment.
 */
export interface RecordDeploymentOptions {
  /** Deployment target */
  target: DeployTarget;
  /** Semantic version or label */
  version: string;
  /** Git commit SHA */
  commitSha?: string;
  /** Project name */
  projectName?: string;
  /** Deployment metadata */
  metadata?: Record<string, string>;
}

/**
 * A recorded deployment entry.
 */
export interface DeploymentRecord {
  /** Unique deployment identifier */
  id: string;
  /** Deployment target */
  target: DeployTarget;
  /** Version label */
  version: string;
  /** Git commit SHA */
  commitSha: string;
  /** Project name */
  projectName: string;
  /** Deployment timestamp (ISO 8601) */
  deployedAt: string;
  /** Additional metadata */
  metadata: Record<string, string>;
}

/**
 * Options for performing a rollback.
 */
export interface RollbackOptions {
  /** Deployment target */
  target: DeployTarget;
  /** Version to roll back to */
  toVersion?: string;
  /** Deployment ID to roll back to */
  toDeploymentId?: string;
  /** Project name */
  projectName?: string;
  /** Perform safety checks before rollback */
  safetyChecks?: boolean;
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
  /** Whether the rollback plan was generated successfully */
  success: boolean;
  /** Current deployment */
  current: DeploymentRecord | undefined;
  /** Target deployment to roll back to */
  rollbackTo: DeploymentRecord;
  /** Platform-specific rollback script */
  script: string;
  /** Safety check warnings */
  warnings: string[];
  /** Differences between current and rollback versions */
  diff: DeploymentDiff[];
}

/**
 * A difference between two deployment versions.
 */
export interface DeploymentDiff {
  /** Field that differs */
  field: string;
  /** Value in the current deployment */
  current: string;
  /** Value in the rollback target */
  rollbackTo: string;
}

/** In-memory deployment history store, keyed by target. */
const deploymentHistory: Map<string, DeploymentRecord[]> = new Map();

let deploymentCounter = 0;

function generateDeploymentId(): string {
  deploymentCounter++;
  const timestamp = Date.now().toString(36);
  return `deploy-${timestamp}-${deploymentCounter}`;
}

function getHistoryKey(target: DeployTarget, projectName: string): string {
  return `${target}:${projectName}`;
}

/**
 * Record a new deployment in the history.
 *
 * @param options - Deployment details to record
 * @returns The recorded deployment entry
 *
 * @example
 * ```typescript
 * const record = recordDeployment({
 *   target: 'vercel',
 *   version: '2.0.0',
 *   commitSha: 'def5678',
 * });
 * console.log(`Recorded deployment ${record.id}`);
 * ```
 */
export function recordDeployment(options: RecordDeploymentOptions): DeploymentRecord {
  const projectName = options.projectName ?? 'pocket-app';
  const key = getHistoryKey(options.target, projectName);

  const record: DeploymentRecord = {
    id: generateDeploymentId(),
    target: options.target,
    version: options.version,
    commitSha: options.commitSha ?? 'unknown',
    projectName,
    deployedAt: new Date().toISOString(),
    metadata: options.metadata ?? {},
  };

  const history = deploymentHistory.get(key) ?? [];
  history.push(record);
  deploymentHistory.set(key, history);

  return record;
}

/**
 * Get the deployment history for a target and project.
 *
 * @param target - Deployment target
 * @param projectName - Project name (default: "pocket-app")
 * @param limit - Maximum number of entries to return
 * @returns Array of deployment records, newest first
 *
 * @example
 * ```typescript
 * const history = getDeploymentHistory('cloudflare', 'my-app', 10);
 * for (const record of history) {
 *   console.log(`${record.version} deployed at ${record.deployedAt}`);
 * }
 * ```
 */
export function getDeploymentHistory(
  target: DeployTarget,
  projectName?: string,
  limit?: number
): DeploymentRecord[] {
  const name = projectName ?? 'pocket-app';
  const key = getHistoryKey(target, name);
  const history = deploymentHistory.get(key) ?? [];

  const sorted = [...history].reverse();
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Generate a platform-specific rollback script.
 */
function generateRollbackScript(target: DeployTarget, record: DeploymentRecord): string {
  switch (target) {
    case 'cloudflare':
      return [
        '#!/bin/bash',
        `# Rollback ${record.projectName} to version ${record.version}`,
        `# Deployment: ${record.id}`,
        `# Commit: ${record.commitSha}`,
        '',
        `echo "Rolling back to version ${record.version}..."`,
        `git checkout ${record.commitSha}`,
        'wrangler deploy',
        `echo "Rollback to ${record.version} complete"`,
      ].join('\n');

    case 'deno':
      return [
        '#!/bin/bash',
        `# Rollback ${record.projectName} to version ${record.version}`,
        `# Deployment: ${record.id}`,
        `# Commit: ${record.commitSha}`,
        '',
        `echo "Rolling back to version ${record.version}..."`,
        `git checkout ${record.commitSha}`,
        `deployctl deploy --project=${record.projectName} src/server.ts`,
        `echo "Rollback to ${record.version} complete"`,
      ].join('\n');

    case 'vercel':
      return [
        '#!/bin/bash',
        `# Rollback ${record.projectName} to version ${record.version}`,
        `# Deployment: ${record.id}`,
        `# Commit: ${record.commitSha}`,
        '',
        `echo "Rolling back to version ${record.version}..."`,
        `git checkout ${record.commitSha}`,
        'vercel deploy --prod',
        `echo "Rollback to ${record.version} complete"`,
      ].join('\n');

    case 'fly':
      return [
        '#!/bin/bash',
        `# Rollback ${record.projectName} to version ${record.version}`,
        `# Deployment: ${record.id}`,
        `# Commit: ${record.commitSha}`,
        '',
        `echo "Rolling back to version ${record.version}..."`,
        `git checkout ${record.commitSha}`,
        'fly deploy',
        `echo "Rollback to ${record.version} complete"`,
      ].join('\n');

    default:
      return `# Unsupported target: ${String(target)}`;
  }
}

/**
 * Compute differences between two deployment records.
 */
function computeDeploymentDiff(
  current: DeploymentRecord | undefined,
  rollbackTo: DeploymentRecord
): DeploymentDiff[] {
  if (!current) return [];

  const diffs: DeploymentDiff[] = [];

  if (current.version !== rollbackTo.version) {
    diffs.push({ field: 'version', current: current.version, rollbackTo: rollbackTo.version });
  }
  if (current.commitSha !== rollbackTo.commitSha) {
    diffs.push({ field: 'commitSha', current: current.commitSha, rollbackTo: rollbackTo.commitSha });
  }
  if (current.deployedAt !== rollbackTo.deployedAt) {
    diffs.push({ field: 'deployedAt', current: current.deployedAt, rollbackTo: rollbackTo.deployedAt });
  }

  return diffs;
}

/**
 * Perform safety checks before a rollback.
 */
function performSafetyChecks(
  current: DeploymentRecord | undefined,
  rollbackTo: DeploymentRecord
): string[] {
  const warnings: string[] = [];

  if (!current) {
    warnings.push('No current deployment found — this will be a fresh deploy, not a rollback.');
  }

  if (rollbackTo.commitSha === 'unknown') {
    warnings.push('Rollback target has no commit SHA — manual checkout required.');
  }

  if (current && current.version === rollbackTo.version) {
    warnings.push('Current and rollback versions are identical.');
  }

  const rollbackAge = Date.now() - new Date(rollbackTo.deployedAt).getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (rollbackAge > thirtyDays) {
    warnings.push('Rollback target is more than 30 days old — verify compatibility.');
  }

  return warnings;
}

/**
 * Generate a rollback plan to revert to a previous deployment.
 *
 * Looks up the target version in the deployment history, performs
 * optional safety checks, and generates a platform-specific rollback script.
 *
 * @param options - Rollback options
 * @returns Rollback result with script and warnings
 *
 * @example
 * ```typescript
 * const result = rollback({
 *   target: 'cloudflare',
 *   toVersion: '1.0.0',
 *   safetyChecks: true,
 * });
 *
 * if (result.warnings.length > 0) {
 *   console.warn('Warnings:', result.warnings);
 * }
 * console.log(result.script);
 * ```
 */
export function rollback(options: RollbackOptions): RollbackResult {
  const projectName = options.projectName ?? 'pocket-app';
  const key = getHistoryKey(options.target, projectName);
  const history = deploymentHistory.get(key) ?? [];

  if (history.length === 0) {
    throw new Error(`No deployment history found for ${options.target}:${projectName}`);
  }

  // Find the target deployment
  let rollbackTarget: DeploymentRecord | undefined;

  if (options.toDeploymentId) {
    rollbackTarget = history.find(r => r.id === options.toDeploymentId);
    if (!rollbackTarget) {
      throw new Error(`Deployment not found: ${options.toDeploymentId}`);
    }
  } else if (options.toVersion) {
    // Find the most recent deployment with the specified version
    rollbackTarget = [...history].reverse().find(r => r.version === options.toVersion);
    if (!rollbackTarget) {
      throw new Error(`Version not found in history: ${options.toVersion}`);
    }
  } else {
    // Default: roll back to the second most recent deployment
    if (history.length < 2) {
      throw new Error('Not enough deployment history to roll back. Need at least 2 deployments.');
    }
    rollbackTarget = history[history.length - 2]!;
  }

  // All undefined paths throw above, so rollbackTarget is guaranteed here
  const target = rollbackTarget as DeploymentRecord;
  const current = history[history.length - 1];
  const safetyChecks = options.safetyChecks !== false;
  const warnings = safetyChecks ? performSafetyChecks(current, target) : [];
  const diff = computeDeploymentDiff(current, target);
  const script = generateRollbackScript(options.target, target);

  return {
    success: true,
    current,
    rollbackTo: target,
    script,
    warnings,
    diff,
  };
}

/**
 * Clear the deployment history for a target and project.
 *
 * @param target - Deployment target
 * @param projectName - Project name
 */
export function clearDeploymentHistory(target: DeployTarget, projectName?: string): void {
  const name = projectName ?? 'pocket-app';
  const key = getHistoryKey(target, name);
  deploymentHistory.delete(key);
}

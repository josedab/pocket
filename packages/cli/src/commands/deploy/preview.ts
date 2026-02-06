/**
 * @pocket/cli - Deploy Preview
 *
 * Creates and manages temporary preview deployments
 * for testing before promoting to production.
 *
 * @module @pocket/cli/commands/deploy
 *
 * @example Create a preview deployment
 * ```typescript
 * import { createPreview, listPreviews } from '@pocket/cli';
 *
 * const preview = createPreview({
 *   projectName: 'my-app',
 *   target: 'cloudflare',
 *   branch: 'feature/new-sync',
 * });
 *
 * console.log(preview.url); // https://preview-abc123.my-app.workers.dev
 * ```
 */

import type { DeployTarget } from './config-generator.js';

/**
 * Options for creating a preview deployment.
 */
export interface PreviewOptions {
  /** Project name */
  projectName?: string;
  /** Deployment target platform */
  target: DeployTarget;
  /** Git branch name */
  branch?: string;
  /** Git commit SHA */
  commitSha?: string;
  /** Preview expiration in hours (default: 24) */
  expiresInHours?: number;
  /** Custom label for the preview */
  label?: string;
}

/**
 * Metadata for an active preview deployment.
 */
export interface PreviewDeployment {
  /** Unique preview identifier */
  id: string;
  /** Preview URL */
  url: string;
  /** Deployment target */
  target: DeployTarget;
  /** Project name */
  projectName: string;
  /** Git branch */
  branch: string;
  /** Git commit SHA */
  commitSha: string;
  /** Custom label */
  label: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Expiration timestamp (ISO 8601) */
  expiresAt: string;
  /** Preview status */
  status: 'pending' | 'active' | 'expired' | 'deleted';
}

/**
 * Result of comparing two preview deployments.
 */
export interface PreviewComparison {
  /** Source preview */
  source: PreviewDeployment;
  /** Target preview to compare against */
  target: PreviewDeployment;
  /** Summary of differences */
  differences: PreviewDiff[];
}

/**
 * A single difference between two previews.
 */
export interface PreviewDiff {
  /** Category of the difference */
  category: 'config' | 'env' | 'version' | 'target';
  /** Description of the change */
  description: string;
}

/** In-memory store for previews. */
const previewStore: Map<string, PreviewDeployment> = new Map();

/**
 * Generate a unique preview identifier.
 */
function generatePreviewId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Build a preview URL based on the target platform.
 */
function buildPreviewUrl(id: string, projectName: string, target: DeployTarget): string {
  switch (target) {
    case 'cloudflare':
      return `https://preview-${id}.${projectName}.workers.dev`;
    case 'deno':
      return `https://${projectName}--preview-${id}.deno.dev`;
    case 'vercel':
      return `https://${projectName}-${id}.vercel.app`;
    case 'fly':
      return `https://preview-${id}.${projectName}.fly.dev`;
    default:
      return `https://preview-${id}.${projectName}.example.com`;
  }
}

/**
 * Create a new preview deployment.
 *
 * Generates a unique preview identifier and URL, registers the
 * preview in the in-memory store, and returns the preview metadata.
 *
 * @param options - Preview options
 * @returns Preview deployment metadata
 *
 * @example
 * ```typescript
 * const preview = createPreview({
 *   target: 'vercel',
 *   branch: 'feat/auth',
 *   commitSha: 'abc1234',
 * });
 * console.log(`Preview ready at ${preview.url}`);
 * ```
 */
export function createPreview(options: PreviewOptions): PreviewDeployment {
  const projectName = options.projectName ?? 'pocket-app';
  const id = generatePreviewId();
  const expiresInHours = options.expiresInHours ?? 24;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);

  const preview: PreviewDeployment = {
    id,
    url: buildPreviewUrl(id, projectName, options.target),
    target: options.target,
    projectName,
    branch: options.branch ?? 'main',
    commitSha: options.commitSha ?? 'unknown',
    label: options.label ?? `preview-${id}`,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active',
  };

  previewStore.set(id, preview);
  return preview;
}

/**
 * List all tracked preview deployments.
 *
 * @param filter - Optional status filter
 * @returns Array of preview deployments
 *
 * @example
 * ```typescript
 * const active = listPreviews('active');
 * console.log(`${active.length} active previews`);
 * ```
 */
export function listPreviews(filter?: PreviewDeployment['status']): PreviewDeployment[] {
  const now = new Date();
  const previews: PreviewDeployment[] = [];

  for (const preview of previewStore.values()) {
    // Auto-expire previews past their expiration time
    if (preview.status === 'active' && new Date(preview.expiresAt) < now) {
      preview.status = 'expired';
    }
    if (!filter || preview.status === filter) {
      previews.push({ ...preview });
    }
  }

  return previews;
}

/**
 * Get a specific preview by its identifier.
 *
 * @param id - Preview identifier
 * @returns Preview deployment or undefined if not found
 */
export function getPreview(id: string): PreviewDeployment | undefined {
  const preview = previewStore.get(id);
  if (!preview) return undefined;

  // Auto-expire if past expiration
  const now = new Date();
  if (preview.status === 'active' && new Date(preview.expiresAt) < now) {
    preview.status = 'expired';
  }

  return { ...preview };
}

/**
 * Delete a preview deployment and mark it as deleted.
 *
 * @param id - Preview identifier
 * @returns true if the preview was deleted, false if not found
 *
 * @example
 * ```typescript
 * const deleted = deletePreview('abc12345');
 * if (deleted) console.log('Preview cleaned up');
 * ```
 */
export function deletePreview(id: string): boolean {
  const preview = previewStore.get(id);
  if (!preview) return false;

  preview.status = 'deleted';
  return true;
}

/**
 * Remove all expired and deleted previews from the store.
 *
 * @returns Number of previews cleaned up
 */
export function cleanupPreviews(): number {
  const now = new Date();
  let cleaned = 0;

  for (const [id, preview] of previewStore.entries()) {
    if (
      preview.status === 'deleted' ||
      preview.status === 'expired' ||
      (preview.status === 'active' && new Date(preview.expiresAt) < now)
    ) {
      previewStore.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Compare two preview deployments to identify differences.
 *
 * @param sourceId - Source preview identifier
 * @param targetId - Target preview identifier
 * @returns Comparison result with list of differences
 *
 * @example
 * ```typescript
 * const comparison = comparePreviews('abc12345', 'def67890');
 * for (const diff of comparison.differences) {
 *   console.log(`${diff.category}: ${diff.description}`);
 * }
 * ```
 */
export function comparePreviews(sourceId: string, targetId: string): PreviewComparison {
  const source = previewStore.get(sourceId);
  const target = previewStore.get(targetId);

  if (!source) {
    throw new Error(`Preview not found: ${sourceId}`);
  }
  if (!target) {
    throw new Error(`Preview not found: ${targetId}`);
  }

  const differences: PreviewDiff[] = [];

  if (source.target !== target.target) {
    differences.push({
      category: 'target',
      description: `Platform changed from ${source.target} to ${target.target}`,
    });
  }

  if (source.branch !== target.branch) {
    differences.push({
      category: 'version',
      description: `Branch changed from ${source.branch} to ${target.branch}`,
    });
  }

  if (source.commitSha !== target.commitSha) {
    differences.push({
      category: 'version',
      description: `Commit changed from ${source.commitSha} to ${target.commitSha}`,
    });
  }

  if (source.projectName !== target.projectName) {
    differences.push({
      category: 'config',
      description: `Project name changed from ${source.projectName} to ${target.projectName}`,
    });
  }

  return {
    source: { ...source },
    target: { ...target },
    differences,
  };
}

/**
 * @pocket/sync-policies — Policy validation and serialization.
 *
 * @module @pocket/sync-policies
 */

import type {
  CollectionPolicyDefinition,
  FilterExpression,
  PolicyValidationError,
  PolicyValidationResult,
  SyncPolicyDefinition,
} from './types.js';

// ── Validator ─────────────────────────────────────────────

/**
 * Validate a sync policy definition for correctness.
 */
export function validatePolicy(policy: SyncPolicyDefinition): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];
  const warnings: PolicyValidationError[] = [];

  if (!policy.name || policy.name.trim().length === 0) {
    errors.push({ path: 'name', message: 'Policy name is required', severity: 'error' });
  }

  if (policy.version < 1) {
    errors.push({ path: 'version', message: 'Version must be >= 1', severity: 'error' });
  }

  if (!policy.collections || policy.collections.length === 0) {
    errors.push({ path: 'collections', message: 'At least one collection must be defined', severity: 'error' });
  }

  const collectionNames = new Set<string>();
  for (let i = 0; i < (policy.collections?.length ?? 0); i++) {
    const col = policy.collections[i]!;
    const path = `collections[${i}]`;

    if (!col.collection || col.collection.trim().length === 0) {
      errors.push({ path: `${path}.collection`, message: 'Collection name is required', severity: 'error' });
    }

    if (collectionNames.has(col.collection)) {
      errors.push({ path: `${path}.collection`, message: `Duplicate collection: "${col.collection}"`, severity: 'error' });
    }
    collectionNames.add(col.collection);

    validateCollectionPolicy(col, path, errors, warnings);
  }

  if (policy.bandwidthConfig) {
    if (policy.bandwidthConfig.maxBytesPerSync !== undefined && policy.bandwidthConfig.maxBytesPerSync <= 0) {
      errors.push({ path: 'bandwidthConfig.maxBytesPerSync', message: 'Must be positive', severity: 'error' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateCollectionPolicy(
  col: CollectionPolicyDefinition,
  path: string,
  errors: PolicyValidationError[],
  warnings: PolicyValidationError[],
): void {
  const validDirections = ['push', 'pull', 'both', 'none'];
  if (!validDirections.includes(col.direction)) {
    errors.push({ path: `${path}.direction`, message: `Invalid direction: "${col.direction}"`, severity: 'error' });
  }

  const validPriorities = ['critical', 'high', 'normal', 'low', 'background'];
  if (!validPriorities.includes(col.priority)) {
    errors.push({ path: `${path}.priority`, message: `Invalid priority: "${col.priority}"`, severity: 'error' });
  }

  if (col.batchSize !== undefined && col.batchSize < 1) {
    errors.push({ path: `${path}.batchSize`, message: 'Batch size must be positive', severity: 'error' });
  }

  if (col.rateLimit !== undefined && col.rateLimit < 1) {
    errors.push({ path: `${path}.rateLimit`, message: 'Rate limit must be positive', severity: 'error' });
  }

  if (col.direction === 'none' && col.enabled) {
    warnings.push({ path: `${path}`, message: `Collection "${col.collection}" has direction "none" but is enabled`, severity: 'warning' });
  }

  if (col.fields) {
    if (col.fields.fields.length === 0) {
      warnings.push({ path: `${path}.fields`, message: 'Field policy has no fields defined', severity: 'warning' });
    }
  }

  if (col.filter) {
    validateFilterExpression(col.filter, `${path}.filter`, errors);
  }
}

function validateFilterExpression(
  filter: FilterExpression,
  path: string,
  errors: PolicyValidationError[],
): void {
  switch (filter.type) {
    case 'comparison':
      if (!filter.field) {
        errors.push({ path: `${path}.field`, message: 'Comparison filter requires a field', severity: 'error' });
      }
      break;
    case 'and':
    case 'or':
    case 'not':
      if (!filter.conditions || filter.conditions.length === 0) {
        errors.push({ path, message: `${filter.type} filter requires at least one condition`, severity: 'error' });
      }
      for (let i = 0; i < (filter.conditions?.length ?? 0); i++) {
        validateFilterExpression(filter.conditions[i]!, `${path}.conditions[${i}]`, errors);
      }
      break;
    case 'in':
      if (!filter.field) {
        errors.push({ path: `${path}.field`, message: 'In filter requires a field', severity: 'error' });
      }
      if (!filter.values || filter.values.length === 0) {
        errors.push({ path: `${path}.values`, message: 'In filter requires values', severity: 'error' });
      }
      break;
    case 'exists':
      if (!filter.field) {
        errors.push({ path: `${path}.field`, message: 'Exists filter requires a field', severity: 'error' });
      }
      break;
    case 'time':
      if (!filter.field) {
        errors.push({ path: `${path}.field`, message: 'Time filter requires a field', severity: 'error' });
      }
      if (!filter.since && !filter.until) {
        errors.push({ path, message: 'Time filter requires at least "since" or "until"', severity: 'error' });
      }
      break;
  }
}

// ── Serialization ─────────────────────────────────────────

/** Serialize a policy to JSON string */
export function serializePolicy(policy: SyncPolicyDefinition): string {
  return JSON.stringify(policy, null, 2);
}

/** Deserialize a policy from JSON string with validation */
export function deserializePolicy(json: string): SyncPolicyDefinition {
  const policy = JSON.parse(json) as SyncPolicyDefinition;
  const validation = validatePolicy(policy);
  if (!validation.valid) {
    const msgs = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Invalid policy: ${msgs}`);
  }
  return policy;
}

/**
 * @pocket/sync-policies — Declarative DSL for defining selective sync policies.
 *
 * Define which collections, documents, and fields sync to the server using
 * a fluent builder API. Supports conditional rules, user-based filtering,
 * and bandwidth optimization.
 *
 * @example
 * ```ts
 * import { syncPolicy, createPolicyEvaluator, validatePolicy } from '@pocket/sync-policies';
 *
 * const policy = syncPolicy('mobile-optimized')
 *   .collection('messages')
 *     .direction('both')
 *     .priority('high')
 *     .filter(f => f.field('createdAt').gte(Date.now() - 7 * 86400000))
 *     .includeFields('id', 'text', 'senderId')
 *     .done()
 *   .collection('attachments')
 *     .direction('pull')
 *     .priority('low')
 *     .done()
 *   .bandwidth({ mode: 'metered', maxBytesPerSync: 5_000_000 })
 *   .build();
 *
 * const evaluator = createPolicyEvaluator(policy);
 * const result = evaluator.evaluate('messages', myDoc);
 * ```
 *
 * @module @pocket/sync-policies
 */

// Types
export type {
  BandwidthConfig,
  CollectionPolicyDefinition,
  ComparisonFilter,
  ConflictStrategy,
  CustomFilter,
  ExistsFilter,
  FieldPolicy,
  FilterExpression,
  GlobalPolicyConfig,
  InFilter,
  LogicalFilter,
  PolicyEvaluationResult,
  PolicyValidationError,
  PolicyValidationResult,
  SyncDirection,
  SyncPolicyDefinition,
  SyncPriority,
  TimeFilter,
  UserCondition,
  UserScopeDefinition,
} from './types.js';

// Policy Builder DSL
export {
  CollectionPolicyBuilder,
  FieldFilterBuilder,
  FilterBuilder,
  SyncPolicyBuilder,
  UserScopeBuilder,
  syncPolicy,
} from './policy-builder.js';

// Policy Evaluator
export {
  PolicyEvaluator,
  createPolicyEvaluator,
  evaluateFilter,
} from './policy-evaluator.js';
export type { UserContext } from './policy-evaluator.js';

// Validation & Serialization
export {
  deserializePolicy,
  serializePolicy,
  validatePolicy,
} from './policy-validator.js';

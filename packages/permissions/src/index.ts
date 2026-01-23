/**
 * @pocket/permissions - Permissions and row-level security for Pocket
 *
 * @example
 * ```typescript
 * import {
 *   createPermissionManager,
 *   createUsePermissionsHook,
 * } from '@pocket/permissions';
 *
 * // Create permission manager
 * const manager = createPermissionManager({
 *   defaultPolicy: 'deny',
 *   auditEnabled: true,
 * });
 *
 * // Add global admin rule
 * manager.addRule({
 *   name: 'Admin Full Access',
 *   resource: '*',
 *   actions: ['create', 'read', 'update', 'delete', 'list', 'admin'],
 *   roles: ['admin'],
 *   effect: 'allow',
 *   priority: 100,
 * });
 *
 * // Add collection-specific rules
 * manager.addCollectionRule('posts', {
 *   name: 'Authors Can Edit Own Posts',
 *   resource: 'posts',
 *   actions: ['update', 'delete'],
 *   conditions: [
 *     { field: 'authorId', operator: 'eq', value: '$userId' }
 *   ],
 *   effect: 'allow',
 * });
 *
 * // Add RLS policy
 * manager.addRLSPolicy('posts', {
 *   name: 'Users See Own Posts',
 *   collection: 'posts',
 *   actions: ['read', 'list'],
 *   filter: {
 *     type: 'field',
 *     field: 'authorId',
 *     userPath: 'id',
 *   },
 * });
 *
 * // Add team-based RLS policy
 * manager.addRLSPolicy('documents', {
 *   name: 'Team Members See Team Docs',
 *   collection: 'documents',
 *   actions: ['read', 'list'],
 *   filter: {
 *     type: 'field',
 *     field: 'teamId',
 *     userPath: 'teamIds',
 *   },
 * });
 *
 * // Check permissions
 * const userContext = {
 *   id: 'user-123',
 *   roles: ['user'],
 *   attributes: {},
 *   teamIds: ['team-1', 'team-2'],
 * };
 *
 * const canEdit = manager.can(userContext, 'update', {
 *   type: 'posts',
 *   id: 'post-456',
 *   attributes: { authorId: 'user-123' },
 * });
 *
 * // Filter documents
 * const visiblePosts = manager.filter(userContext, 'posts', allPosts, 'read');
 *
 * // React integration
 * const usePermissions = createUsePermissionsHook(React);
 *
 * function PostActions({ post }) {
 *   const { can } = usePermissions(manager, userContext);
 *
 *   return (
 *     <div>
 *       {can('update', { type: 'posts', id: post.id, attributes: post }) && (
 *         <button>Edit</button>
 *       )}
 *       {can('delete', { type: 'posts', id: post.id, attributes: post }) && (
 *         <button>Delete</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */

// Types
export type {
  AuditLogEntry,
  CollectionPermissions,
  FieldPermission,
  PermissionAction,
  PermissionCheckResult,
  PermissionCondition,
  PermissionConfig,
  PermissionEvent,
  PermissionEventType,
  PermissionRule,
  RLSFilter,
  RLSPolicy,
  Resource,
  UserContext,
} from './types.js';

// Permission Evaluator
export { PermissionEvaluator, createPermissionEvaluator } from './permission-evaluator.js';

// Permission Manager
export { PermissionManager, createPermissionManager } from './permission-manager.js';

// Hooks
export type {
  ReactHooks,
  UsePermissionEventsReturn,
  UsePermissionReturn,
  UsePermissionsReturn,
} from './hooks.js';

export {
  createCanComponent,
  createUsePermissionEventsHook,
  createUsePermissionHook,
  createUsePermissionsHook,
} from './hooks.js';

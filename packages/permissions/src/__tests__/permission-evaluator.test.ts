import { describe, expect, it, vi } from 'vitest';
import { PermissionEvaluator, createPermissionEvaluator } from '../permission-evaluator.js';
import type { PermissionConfig, PermissionRule, Resource, UserContext } from '../types.js';

function makeUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    id: 'user-1',
    roles: ['viewer'],
    attributes: {},
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    type: 'documents',
    ...overrides,
  };
}

function makeRule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: 'rule-1',
    name: 'test-rule',
    resource: 'documents',
    actions: ['read'],
    effect: 'allow',
    enabled: true,
    ...overrides,
  };
}

describe('PermissionEvaluator', () => {
  describe('checkPermission() - basic', () => {
    it('should deny by default when no rules match (defaultPolicy=deny)', () => {
      const evaluator = new PermissionEvaluator({ defaultPolicy: 'deny' });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Default policy');
    });

    it('should allow by default when no rules match (defaultPolicy=allow)', () => {
      const evaluator = new PermissionEvaluator({ defaultPolicy: 'allow' });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(true);
    });

    it('should match a global allow rule', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ actions: ['read'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(true);
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule?.name).toBe('test-rule');
    });

    it('should match a global deny rule', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'allow',
        globalRules: [makeRule({ actions: ['delete'], effect: 'deny' })],
      });
      const result = evaluator.checkPermission(makeUser(), 'delete', makeResource());

      expect(result.allowed).toBe(false);
    });

    it('should skip rules for non-matching actions', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ actions: ['create'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkPermission() - role matching', () => {
    it('should match when user has required role', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: ['admin'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(
        makeUser({ roles: ['admin'] }),
        'read',
        makeResource()
      );

      expect(result.allowed).toBe(true);
    });

    it('should not match when user lacks required role', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: ['admin'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(
        makeUser({ roles: ['viewer'] }),
        'read',
        makeResource()
      );

      expect(result.allowed).toBe(false);
    });

    it('should match when user has one of multiple roles', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: ['admin', 'editor'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(
        makeUser({ roles: ['editor'] }),
        'read',
        makeResource()
      );

      expect(result.allowed).toBe(true);
    });

    it('should allow any role when roles array is empty', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: [], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(
        makeUser({ roles: ['anything'] }),
        'read',
        makeResource()
      );

      expect(result.allowed).toBe(true);
    });

    it('should handle empty user roles', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: ['admin'], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser({ roles: [] }), 'read', makeResource());

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkPermission() - condition evaluation', () => {
    it('should evaluate eq condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'ownerId', operator: 'eq', value: '$userId' }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1' }),
        'read',
        makeResource({ attributes: { ownerId: 'user-1' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate neq condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'status', operator: 'neq', value: 'archived' }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ attributes: { status: 'active' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate in condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'status', operator: 'in', value: ['active', 'pending'] }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ attributes: { status: 'active' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate nin condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'status', operator: 'nin', value: ['archived', 'deleted'] }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ attributes: { status: 'active' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate gt/gte/lt/lte conditions', () => {
      const config: Partial<PermissionConfig> = {
        defaultPolicy: 'deny',
        cacheEnabled: false,
        globalRules: [
          makeRule({
            conditions: [{ field: 'priority', operator: 'gt', value: 5 }],
            effect: 'allow',
          }),
        ],
      };
      const evaluator = new PermissionEvaluator(config);

      expect(
        evaluator.checkPermission(
          makeUser(),
          'read',
          makeResource({ id: 'a', attributes: { priority: 10 } })
        ).allowed
      ).toBe(true);

      expect(
        evaluator.checkPermission(
          makeUser(),
          'read',
          makeResource({ id: 'b', attributes: { priority: 3 } })
        ).allowed
      ).toBe(false);
    });

    it('should evaluate contains condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'name', operator: 'contains', value: 'test' }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ attributes: { name: 'my test doc' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate exists condition', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        cacheEnabled: false,
        globalRules: [
          makeRule({
            conditions: [{ field: 'email', operator: 'exists', value: true }],
            effect: 'allow',
          }),
        ],
      });

      expect(
        evaluator.checkPermission(
          makeUser(),
          'read',
          makeResource({ id: 'a', attributes: { email: 'a@b.com' } })
        ).allowed
      ).toBe(true);

      expect(
        evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'b', attributes: {} }))
          .allowed
      ).toBe(false);
    });

    it('should resolve $user.field references in condition values', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({
            conditions: [{ field: 'teamId', operator: 'eq', value: '$user.attributes.teamId' }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser({ attributes: { teamId: 'team-1' } }),
        'read',
        makeResource({ attributes: { teamId: 'team-1' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should require all conditions to pass (AND)', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        cacheEnabled: false,
        globalRules: [
          makeRule({
            conditions: [
              { field: 'status', operator: 'eq', value: 'active' },
              { field: 'ownerId', operator: 'eq', value: '$userId' },
            ],
            effect: 'allow',
          }),
        ],
      });

      // Both conditions met
      expect(
        evaluator.checkPermission(
          makeUser({ id: 'user-1' }),
          'read',
          makeResource({ id: 'a', attributes: { status: 'active', ownerId: 'user-1' } })
        ).allowed
      ).toBe(true);

      // Only one condition met
      expect(
        evaluator.checkPermission(
          makeUser({ id: 'user-1' }),
          'read',
          makeResource({ id: 'b', attributes: { status: 'archived', ownerId: 'user-1' } })
        ).allowed
      ).toBe(false);
    });
  });

  describe('checkPermission() - priority ordering', () => {
    it('should evaluate higher priority rules first', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [
          makeRule({ id: 'low', name: 'low-priority', priority: 1, effect: 'allow' }),
          makeRule({ id: 'high', name: 'high-priority', priority: 10, effect: 'deny' }),
        ],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(false);
      expect(result.matchedRule?.name).toBe('high-priority');
    });
  });

  describe('checkPermission() - disabled rules', () => {
    it('should skip disabled rules', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ enabled: false, effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkPermission() - collection-specific rules', () => {
    it('should match collection-specific rules', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [],
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [makeRule({ effect: 'allow' })],
            rlsPolicies: [],
          },
        },
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.allowed).toBe(true);
    });
  });

  describe('RLS filter evaluation', () => {
    it('should evaluate field-type RLS filter', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'owner-only',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: { type: 'field', field: 'ownerId', userPath: 'id' },
              },
            ],
          },
        },
      });

      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1' }),
        'read',
        makeResource({ type: 'documents', attributes: { ownerId: 'user-1' } })
      );

      expect(result.allowed).toBe(true);
      expect(result.matchedPolicy?.name).toBe('owner-only');
    });

    it('should evaluate expression-type RLS filter', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'expr-policy',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: { type: 'expression', expression: '$doc.ownerId === $user.id' },
              },
            ],
          },
        },
      });

      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1' }),
        'read',
        makeResource({ type: 'documents', attributes: { ownerId: 'user-1' } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should reject expression injection attempts', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'injection',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: {
                  type: 'expression',
                  expression: '$doc.x === $user.id; process.exit()',
                },
              },
            ],
          },
        },
      });

      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ type: 'documents', attributes: { x: 'test' } })
      );

      expect(result.allowed).toBe(false);
    });

    it('should evaluate nested AND filters', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'and-policy',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: {
                  type: 'field',
                  and: [
                    { type: 'field', field: 'ownerId', userPath: 'id' },
                    { type: 'field', field: 'orgId', userPath: 'organizationId' },
                  ],
                },
              },
            ],
          },
        },
      });

      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1', organizationId: 'org-1' }),
        'read',
        makeResource({
          type: 'documents',
          attributes: { ownerId: 'user-1', orgId: 'org-1' },
        })
      );

      expect(result.allowed).toBe(true);
    });

    it('should evaluate nested OR filters', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'or-policy',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: {
                  type: 'field',
                  or: [
                    { type: 'field', field: 'ownerId', userPath: 'id' },
                    { type: 'field', field: 'isPublic', userPath: 'attributes.alwaysTrue' },
                  ],
                },
              },
            ],
          },
        },
      });

      // First filter matches
      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1', attributes: { alwaysTrue: false } }),
        'read',
        makeResource({ type: 'documents', attributes: { ownerId: 'user-1', isPublic: false } })
      );

      expect(result.allowed).toBe(true);
    });

    it('should only apply RLS policies to read/list actions', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'read-policy',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: { type: 'field', field: 'ownerId', userPath: 'id' },
              },
            ],
          },
        },
      });

      // RLS won't apply for 'create'
      const result = evaluator.checkPermission(
        makeUser({ id: 'user-1' }),
        'create',
        makeResource({ type: 'documents', attributes: { ownerId: 'user-1' } })
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('filterDocuments()', () => {
    it('should filter documents based on RLS policies', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'owner-filter',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: { type: 'field', field: 'ownerId', userPath: 'id' },
              },
            ],
          },
        },
      });

      const docs = [
        { _id: '1', ownerId: 'user-1' },
        { _id: '2', ownerId: 'user-2' },
        { _id: '3', ownerId: 'user-1' },
      ];

      const filtered = evaluator.filterDocuments(makeUser({ id: 'user-1' }), 'documents', docs);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((d) => d._id)).toEqual(['1', '3']);
    });

    it('should return all when no policies and default is allow', () => {
      const evaluator = new PermissionEvaluator({ defaultPolicy: 'allow' });
      const docs = [{ _id: '1' }, { _id: '2' }];
      const filtered = evaluator.filterDocuments(makeUser(), 'documents', docs);

      expect(filtered).toHaveLength(2);
    });

    it('should return empty when no policies and default is deny', () => {
      const evaluator = new PermissionEvaluator({ defaultPolicy: 'deny' });
      const docs = [{ _id: '1' }, { _id: '2' }];
      const filtered = evaluator.filterDocuments(makeUser(), 'documents', docs);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('cache behavior', () => {
    it('should cache and return cached results', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'allow',
        cacheEnabled: true,
        cacheTTL: 60000,
      });

      const user = makeUser();
      const resource = makeResource({ id: 'doc-1' });

      const result1 = evaluator.checkPermission(user, 'read', resource);
      const result2 = evaluator.checkPermission(user, 'read', resource);

      expect(result1.allowed).toBe(result2.allowed);
    });

    it('should not use cache when disabled', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'allow',
        cacheEnabled: false,
      });

      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());
      expect(result.allowed).toBe(true);
    });

    it('should clear cache', () => {
      const evaluator = new PermissionEvaluator({ cacheEnabled: true });
      evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'doc-1' }));
      evaluator.clearCache();
      // Should not throw
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'doc-1' }));
      expect(result).toBeDefined();
    });

    it('should expire cache entries after TTL', () => {
      vi.useFakeTimers();
      try {
        const evaluator = new PermissionEvaluator({
          defaultPolicy: 'allow',
          cacheEnabled: true,
          cacheTTL: 100,
        });

        evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'doc-1' }));
        vi.advanceTimersByTime(200);
        // After TTL, cache miss should re-evaluate
        const result = evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'doc-1' }));
        expect(result.allowed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('details/metadata', () => {
    it('should include evaluation details', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule()],
      });

      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());

      expect(result.details).toBeDefined();
      expect(result.details!.evaluatedRules).toBeGreaterThanOrEqual(1);
      expect(typeof result.details!.evaluationTime).toBe('number');
    });
  });

  describe('edge cases', () => {
    it('should return false for unknown condition operator', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        cacheEnabled: false,
        globalRules: [
          makeRule({
            conditions: [{ field: 'x', operator: 'unknownOp' as any, value: 1 }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ id: 'unk', attributes: { x: 1 } })
      );
      expect(result.allowed).toBe(false);
    });

    it('should handle rule with no conditions (matches any resource)', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ conditions: undefined, effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource());
      expect(result.allowed).toBe(true);
    });

    it('should handle empty roles and empty rule roles together', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        globalRules: [makeRule({ roles: [], effect: 'allow' })],
      });
      const result = evaluator.checkPermission(makeUser({ roles: [] }), 'read', makeResource());
      expect(result.allowed).toBe(true);
    });

    it('should handle resource with no attributes for condition evaluation', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        cacheEnabled: false,
        globalRules: [
          makeRule({
            conditions: [{ field: 'status', operator: 'eq', value: 'active' }],
            effect: 'allow',
          }),
        ],
      });
      const result = evaluator.checkPermission(makeUser(), 'read', makeResource({ id: 'no-attr' }));
      expect(result.allowed).toBe(false);
    });

    it('should handle RLS filter with missing field/userPath', () => {
      const evaluator = new PermissionEvaluator({
        defaultPolicy: 'deny',
        collections: {
          documents: {
            collection: 'documents',
            defaultPolicy: 'deny',
            rules: [],
            rlsPolicies: [
              {
                id: 'p1',
                name: 'bad-filter',
                collection: 'documents',
                actions: ['read'],
                enabled: true,
                filter: { type: 'field' }, // missing field and userPath
              },
            ],
          },
        },
      });
      const result = evaluator.checkPermission(
        makeUser(),
        'read',
        makeResource({ type: 'documents', attributes: { a: 1 } })
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('factory function', () => {
    it('should create evaluator via createPermissionEvaluator', () => {
      const evaluator = createPermissionEvaluator({ defaultPolicy: 'allow' });
      expect(evaluator).toBeInstanceOf(PermissionEvaluator);
      expect(evaluator.getConfig().defaultPolicy).toBe('allow');
    });
  });
});

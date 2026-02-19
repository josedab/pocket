import { describe, it, expect } from 'vitest';
import { createPermissionEvaluator } from '../permission-evaluator.js';
import type { UserContext, Resource } from '../types.js';

describe('Permission Expression Evaluator (safe)', () => {
  const user: UserContext = {
    id: 'user-1',
    roles: ['editor'],
    attributes: { department: 'engineering', level: 5 },
  };

  function makeResource(attributes: Record<string, unknown>): Resource {
    return { type: 'documents', id: 'doc-1', attributes };
  }

  function makeEvaluator(expression: string) {
    return createPermissionEvaluator({
      defaultPolicy: 'deny',
      globalRules: [],
      cacheEnabled: false,
      collections: {
        documents: {
          rules: [],
          rlsPolicies: [
            {
              name: 'expr-test',
              collection: 'documents',
              actions: ['read'],
              filter: { type: 'expression', expression },
              enabled: true,
            },
          ],
        },
      },
    });
  }

  it('should evaluate $doc.field === $user.field', () => {
    const evaluator = makeEvaluator('$doc.ownerId === $user.id');
    const result = evaluator.checkPermission(user, 'read', makeResource({ ownerId: 'user-1' }));
    expect(result.allowed).toBe(true);
  });

  it('should reject mismatched values', () => {
    const evaluator = makeEvaluator('$doc.ownerId === $user.id');
    const result = evaluator.checkPermission(user, 'read', makeResource({ ownerId: 'other' }));
    expect(result.allowed).toBe(false);
  });

  it('should evaluate $doc.field !== value', () => {
    const evaluator = makeEvaluator("$doc.status !== 'deleted'");
    const result = evaluator.checkPermission(user, 'read', makeResource({ status: 'active' }));
    expect(result.allowed).toBe(true);
  });

  it('should evaluate numeric comparisons', () => {
    const evaluator = makeEvaluator('$doc.priority > 3');
    expect(
      evaluator.checkPermission(user, 'read', makeResource({ priority: 5 })).allowed
    ).toBe(true);
    expect(
      evaluator.checkPermission(user, 'read', makeResource({ priority: 2 })).allowed
    ).toBe(false);
  });

  it('should evaluate $user attribute comparisons', () => {
    const evaluator = makeEvaluator('$doc.minLevel <= $user.attributes.level');
    const result = evaluator.checkPermission(user, 'read', makeResource({ minLevel: 3 }));
    expect(result.allowed).toBe(true);
  });

  it('should reject expressions with parentheses (injection attempt)', () => {
    const evaluator = makeEvaluator('(function(){return true})()');
    const result = evaluator.checkPermission(user, 'read', makeResource({}));
    expect(result.allowed).toBe(false);
  });

  it('should reject expressions with semicolons (injection attempt)', () => {
    const evaluator = makeEvaluator('$doc.x; process.exit(1)');
    const result = evaluator.checkPermission(user, 'read', makeResource({ x: true }));
    expect(result.allowed).toBe(false);
  });

  it('should reject expressions with curly braces (injection attempt)', () => {
    const evaluator = makeEvaluator('$doc.x === true ? {a:1} : {b:2}');
    const result = evaluator.checkPermission(user, 'read', makeResource({ x: true }));
    expect(result.allowed).toBe(false);
  });

  it('should handle boolean literal comparison', () => {
    const evaluator = makeEvaluator('$doc.active === true');
    expect(
      evaluator.checkPermission(user, 'read', makeResource({ active: true })).allowed
    ).toBe(true);
    expect(
      evaluator.checkPermission(user, 'read', makeResource({ active: false })).allowed
    ).toBe(false);
  });

  it('should return false for empty expression', () => {
    const evaluator = makeEvaluator('');
    const result = evaluator.checkPermission(user, 'read', makeResource({}));
    expect(result.allowed).toBe(false);
  });

  it('should return false for expression without operator', () => {
    const evaluator = makeEvaluator('$doc.field');
    const result = evaluator.checkPermission(user, 'read', makeResource({ field: true }));
    expect(result.allowed).toBe(false);
  });
});

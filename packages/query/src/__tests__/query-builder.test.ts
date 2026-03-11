import { describe, expect, it } from 'vitest';
import { hashQuery, parseQuery, query, serializeQuery } from '../query-builder.js';
import type { FieldCondition, LogicalCondition } from '../types.js';

function isFieldCondition(c: unknown): c is FieldCondition {
  return typeof c === 'object' && c !== null && 'field' in c && !('conditions' in c);
}

function isLogicalCondition(c: unknown): c is LogicalCondition {
  return typeof c === 'object' && c !== null && 'conditions' in c;
}

describe('QueryBuilder', () => {
  describe('query() factory', () => {
    it('should create a builder with the specified collection', () => {
      const q = query('users').build();

      expect(q.collection).toBe('users');
    });

    it('should initialize with live=false', () => {
      const q = query('users').build();

      expect(q.live).toBe(false);
    });
  });

  describe('filter methods', () => {
    it('.eq() adds equality condition', () => {
      const q = query('users').eq('name', 'Alice').build();

      expect(q.where).toBeDefined();
      const w = q.where as FieldCondition;
      expect(w.field).toBe('name');
      expect(w.operator).toBe('eq');
      expect(w.value).toBe('Alice');
    });

    it('.neq() adds not-equal condition', () => {
      const q = query('users').neq('status', 'inactive').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('neq');
      expect(w.value).toBe('inactive');
    });

    it('.gt() adds greater-than condition', () => {
      const q = query('users').gt('age', 18).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('gt');
      expect(w.value).toBe(18);
    });

    it('.gte() adds greater-than-or-equal condition', () => {
      const q = query('users').gte('age', 21).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('gte');
      expect(w.value).toBe(21);
    });

    it('.lt() adds less-than condition', () => {
      const q = query('users').lt('age', 65).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('lt');
      expect(w.value).toBe(65);
    });

    it('.lte() adds less-than-or-equal condition', () => {
      const q = query('users').lte('score', 100).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('lte');
      expect(w.value).toBe(100);
    });

    it('.in() adds in-array condition', () => {
      const q = query('users').in('role', ['admin', 'editor']).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('in');
      expect(w.value).toEqual(['admin', 'editor']);
    });

    it('.notIn() adds not-in-array condition with nin operator', () => {
      const q = query('users').notIn('status', ['banned', 'suspended']).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('nin');
      expect(w.value).toEqual(['banned', 'suspended']);
    });

    it('.contains() adds string contains condition', () => {
      const q = query('posts').contains('title', 'hello').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('contains');
      expect(w.value).toBe('hello');
    });

    it('.startsWith() adds startsWith condition', () => {
      const q = query('posts').startsWith('title', 'Hello').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('startsWith');
      expect(w.value).toBe('Hello');
    });

    it('.endsWith() adds endsWith condition', () => {
      const q = query('posts').endsWith('email', '@example.com').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('endsWith');
      expect(w.value).toBe('@example.com');
    });

    it('.regex() handles string pattern', () => {
      const q = query('users').regex('name', '^A.*z$').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('regex');
      expect(w.value).toBe('^A.*z$');
    });

    it('.regex() handles RegExp pattern', () => {
      const q = query('users')
        .regex('name', /^A.*z$/i)
        .build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('regex');
      expect(w.value).toBe('^A.*z$');
    });

    it('.between() creates range condition with array value', () => {
      const q = query('users').between('age', 18, 65).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('between');
      expect(w.value).toEqual([18, 65]);
    });

    it('.exists() defaults to true', () => {
      const q = query('users').exists('email').build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('exists');
      expect(w.value).toBe(true);
    });

    it('.exists(field, false) checks for non-existence', () => {
      const q = query('users').exists('deletedAt', false).build();

      const w = q.where as FieldCondition;
      expect(w.operator).toBe('exists');
      expect(w.value).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('multiple .where() calls create AND combination', () => {
      const q = query('users').eq('name', 'Alice').eq('age', 30).build();

      expect(isLogicalCondition(q.where)).toBe(true);
      const w = q.where as LogicalCondition;
      expect(w.operator).toBe('and');
      expect(w.conditions).toHaveLength(2);
    });

    it('.or() creates OR combination', () => {
      const q = query('users')
        .eq('name', 'Alice')
        .or((sub) => sub.eq('name', 'Bob'))
        .build();

      expect(isLogicalCondition(q.where)).toBe(true);
      const w = q.where as LogicalCondition;
      expect(w.operator).toBe('or');
      expect(w.conditions).toHaveLength(2);
    });

    it('.not() creates NOT condition', () => {
      const q = query('users')
        .not((sub) => sub.eq('status', 'banned'))
        .build();

      expect(isLogicalCondition(q.where)).toBe(true);
      const w = q.where as LogicalCondition;
      expect(w.operator).toBe('not');
      expect(w.conditions).toHaveLength(1);
    });

    it('.not() combined with existing condition creates AND wrapper', () => {
      const q = query('users')
        .eq('role', 'user')
        .not((sub) => sub.eq('status', 'banned'))
        .build();

      expect(isLogicalCondition(q.where)).toBe(true);
      const w = q.where as LogicalCondition;
      expect(w.operator).toBe('and');
      expect(w.conditions).toHaveLength(2);
      const notCond = w.conditions[1] as LogicalCondition;
      expect(notCond.operator).toBe('not');
    });

    it('.and() with existing AND appends to conditions', () => {
      const q = query('users')
        .eq('name', 'Alice')
        .and((sub) => sub.gt('age', 18))
        .build();

      const w = q.where as LogicalCondition;
      expect(w.operator).toBe('and');
      expect(w.conditions).toHaveLength(2);
    });
  });

  describe('sorting', () => {
    it('.orderBy() adds sort with default asc direction', () => {
      const q = query('users').orderBy('name').build();

      expect(q.orderBy).toHaveLength(1);
      expect(q.orderBy![0].field).toBe('name');
      expect(q.orderBy![0].direction).toBe('asc');
    });

    it('.orderBy() with desc direction', () => {
      const q = query('users').orderBy('createdAt', 'desc').build();

      expect(q.orderBy![0].direction).toBe('desc');
    });

    it('.asc() adds ascending sort', () => {
      const q = query('users').asc('name').build();

      expect(q.orderBy![0].field).toBe('name');
      expect(q.orderBy![0].direction).toBe('asc');
    });

    it('.desc() adds descending sort', () => {
      const q = query('users').desc('createdAt').build();

      expect(q.orderBy![0].field).toBe('createdAt');
      expect(q.orderBy![0].direction).toBe('desc');
    });

    it('multiple sort specs are accumulated', () => {
      const q = query('users').asc('name').desc('createdAt').build();

      expect(q.orderBy).toHaveLength(2);
      expect(q.orderBy![0].field).toBe('name');
      expect(q.orderBy![1].field).toBe('createdAt');
    });
  });

  describe('pagination', () => {
    it('.limit() sets pagination limit', () => {
      const q = query('users').limit(10).build();

      expect(q.pagination?.limit).toBe(10);
    });

    it('.offset() sets pagination offset', () => {
      const q = query('users').offset(20).build();

      expect(q.pagination?.offset).toBe(20);
    });

    it('.cursor() sets cursor value', () => {
      const q = query('users').cursor('abc123').build();

      expect(q.pagination?.cursor).toBe('abc123');
    });

    it('.paginate(page, pageSize) calculates correct offset and limit', () => {
      const q = query('users').paginate(3, 10).build();

      expect(q.pagination?.offset).toBe(20);
      expect(q.pagination?.limit).toBe(10);
    });

    it('.paginate(1, pageSize) sets offset to 0', () => {
      const q = query('users').paginate(1, 25).build();

      expect(q.pagination?.offset).toBe(0);
      expect(q.pagination?.limit).toBe(25);
    });
  });

  describe('projection', () => {
    it('.select() adds include fields', () => {
      const q = query('users').select('name', 'email').build();

      expect(q.select?.include).toEqual(['name', 'email']);
    });

    it('.exclude() adds exclude fields', () => {
      const q = query('users').exclude('password', 'secret').build();

      expect(q.select?.exclude).toEqual(['password', 'secret']);
    });
  });

  describe('aggregations', () => {
    it('.aggregate() adds raw aggregation spec', () => {
      const q = query('users').aggregate('count', undefined, 'total').build();

      expect(q.aggregate).toHaveLength(1);
      expect(q.aggregate![0].type).toBe('count');
      expect(q.aggregate![0].alias).toBe('total');
    });

    it('.count() adds count aggregation with default alias', () => {
      const q = query('users').count().build();

      expect(q.aggregate![0].type).toBe('count');
      expect(q.aggregate![0].alias).toBe('count');
    });

    it('.count() accepts custom alias', () => {
      const q = query('users').count('userCount').build();

      expect(q.aggregate![0].alias).toBe('userCount');
    });

    it('.sum() adds sum aggregation', () => {
      const q = query('orders').sum('total').build();

      expect(q.aggregate![0].type).toBe('sum');
      expect(q.aggregate![0].field).toBe('total');
      expect(q.aggregate![0].alias).toBe('sum_total');
    });

    it('.avg() adds average aggregation', () => {
      const q = query('orders').avg('amount').build();

      expect(q.aggregate![0].type).toBe('avg');
      expect(q.aggregate![0].field).toBe('amount');
      expect(q.aggregate![0].alias).toBe('avg_amount');
    });

    it('.min() adds min aggregation', () => {
      const q = query('orders').min('price').build();

      expect(q.aggregate![0].type).toBe('min');
      expect(q.aggregate![0].field).toBe('price');
      expect(q.aggregate![0].alias).toBe('min_price');
    });

    it('.max() adds max aggregation', () => {
      const q = query('orders').max('price').build();

      expect(q.aggregate![0].type).toBe('max');
      expect(q.aggregate![0].field).toBe('price');
      expect(q.aggregate![0].alias).toBe('max_price');
    });

    it('.sum() with custom alias', () => {
      const q = query('orders').sum('total', 'grandTotal').build();

      expect(q.aggregate![0].alias).toBe('grandTotal');
    });

    it('.groupBy() adds group aggregation', () => {
      const q = query('orders').groupBy('category', 'status').build();

      expect(q.aggregate![0].type).toBe('group');
      expect(q.aggregate![0].groupBy).toEqual(['category', 'status']);
    });

    it('.distinct() adds distinct aggregation', () => {
      const q = query('users').distinct('country').build();

      expect(q.aggregate![0].type).toBe('distinct');
      expect(q.aggregate![0].field).toBe('country');
      expect(q.aggregate![0].alias).toBe('distinct_country');
    });
  });

  describe('computed fields', () => {
    it('.computed() adds a computed field spec', () => {
      const q = query('orders')
        .computed('fullName', 'firstName + " " + lastName', ['firstName', 'lastName'])
        .build();

      expect(q.computed).toHaveLength(1);
      expect(q.computed![0].name).toBe('fullName');
      expect(q.computed![0].expression).toBe('firstName + " " + lastName');
      expect(q.computed![0].dependencies).toEqual(['firstName', 'lastName']);
    });
  });

  describe('joins', () => {
    it('.join() adds a join spec', () => {
      const q = query('orders').join('users', 'userId', '_id', 'user').build();

      expect(q.join).toHaveLength(1);
      expect(q.join![0].collection).toBe('users');
      expect(q.join![0].localField).toBe('userId');
      expect(q.join![0].foreignField).toBe('_id');
      expect(q.join![0].as).toBe('user');
    });

    it('.join() with sub-query where clause', () => {
      const q = query('orders')
        .join('users', 'userId', '_id', 'activeUser', (sub) => sub.eq('active', true))
        .build();

      expect(q.join![0].where).toBeDefined();
      const joinWhere = q.join![0].where as FieldCondition;
      expect(joinWhere.field).toBe('active');
      expect(joinWhere.operator).toBe('eq');
      expect(joinWhere.value).toBe(true);
    });

    it('multiple joins are accumulated', () => {
      const q = query('orders')
        .join('users', 'userId', '_id', 'user')
        .join('products', 'productId', '_id', 'product')
        .build();

      expect(q.join).toHaveLength(2);
    });
  });

  describe('live mode', () => {
    it('.live() enables live mode', () => {
      const q = query('users').live().build();

      expect(q.live).toBe(true);
    });

    it('.live(false) disables live mode', () => {
      const q = query('users').live(true).live(false).build();

      expect(q.live).toBe(false);
    });
  });

  describe('.build()', () => {
    it('returns a shallow copy of the query definition', () => {
      const builder = query('users').eq('name', 'Alice');
      const q1 = builder.build();
      const q2 = builder.build();

      expect(q1).toEqual(q2);
      expect(q1).not.toBe(q2);
    });

    it('returns correct collection', () => {
      const q = query('posts').build();

      expect(q.collection).toBe('posts');
    });
  });

  describe('.clone()', () => {
    it('creates an independent copy', () => {
      const original = query('users').eq('name', 'Alice').limit(10);
      const cloned = original.clone();

      cloned.eq('age', 30);

      const originalDef = original.build();
      const clonedDef = cloned.build();

      expect(originalDef.collection).toBe('users');
      expect(clonedDef.collection).toBe('users');

      // Original should still have a single condition (not AND)
      expect(isFieldCondition(originalDef.where)).toBe(true);
      // Cloned should have two conditions merged via AND
      expect(isLogicalCondition(clonedDef.where)).toBe(true);
    });

    it('cloned builder maintains pagination from original', () => {
      const original = query('users').limit(10).offset(5);
      const cloned = original.clone();
      const clonedDef = cloned.build();

      expect(clonedDef.pagination?.limit).toBe(10);
      expect(clonedDef.pagination?.offset).toBe(5);
    });
  });

  describe('chaining', () => {
    it('supports full fluent chain', () => {
      const q = query('users')
        .eq('status', 'active')
        .gt('age', 18)
        .orderBy('name')
        .desc('createdAt')
        .limit(20)
        .offset(40)
        .select('name', 'email')
        .count('total')
        .live()
        .build();

      expect(q.collection).toBe('users');
      expect(q.where).toBeDefined();
      expect(q.orderBy).toHaveLength(2);
      expect(q.pagination?.limit).toBe(20);
      expect(q.pagination?.offset).toBe(40);
      expect(q.select?.include).toEqual(['name', 'email']);
      expect(q.aggregate).toHaveLength(1);
      expect(q.live).toBe(true);
    });
  });

  describe('parseQuery()', () => {
    it('parses a JSON string into a QueryDefinition', () => {
      const json = JSON.stringify({ collection: 'users', live: false });
      const def = parseQuery(json);

      expect(def.collection).toBe('users');
    });

    it('parses an object directly', () => {
      const def = parseQuery({ collection: 'posts', live: true });

      expect(def.collection).toBe('posts');
      expect(def.live).toBe(true);
    });
  });

  describe('serializeQuery()', () => {
    it('serializes a QueryDefinition to a JSON string', () => {
      const def = query('users').eq('name', 'Alice').build();
      const json = serializeQuery(def);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.collection).toBe('users');
    });
  });

  describe('parseQuery / serializeQuery roundtrip', () => {
    it('roundtrips a complex query', () => {
      const original = query('users')
        .eq('name', 'Alice')
        .gt('age', 18)
        .orderBy('name')
        .limit(10)
        .build();

      const serialized = serializeQuery(original);
      const restored = parseQuery(serialized);

      expect(restored).toEqual(original);
    });
  });

  describe('hashQuery()', () => {
    it('produces consistent hash for same query', () => {
      const def = query('users').eq('name', 'Alice').build();

      const hash1 = hashQuery(def);
      const hash2 = hashQuery(def);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different queries', () => {
      const def1 = query('users').eq('name', 'Alice').build();
      const def2 = query('users').eq('name', 'Bob').build();

      expect(hashQuery(def1)).not.toBe(hashQuery(def2));
    });

    it('hash starts with q_ prefix', () => {
      const def = query('users').build();
      const hash = hashQuery(def);

      expect(hash.startsWith('q_')).toBe(true);
    });
  });
});

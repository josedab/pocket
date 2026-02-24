import { describe, expect, it } from 'vitest';
import { SQLiteQueryBridge } from '../sqlite-query-bridge.js';

describe('SQLiteQueryBridge', () => {
  const bridge = new SQLiteQueryBridge();

  it('should generate CREATE TABLE', () => {
    const sql = bridge.toCreateTable('users');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('"users"');
    expect(sql).toContain('_id TEXT PRIMARY KEY');
    expect(sql).toContain('_data JSON');
  });

  it('should generate SELECT with equality filter', () => {
    const q = bridge.toSQL('users', { active: true });
    expect(q.sql).toContain('SELECT _id, _data FROM "users"');
    expect(q.sql).toContain('WHERE');
    expect(q.sql).toContain("json_extract(_data, '$.active')");
    expect(q.params).toEqual([true]);
  });

  it('should generate SELECT with operator filters', () => {
    const q = bridge.toSQL('users', { age: { $gte: 18, $lt: 65 } });
    expect(q.sql).toContain('>= ?');
    expect(q.sql).toContain('< ?');
    expect(q.params).toContain(18);
    expect(q.params).toContain(65);
  });

  it('should generate ORDER BY', () => {
    const q = bridge.toSQL('users', undefined, { age: 'desc', name: 'asc' });
    expect(q.sql).toContain('ORDER BY');
    expect(q.sql).toContain('DESC');
    expect(q.sql).toContain('ASC');
  });

  it('should generate LIMIT and OFFSET', () => {
    const q = bridge.toSQL('users', undefined, undefined, 10, 20);
    expect(q.sql).toContain('LIMIT ?');
    expect(q.sql).toContain('OFFSET ?');
    expect(q.params).toContain(10);
    expect(q.params).toContain(20);
  });

  it('should generate INSERT OR REPLACE', () => {
    const q = bridge.toInsert('users', { _id: 'u1', name: 'Alice' });
    expect(q.sql).toContain('INSERT OR REPLACE');
    expect(q.params[0]).toBe('u1');
    expect(q.params[1]).toContain('Alice');
  });

  it('should generate DELETE', () => {
    const q = bridge.toDelete('users', 'u1');
    expect(q.sql).toContain('DELETE FROM "users" WHERE _id = ?');
    expect(q.params).toEqual(['u1']);
  });

  it('should generate COUNT', () => {
    const q = bridge.toCount('users', { active: true });
    expect(q.sql).toContain('COUNT(*)');
    expect(q.sql).toContain('WHERE');
  });

  it('should handle $in operator', () => {
    const q = bridge.toSQL('users', { role: { $in: ['admin', 'editor'] } });
    expect(q.sql).toContain('IN (?,?)');
    expect(q.params).toContain('admin');
    expect(q.params).toContain('editor');
  });

  it('should handle $contains (LIKE)', () => {
    const q = bridge.toSQL('users', { name: { $contains: 'Ali' } });
    expect(q.sql).toContain('LIKE ?');
    expect(q.params).toContain('%Ali%');
  });

  it('should handle $and and $or', () => {
    const q = bridge.toSQL('users', {
      $and: [{ active: true }, { age: { $gte: 18 } }],
    });
    expect(q.sql).toContain('AND');
  });

  it('should support table prefix', () => {
    const prefixed = new SQLiteQueryBridge({ tablePrefix: 'pocket_' });
    const sql = prefixed.toCreateTable('users');
    expect(sql).toContain('"pocket_users"');
  });
});

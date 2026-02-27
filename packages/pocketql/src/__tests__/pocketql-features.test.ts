import { describe, expect, it } from 'vitest';

import type { CollectionQueryFn, ExecutionBridge } from '../execution-bridge.js';
import { createExecutionBridge } from '../execution-bridge.js';
import { parsePQL } from '../parser.js';

// ─── Parser Tests ───────────────────────────────────────────────────────────

describe('PQL Parser', () => {
  describe('simple SELECT', () => {
    it('should parse SELECT * FROM collection', () => {
      const result = parsePQL('SELECT * FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.type).toBe('select');
      expect(result.query!.columns).toHaveLength(1);
      expect(result.query!.columns[0].type).toBe('star');
      expect(result.query!.from.collection).toBe('users');
    });

    it('should parse SELECT with specific columns', () => {
      const result = parsePQL('SELECT name, email FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns).toHaveLength(2);
      expect(result.query!.columns[0].name).toBe('name');
      expect(result.query!.columns[1].name).toBe('email');
    });

    it('should parse dotted column names', () => {
      const result = parsePQL('SELECT u.name, u.email FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns[0].name).toBe('u.name');
      expect(result.query!.columns[1].name).toBe('u.email');
    });
  });

  describe('WHERE conditions', () => {
    it('should parse simple equality', () => {
      const result = parsePQL("SELECT * FROM users WHERE role = 'admin'");
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.type).toBe('condition');
      expect(where.operator).toBe('=');
      expect((where.left as { name: string }).name).toBe('role');
      expect((where.right as { value: string }).value).toBe('admin');
    });

    it('should parse numeric comparison', () => {
      const result = parsePQL('SELECT * FROM users WHERE age > 30');
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.operator).toBe('>');
      expect((where.right as { value: number }).value).toBe(30);
    });

    it('should parse !=, <=, >= operators', () => {
      let r = parsePQL("SELECT * FROM users WHERE role != 'admin'");
      expect(r.success).toBe(true);
      expect(r.query!.where!.operator).toBe('!=');

      r = parsePQL('SELECT * FROM users WHERE age <= 30');
      expect(r.success).toBe(true);
      expect(r.query!.where!.operator).toBe('<=');

      r = parsePQL('SELECT * FROM users WHERE age >= 18');
      expect(r.success).toBe(true);
      expect(r.query!.where!.operator).toBe('>=');
    });
  });

  describe('AND/OR operators', () => {
    it('should parse AND conditions', () => {
      const result = parsePQL("SELECT * FROM users WHERE role = 'admin' AND age > 25");
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.type).toBe('binary_op');
      expect(where.logicalOp).toBe('AND');
      expect(where.conditions).toHaveLength(2);
    });

    it('should parse OR conditions', () => {
      const result = parsePQL("SELECT * FROM users WHERE role = 'admin' OR role = 'superadmin'");
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.logicalOp).toBe('OR');
      expect(where.conditions).toHaveLength(2);
    });
  });

  describe('IN operator', () => {
    it('should parse IN with string values', () => {
      const result = parsePQL("SELECT * FROM users WHERE role IN ('admin', 'superadmin')");
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.operator).toBe('IN');
      expect((where.right as { values: { value: string }[] }).values).toHaveLength(2);
    });

    it('should parse IN with numeric values', () => {
      const result = parsePQL('SELECT * FROM users WHERE age IN (25, 30, 35)');
      expect(result.success).toBe(true);
      expect(result.query!.where!.operator).toBe('IN');
    });
  });

  describe('LIKE operator', () => {
    it('should parse LIKE condition', () => {
      const result = parsePQL("SELECT * FROM users WHERE name LIKE '%alice%'");
      expect(result.success).toBe(true);
      const where = result.query!.where!;
      expect(where.operator).toBe('LIKE');
      expect((where.right as { value: string }).value).toBe('%alice%');
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('should parse IS NULL', () => {
      const result = parsePQL('SELECT * FROM users WHERE email IS NULL');
      expect(result.success).toBe(true);
      expect(result.query!.where!.operator).toBe('IS NULL');
    });

    it('should parse IS NOT NULL', () => {
      const result = parsePQL('SELECT * FROM users WHERE email IS NOT NULL');
      expect(result.success).toBe(true);
      expect(result.query!.where!.operator).toBe('IS NOT NULL');
    });
  });

  describe('JOINs', () => {
    it('should parse INNER JOIN', () => {
      const result = parsePQL(
        'SELECT * FROM users JOIN departments ON departmentId = departments.id'
      );
      expect(result.success).toBe(true);
      expect(result.query!.joins).toHaveLength(1);
      expect(result.query!.joins[0].joinType).toBe('INNER');
      expect(result.query!.joins[0].collection).toBe('departments');
    });

    it('should parse LEFT JOIN', () => {
      const result = parsePQL(
        'SELECT * FROM users LEFT JOIN departments ON departmentId = departments.id'
      );
      expect(result.success).toBe(true);
      expect(result.query!.joins[0].joinType).toBe('LEFT');
    });

    it('should parse JOIN with alias', () => {
      const result = parsePQL('SELECT * FROM users JOIN departments AS d ON departmentId = d.id');
      expect(result.success).toBe(true);
      expect(result.query!.joins[0].alias).toBe('d');
    });

    it('should parse explicit INNER JOIN', () => {
      const result = parsePQL(
        'SELECT * FROM users INNER JOIN departments ON departmentId = departments.id'
      );
      expect(result.success).toBe(true);
      expect(result.query!.joins[0].joinType).toBe('INNER');
    });
  });

  describe('GROUP BY', () => {
    it('should parse GROUP BY single field', () => {
      const result = parsePQL('SELECT role, COUNT(*) FROM users GROUP BY role');
      expect(result.success).toBe(true);
      expect(result.query!.groupBy).toEqual(['role']);
    });

    it('should parse GROUP BY multiple fields', () => {
      const result = parsePQL(
        'SELECT role, department, COUNT(*) FROM users GROUP BY role, department'
      );
      expect(result.success).toBe(true);
      expect(result.query!.groupBy).toEqual(['role', 'department']);
    });
  });

  describe('ORDER BY', () => {
    it('should parse ORDER BY ASC (default)', () => {
      const result = parsePQL('SELECT * FROM users ORDER BY name');
      expect(result.success).toBe(true);
      expect(result.query!.orderBy).toHaveLength(1);
      expect(result.query!.orderBy[0].field).toBe('name');
      expect(result.query!.orderBy[0].direction).toBe('ASC');
    });

    it('should parse ORDER BY DESC', () => {
      const result = parsePQL('SELECT * FROM users ORDER BY age DESC');
      expect(result.success).toBe(true);
      expect(result.query!.orderBy[0].direction).toBe('DESC');
    });

    it('should parse ORDER BY multiple fields', () => {
      const result = parsePQL('SELECT * FROM users ORDER BY role ASC, age DESC');
      expect(result.success).toBe(true);
      expect(result.query!.orderBy).toHaveLength(2);
      expect(result.query!.orderBy[0]).toMatchObject({ field: 'role', direction: 'ASC' });
      expect(result.query!.orderBy[1]).toMatchObject({ field: 'age', direction: 'DESC' });
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('should parse LIMIT', () => {
      const result = parsePQL('SELECT * FROM users LIMIT 10');
      expect(result.success).toBe(true);
      expect(result.query!.limit).toBe(10);
    });

    it('should parse OFFSET', () => {
      const result = parsePQL('SELECT * FROM users LIMIT 10 OFFSET 20');
      expect(result.success).toBe(true);
      expect(result.query!.limit).toBe(10);
      expect(result.query!.offset).toBe(20);
    });
  });

  describe('aggregate functions', () => {
    it('should parse COUNT(*)', () => {
      const result = parsePQL('SELECT COUNT(*) FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns).toHaveLength(1);
      expect(result.query!.columns[0].type).toBe('aggregate');
      expect(result.query!.columns[0].func).toBe('COUNT');
      expect(result.query!.columns[0].name).toBe('*');
    });

    it('should parse SUM, AVG, MIN, MAX', () => {
      const result = parsePQL('SELECT SUM(age), AVG(age), MIN(age), MAX(age) FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns).toHaveLength(4);
      expect(result.query!.columns[0].func).toBe('SUM');
      expect(result.query!.columns[1].func).toBe('AVG');
      expect(result.query!.columns[2].func).toBe('MIN');
      expect(result.query!.columns[3].func).toBe('MAX');
    });

    it('should parse aggregate with alias', () => {
      const result = parsePQL('SELECT COUNT(*) AS total FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns[0].alias).toBe('total');
    });
  });

  describe('aliases', () => {
    it('should parse AS alias on column', () => {
      const result = parsePQL('SELECT name AS username FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns[0].name).toBe('name');
      expect(result.query!.columns[0].alias).toBe('username');
    });

    it('should parse implicit alias on column', () => {
      const result = parsePQL('SELECT name username FROM users');
      expect(result.success).toBe(true);
      expect(result.query!.columns[0].name).toBe('name');
      expect(result.query!.columns[0].alias).toBe('username');
    });

    it('should parse AS alias on FROM', () => {
      const result = parsePQL('SELECT * FROM users AS u');
      expect(result.success).toBe(true);
      expect(result.query!.from.collection).toBe('users');
      expect(result.query!.from.alias).toBe('u');
    });
  });

  describe('error handling', () => {
    it('should return error for empty query', () => {
      const result = parsePQL('');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Expected SELECT');
    });

    it('should return error for missing FROM', () => {
      const result = parsePQL('SELECT *');
      expect(result.success).toBe(false);
      expect(result.error!.message).toContain('Expected FROM');
    });

    it('should return error for invalid token', () => {
      const result = parsePQL('SELECT * FROM users WHERE');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include position info in errors', () => {
      const result = parsePQL('INVALID QUERY');
      expect(result.success).toBe(false);
      expect(result.error!.position).toBeDefined();
      expect(result.error!.line).toBeDefined();
      expect(result.error!.column).toBeDefined();
    });
  });

  describe('complex queries', () => {
    it('should parse a full query with multiple clauses', () => {
      const result = parsePQL(
        "SELECT name, COUNT(*) AS total FROM users LEFT JOIN departments ON departmentId = departments.id WHERE age > 18 AND role = 'admin' GROUP BY role HAVING total > 1 ORDER BY name ASC LIMIT 10 OFFSET 5"
      );
      expect(result.success).toBe(true);
      const q = result.query!;
      expect(q.columns).toHaveLength(2);
      expect(q.from.collection).toBe('users');
      expect(q.joins).toHaveLength(1);
      expect(q.where).toBeDefined();
      expect(q.groupBy).toEqual(['role']);
      expect(q.having).toBeDefined();
      expect(q.orderBy).toHaveLength(1);
      expect(q.limit).toBe(10);
      expect(q.offset).toBe(5);
    });
  });
});

// ─── ExecutionBridge Tests ──────────────────────────────────────────────────

describe('ExecutionBridge', () => {
  const mockData: Record<string, Record<string, unknown>[]> = {
    users: [
      { id: '1', name: 'Alice', age: 30, role: 'admin', departmentId: 'd1' },
      { id: '2', name: 'Bob', age: 25, role: 'user', departmentId: 'd1' },
      { id: '3', name: 'Charlie', age: 35, role: 'admin', departmentId: 'd2' },
      { id: '4', name: 'Diana', age: 28, role: 'user', departmentId: 'd2' },
      { id: '5', name: 'Eve', age: 22, role: 'user', departmentId: 'd1' },
    ],
    departments: [
      { id: 'd1', name: 'Engineering', budget: 100000 },
      { id: 'd2', name: 'Marketing', budget: 50000 },
    ],
  };

  const mockQueryFn: CollectionQueryFn = async (collection, options) => {
    let rows = [...(mockData[collection] ?? [])];

    if (options?.filter) {
      rows = rows.filter((row) => {
        for (const [key, val] of Object.entries(options.filter!)) {
          if (typeof val === 'object' && val !== null) {
            const op = val as Record<string, unknown>;
            if ('$gt' in op && !((row[key] as number) > (op.$gt as number))) return false;
            if ('$lt' in op && !((row[key] as number) < (op.$lt as number))) return false;
            if ('$gte' in op && !((row[key] as number) >= (op.$gte as number))) return false;
            if ('$lte' in op && !((row[key] as number) <= (op.$lte as number))) return false;
            if ('$ne' in op && row[key] === op.$ne) return false;
            if ('$in' in op && !(op.$in as unknown[]).includes(row[key])) return false;
          } else {
            if (row[key] !== val) return false;
          }
        }
        return true;
      });
    }

    if (options?.sort) {
      rows.sort((a, b) => {
        for (const [field, dir] of Object.entries(options.sort!)) {
          const av = a[field] as number;
          const bv = b[field] as number;
          if (av < bv) return dir === 1 ? -1 : 1;
          if (av > bv) return dir === 1 ? 1 : -1;
        }
        return 0;
      });
    }

    if (options?.offset) rows = rows.slice(options.offset);
    if (options?.limit) rows = rows.slice(0, options.limit);

    return rows;
  };

  let bridge: ExecutionBridge;

  beforeEach(() => {
    bridge = createExecutionBridge(mockQueryFn);
  });

  describe('compile', () => {
    it('should compile a simple SELECT to an execution plan', () => {
      const result = parsePQL('SELECT * FROM users');
      const plan = bridge.compile(result.query!);

      expect(plan.collection).toBe('users');
      expect(plan.filter).toEqual({});
      expect(plan.projection).toEqual([]);
      expect(plan.aggregations).toEqual([]);
      expect(plan.joins).toEqual([]);
    });

    it('should compile WHERE to filter', () => {
      const result = parsePQL("SELECT * FROM users WHERE role = 'admin'");
      const plan = bridge.compile(result.query!);

      expect(plan.filter).toEqual({ role: 'admin' });
    });

    it('should compile multiple comparison operators', () => {
      const result = parsePQL('SELECT * FROM users WHERE age > 25');
      const plan = bridge.compile(result.query!);
      expect(plan.filter).toEqual({ age: { $gt: 25 } });
    });

    it('should compile ORDER BY to sort', () => {
      const result = parsePQL('SELECT * FROM users ORDER BY age DESC');
      const plan = bridge.compile(result.query!);

      expect(plan.sort).toEqual({ age: -1 });
    });

    it('should compile LIMIT and OFFSET', () => {
      const result = parsePQL('SELECT * FROM users LIMIT 10 OFFSET 5');
      const plan = bridge.compile(result.query!);

      expect(plan.limit).toBe(10);
      expect(plan.offset).toBe(5);
    });

    it('should compile projection from column list', () => {
      const result = parsePQL('SELECT name, age FROM users');
      const plan = bridge.compile(result.query!);

      expect(plan.projection).toEqual(['name', 'age']);
    });

    it('should compile aggregations', () => {
      const result = parsePQL('SELECT COUNT(*) AS total, AVG(age) AS avg_age FROM users');
      const plan = bridge.compile(result.query!);

      expect(plan.aggregations).toHaveLength(2);
      expect(plan.aggregations[0]).toEqual({ field: '*', op: 'COUNT', alias: 'total' });
      expect(plan.aggregations[1]).toEqual({ field: 'age', op: 'AVG', alias: 'avg_age' });
    });

    it('should compile JOIN clauses', () => {
      const result = parsePQL(
        'SELECT * FROM users LEFT JOIN departments ON departmentId = departments.id'
      );
      const plan = bridge.compile(result.query!);

      expect(plan.joins).toHaveLength(1);
      expect(plan.joins[0].collection).toBe('departments');
      expect(plan.joins[0].type).toBe('LEFT');
      expect(plan.joins[0].localField).toBe('departmentId');
      expect(plan.joins[0].foreignField).toBe('departments.id');
    });
  });

  describe('execute', () => {
    it('should execute SELECT * FROM users', async () => {
      const result = parsePQL('SELECT * FROM users');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(5);
      expect(execResult.metadata.collection).toBe('users');
      expect(execResult.metadata.rowCount).toBe(5);
    });

    it('should execute with WHERE filter', async () => {
      const result = parsePQL("SELECT * FROM users WHERE role = 'admin'");
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(2);
      expect(execResult.data.every((r) => r.role === 'admin')).toBe(true);
    });

    it('should execute with ORDER BY', async () => {
      const result = parsePQL('SELECT * FROM users ORDER BY age ASC');
      const execResult = await bridge.execute(result.query!);

      expect((execResult.data[0] as { name: string }).name).toBe('Eve');
      expect((execResult.data[4] as { name: string }).name).toBe('Charlie');
    });

    it('should execute with LIMIT and OFFSET', async () => {
      const result = parsePQL('SELECT * FROM users ORDER BY age ASC LIMIT 2 OFFSET 1');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(2);
    });

    it('should execute with projection', async () => {
      const result = parsePQL('SELECT name, age FROM users LIMIT 1');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(1);
      const row = execResult.data[0] as Record<string, unknown>;
      expect(row.name).toBeDefined();
      expect(row.age).toBeDefined();
    });

    it('should include execution metadata', async () => {
      const result = parsePQL('SELECT * FROM users');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.metadata.executionMs).toBeGreaterThanOrEqual(0);
      expect(execResult.metadata.plan).toBeDefined();
      expect(execResult.metadata.plan.collection).toBe('users');
    });
  });

  describe('aggregations', () => {
    it('should compute COUNT(*)', async () => {
      const result = parsePQL('SELECT COUNT(*) AS total FROM users');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(1);
      expect((execResult.data[0] as { total: number }).total).toBe(5);
    });

    it('should compute SUM', async () => {
      const result = parsePQL('SELECT SUM(age) AS total_age FROM users');
      const execResult = await bridge.execute(result.query!);

      expect((execResult.data[0] as { total_age: number }).total_age).toBe(140);
    });

    it('should compute AVG', async () => {
      const result = parsePQL('SELECT AVG(age) AS avg_age FROM users');
      const execResult = await bridge.execute(result.query!);

      expect((execResult.data[0] as { avg_age: number }).avg_age).toBe(28);
    });

    it('should compute MIN and MAX', async () => {
      const result = parsePQL('SELECT MIN(age) AS min_age, MAX(age) AS max_age FROM users');
      const execResult = await bridge.execute(result.query!);

      expect((execResult.data[0] as { min_age: number }).min_age).toBe(22);
      expect((execResult.data[0] as { max_age: number }).max_age).toBe(35);
    });

    it('should compute aggregations with GROUP BY', async () => {
      const result = parsePQL('SELECT COUNT(*) AS cnt FROM users GROUP BY role');
      const execResult = await bridge.execute(result.query!);

      expect(execResult.data).toHaveLength(2);
      const rows = execResult.data as { role: string; cnt: number }[];
      const adminRow = rows.find((r) => r.role === 'admin');
      const userRow = rows.find((r) => r.role === 'user');
      expect(adminRow!.cnt).toBe(2);
      expect(userRow!.cnt).toBe(3);
    });
  });
});

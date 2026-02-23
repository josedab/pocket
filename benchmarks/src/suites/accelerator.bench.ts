/**
 * QueryAccelerator benchmarks — compares accelerated vs standard operations
 *
 * Uses module-level top-level await for initialization because
 * vitest bench does not reliably execute beforeAll/beforeEach hooks.
 */

import { QueryAccelerator } from '@pocket/core';
import { bench, describe } from 'vitest';

interface TestDoc {
  _id: string;
  name: string;
  email: string;
  age: number;
  department: string;
  active: boolean;
  salary: number;
}

function generateDocs(count: number): TestDoc[] {
  const departments = ['engineering', 'sales', 'marketing', 'hr', 'finance'];
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${i}`,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
    department: departments[i % departments.length]!,
    active: i % 3 !== 0,
    salary: 40000 + (i % 80) * 1000,
  }));
}

// Module-level initialization
const docs1K = generateDocs(1_000);
const docs10K = generateDocs(10_000);

const accel = new QueryAccelerator({ accelerationThreshold: 100 });

// ── Standard JS baselines ──────────────────────────────────

function nativeFilter(docs: TestDoc[], dept: string): TestDoc[] {
  return docs.filter((d) => d.department === dept && d.active && d.age >= 25);
}

function nativeSort(docs: TestDoc[]): TestDoc[] {
  return [...docs].sort((a, b) => b.salary - a.salary);
}

function nativeFilterSort(docs: TestDoc[], dept: string, limit: number): TestDoc[] {
  return docs
    .filter((d) => d.department === dept && d.active)
    .sort((a, b) => b.salary - a.salary)
    .slice(0, limit);
}

// ── 1K docs ────────────────────────────────────────────────

describe('1K documents', () => {
  bench('native filter (1K)', () => {
    nativeFilter(docs1K, 'engineering');
  });

  bench('accelerator filter (1K)', () => {
    accel.filter(docs1K, {
      department: 'engineering',
      active: true,
      age: { $gte: 25 },
    });
  });

  bench('native sort (1K)', () => {
    nativeSort(docs1K);
  });

  bench('accelerator sort (1K)', () => {
    accel.sort([...docs1K], [{ field: 'salary', direction: 'desc' }]);
  });

  bench('native filter+sort+limit (1K)', () => {
    nativeFilterSort(docs1K, 'engineering', 10);
  });

  bench('accelerator filterAndSort (1K)', () => {
    accel.filterAndSort(
      docs1K,
      { department: 'engineering', active: true },
      [{ field: 'salary', direction: 'desc' }],
      10
    );
  });
});

// ── 10K docs ───────────────────────────────────────────────

describe('10K documents', () => {
  bench('native filter (10K)', () => {
    nativeFilter(docs10K, 'engineering');
  });

  bench('accelerator filter (10K)', () => {
    accel.filter(docs10K, {
      department: 'engineering',
      active: true,
      age: { $gte: 25 },
    });
  });

  bench('accelerator aggregate (10K)', () => {
    accel.aggregate(docs10K, 'salary', { department: 'engineering' });
  });

  bench('accelerator groupBy (10K)', () => {
    accel.groupBy(docs10K, 'department');
  });

  bench('accelerator count (10K)', () => {
    accel.count(docs10K, { active: true, department: 'sales' });
  });

  bench('native filter+sort+limit (10K)', () => {
    nativeFilterSort(docs10K, 'engineering', 20);
  });

  bench('accelerator filterAndSort (10K)', () => {
    accel.filterAndSort(
      docs10K,
      { department: 'engineering', active: true },
      [{ field: 'salary', direction: 'desc' }],
      20
    );
  });
});

/**
 * Query benchmarks for Pocket database
 */

import { Bench } from 'tinybench';
import { Database, createDatabase } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { generateTestDocs, printResults, type BenchmarkResult } from './utils.js';

interface TestDoc {
  _id: string;
  _rev: string;
  name: string;
  email: string;
  age: number;
}

async function createTestDatabase(name: string): Promise<Database> {
  return createDatabase({
    name,
    storage: createMemoryStorage(),
  });
}

async function runQueryBenchmarks(): Promise<void> {
  console.log('\n🔍 Pocket Query Benchmarks\n');
  console.log('Running query benchmarks with in-memory storage...\n');

  const results: BenchmarkResult[] = [];

  // Setup: Create database with test data
  const db = await createTestDatabase('bench-query');
  const collection = db.collection<TestDoc>('users');
  await collection.insertMany(generateTestDocs(1000));

  // Simple equality query
  {
    console.log('📝 Benchmarking: Simple Equality Query');
    const bench = new Bench({ time: 2000, iterations: 500 });

    let age = 25;

    bench.add('where().equals()', async () => {
      await collection.find().where('age').equals(age++ % 70 + 20).exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Simple Equality Query',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Range query
  {
    console.log('📝 Benchmarking: Range Query');
    const bench = new Bench({ time: 2000, iterations: 500 });

    bench.add('where().between()', async () => {
      await collection.find().where('age').between(25, 35).exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Range Query (between)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Greater than query
  {
    console.log('📝 Benchmarking: Greater Than Query');
    const bench = new Bench({ time: 2000, iterations: 500 });

    bench.add('where().greaterThan()', async () => {
      await collection.find().where('age').greaterThan(50).exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Greater Than Query',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Query with limit
  {
    console.log('📝 Benchmarking: Query with Limit');
    const bench = new Bench({ time: 2000, iterations: 500 });

    bench.add('find().limit(10)', async () => {
      await collection.find().limit(10).exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Query with Limit (10)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Query with skip and limit
  {
    console.log('📝 Benchmarking: Query with Skip + Limit');
    const bench = new Bench({ time: 2000, iterations: 500 });

    bench.add('find().skip().limit()', async () => {
      await collection.find().skip(100).limit(10).exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Query Skip(100) + Limit(10)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Query with sort
  {
    console.log('📝 Benchmarking: Query with Sort');
    const bench = new Bench({ time: 2000, iterations: 200 });

    bench.add('find().sort().exec()', async () => {
      await collection.find().sort('age', 'desc').exec();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Query with Sort',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // Count with filter
  {
    console.log('📝 Benchmarking: Count with Filter');
    const bench = new Bench({ time: 2000, iterations: 500 });

    bench.add('count({ age: 30 })', async () => {
      await collection.count({ age: 30 } as Partial<TestDoc>);
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Count with Filter',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  // findOne
  {
    console.log('📝 Benchmarking: Find One');
    const bench = new Bench({ time: 2000, iterations: 500 });

    let age = 25;

    bench.add('findOne()', async () => {
      await collection.findOne({ age: age++ % 70 + 20 } as Partial<TestDoc>);
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Find One',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
  }

  await db.close();

  // Print results
  console.log('\n📊 Results Summary');
  printResults(results);
}

runQueryBenchmarks().catch(console.error);

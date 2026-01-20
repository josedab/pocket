/**
 * Core benchmarks for Pocket database operations
 */

import { Bench } from 'tinybench';
import { Database, createDatabase } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { generateTestDoc, generateTestDocs, printResults, type BenchmarkResult } from './utils.js';

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

async function runCoreBenchmarks(): Promise<void> {
  console.log('\n🚀 Pocket Core Benchmarks\n');
  console.log('Running benchmarks with in-memory storage...\n');

  const results: BenchmarkResult[] = [];

  // Insert benchmark
  {
    console.log('📝 Benchmarking: Single Insert');
    const bench = new Bench({ time: 2000, iterations: 1000 });

    let db: Database;
    let counter = 0;

    bench
      .add('insert', async () => {
        const collection = db.collection<TestDoc>('users');
        await collection.insert(generateTestDoc(counter++));
      })
      .addEventListener('cycle', async () => {
        db = await createTestDatabase(`bench-insert-${Date.now()}`);
        counter = 0;
      });

    db = await createTestDatabase('bench-insert-init');
    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Single Insert',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Bulk insert benchmark
  {
    console.log('📝 Benchmarking: Bulk Insert (100 docs)');
    const bench = new Bench({ time: 2000, iterations: 100 });

    let db: Database;
    const docs = generateTestDocs(100);

    bench
      .add('insertMany (100)', async () => {
        const collection = db.collection<TestDoc>('users');
        await collection.insertMany(docs);
      })
      .addEventListener('cycle', async () => {
        db = await createTestDatabase(`bench-bulk-${Date.now()}`);
      });

    db = await createTestDatabase('bench-bulk-init');
    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Bulk Insert (100 docs)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Get by ID benchmark
  {
    console.log('📝 Benchmarking: Get by ID');
    const bench = new Bench({ time: 2000, iterations: 1000 });

    const db = await createTestDatabase('bench-get');
    const collection = db.collection<TestDoc>('users');

    // Pre-populate
    const docs = await collection.insertMany(generateTestDocs(1000));
    const ids = docs.map((d) => d._id);
    let idx = 0;

    bench.add('get', async () => {
      await collection.get(ids[idx++ % ids.length]!);
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Get by ID',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Get many benchmark
  {
    console.log('📝 Benchmarking: Get Many (10 docs)');
    const bench = new Bench({ time: 2000, iterations: 500 });

    const db = await createTestDatabase('bench-getmany');
    const collection = db.collection<TestDoc>('users');

    // Pre-populate
    const docs = await collection.insertMany(generateTestDocs(1000));
    const ids = docs.slice(0, 10).map((d) => d._id);

    bench.add('getMany (10)', async () => {
      await collection.getMany(ids);
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Get Many (10 docs)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Get all benchmark (small collection)
  {
    console.log('📝 Benchmarking: Get All (100 docs)');
    const bench = new Bench({ time: 2000, iterations: 500 });

    const db = await createTestDatabase('bench-getall-100');
    const collection = db.collection<TestDoc>('users');
    await collection.insertMany(generateTestDocs(100));

    bench.add('getAll (100)', async () => {
      await collection.getAll();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Get All (100 docs)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Get all benchmark (larger collection)
  {
    console.log('📝 Benchmarking: Get All (1000 docs)');
    const bench = new Bench({ time: 2000, iterations: 100 });

    const db = await createTestDatabase('bench-getall-1000');
    const collection = db.collection<TestDoc>('users');
    await collection.insertMany(generateTestDocs(1000));

    bench.add('getAll (1000)', async () => {
      await collection.getAll();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Get All (1000 docs)',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Update benchmark
  {
    console.log('📝 Benchmarking: Update');
    const bench = new Bench({ time: 2000, iterations: 1000 });

    const db = await createTestDatabase('bench-update');
    const collection = db.collection<TestDoc>('users');

    // Pre-populate
    const docs = await collection.insertMany(generateTestDocs(1000));
    const ids = docs.map((d) => d._id);
    let idx = 0;

    bench.add('update', async () => {
      const id = ids[idx++ % ids.length]!;
      await collection.update(id, { age: 25 + (idx % 50) });
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Update',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Delete benchmark
  {
    console.log('📝 Benchmarking: Delete');
    const bench = new Bench({ time: 2000, iterations: 500 });

    let db: Database;
    let ids: string[] = [];
    let idx = 0;

    bench
      .add('delete', async () => {
        const collection = db.collection<TestDoc>('users');
        const id = ids[idx++];
        if (id) {
          await collection.delete(id);
        }
      })
      .addEventListener('cycle', async () => {
        db = await createTestDatabase(`bench-delete-${Date.now()}`);
        const collection = db.collection<TestDoc>('users');
        const docs = await collection.insertMany(generateTestDocs(1000));
        ids = docs.map((d) => d._id);
        idx = 0;
      });

    db = await createTestDatabase('bench-delete-init');
    const initCollection = db.collection<TestDoc>('users');
    const initDocs = await initCollection.insertMany(generateTestDocs(1000));
    ids = initDocs.map((d) => d._id);

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Delete',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Count benchmark
  {
    console.log('📝 Benchmarking: Count');
    const bench = new Bench({ time: 2000, iterations: 1000 });

    const db = await createTestDatabase('bench-count');
    const collection = db.collection<TestDoc>('users');
    await collection.insertMany(generateTestDocs(1000));

    bench.add('count', async () => {
      await collection.count();
    });

    await bench.run();

    const task = bench.tasks[0]!;
    results.push({
      name: 'Count',
      ops: task.runs,
      time: task.result!.totalTime,
      opsPerSec: task.result!.hz,
      avgTime: task.result!.mean,
    });
    await db.close();
  }

  // Print results
  console.log('\n📊 Results Summary');
  printResults(results);
}

runCoreBenchmarks().catch(console.error);

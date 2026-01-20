/**
 * Run all Pocket benchmarks
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const benchmarks = ['core.bench.ts', 'query.bench.ts'];

async function runBenchmark(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', join(__dirname, file)], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Benchmark ${file} failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('                    🚀 Pocket Benchmark Suite');
  console.log('═'.repeat(70));
  console.log(`\nRunning ${benchmarks.length} benchmark suites...\n`);

  for (const benchmark of benchmarks) {
    try {
      await runBenchmark(benchmark);
    } catch (error) {
      console.error(`Failed to run ${benchmark}:`, error);
      process.exit(1);
    }
  }

  console.log('\n✅ All benchmarks completed successfully!\n');
}

main().catch(console.error);

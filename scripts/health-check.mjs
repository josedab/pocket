#!/usr/bin/env node

/**
 * Package health check — reports README, test, doc, and export status per package.
 * Usage: node scripts/health-check.mjs [--fail-under <percent>]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const failUnder = (() => {
  const idx = process.argv.indexOf('--fail-under');
  return idx >= 0 ? parseInt(process.argv[idx + 1] || '0', 10) : 0;
})();

const pkgDirs = readdirSync(join(ROOT, 'packages')).filter((d) => {
  const p = join(ROOT, 'packages', d);
  return statSync(p).isDirectory() && existsSync(join(p, 'package.json'));
});

const results = [];

for (const dir of pkgDirs.sort()) {
  const pkgDir = join(ROOT, 'packages', dir);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  const hasReadme = existsSync(join(pkgDir, 'README.md'));
  const hasSrc = existsSync(join(pkgDir, 'src', 'index.ts'));

  const testDir = join(pkgDir, 'src', '__tests__');
  let testFiles = 0;
  if (existsSync(testDir)) {
    testFiles = readdirSync(testDir).filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx')).length;
  }

  const hasExports = pkgJson.exports && Object.keys(pkgJson.exports).length > 0;
  const hasKeywords = Array.isArray(pkgJson.keywords) && pkgJson.keywords.length >= 3;

  let score = 0;
  if (hasReadme) score += 25;
  if (hasSrc) score += 15;
  if (testFiles > 0) score += 30;
  if (testFiles >= 3) score += 10;
  if (hasExports) score += 10;
  if (hasKeywords) score += 10;

  results.push({
    name: pkgJson.name || `@pocket/${dir}`,
    dir,
    hasReadme,
    hasSrc,
    testFiles,
    hasExports,
    hasKeywords,
    score,
  });
}

// Print report
console.log('\n🏥 Package Health Dashboard\n');
console.log(
  'Package'.padEnd(35),
  'Score'.padEnd(7),
  'README'.padEnd(8),
  'Tests'.padEnd(8),
  'Exports'.padEnd(9),
  'Keywords'
);
console.log('─'.repeat(85));

const healthy = [];
const needsWork = [];

for (const r of results) {
  const grade = r.score >= 70 ? '✅' : r.score >= 40 ? '⚠️ ' : '❌';
  console.log(
    r.name.padEnd(35),
    `${grade} ${String(r.score).padStart(3)}%`.padEnd(7),
    (r.hasReadme ? '✅' : '❌').padEnd(8),
    (r.testFiles > 0 ? `✅ ${r.testFiles}` : '❌ 0').padEnd(8),
    (r.hasExports ? '✅' : '❌').padEnd(9),
    r.hasKeywords ? '✅' : '❌'
  );

  if (r.score >= 70) healthy.push(r);
  else needsWork.push(r);
}

console.log('\n📊 Summary');
console.log(`  ✅ Healthy (≥70%): ${healthy.length} packages`);
console.log(`  ⚠️  Needs work (<70%): ${needsWork.length} packages`);

const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
console.log(`  📈 Average health score: ${avgScore}%\n`);

if (failUnder > 0 && avgScore < failUnder) {
  console.error(`❌ Average health ${avgScore}% is below threshold ${failUnder}%`);
  process.exit(1);
}

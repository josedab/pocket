#!/usr/bin/env node

/**
 * Package status report — shows maturity tier and health for each package.
 * Usage: node scripts/package-status.mjs [--tier stable|beta|experimental|archived]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const status = JSON.parse(readFileSync(join(ROOT, 'packages/.status.json'), 'utf-8'));

const tierFilter = process.argv.find((a) => ['stable', 'beta', 'experimental', 'archived'].includes(a));

const TIER_ICONS = { stable: '🟢', beta: '🟡', experimental: '🟠', archived: '⚪' };

const results = [];

for (const [tier, { packages }] of Object.entries(status.tiers)) {
  if (tierFilter && tier !== tierFilter) continue;

  for (const pkg of packages) {
    const dirName = pkg.replace('@pocket/', '');
    const pkgDir = join(ROOT, 'packages', dirName);

    if (!existsSync(pkgDir)) {
      results.push({ pkg, tier, readme: false, tests: false, testCount: 0 });
      continue;
    }

    const hasReadme = existsSync(join(pkgDir, 'README.md'));
    const testDir = join(pkgDir, 'src', '__tests__');
    let testCount = 0;
    if (existsSync(testDir)) {
      testCount = readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).length;
    }

    results.push({ pkg, tier, readme: hasReadme, tests: testCount > 0, testCount });
  }
}

// Print report
console.log('\n📦 Pocket Package Status Report\n');
console.log('Package'.padEnd(35), 'Tier'.padEnd(15), 'README'.padEnd(8), 'Tests'.padEnd(8), 'Files');
console.log('─'.repeat(78));

for (const r of results) {
  const icon = TIER_ICONS[r.tier] || '?';
  console.log(
    r.pkg.padEnd(35),
    `${icon} ${r.tier}`.padEnd(15),
    (r.readme ? '✅' : '❌').padEnd(8),
    (r.tests ? '✅' : '❌').padEnd(8),
    String(r.testCount)
  );
}

// Summary
const tiers = {};
for (const r of results) {
  tiers[r.tier] = tiers[r.tier] || { total: 0, withReadme: 0, withTests: 0 };
  tiers[r.tier].total++;
  if (r.readme) tiers[r.tier].withReadme++;
  if (r.tests) tiers[r.tier].withTests++;
}

console.log('\n📊 Summary\n');
for (const [tier, data] of Object.entries(tiers)) {
  const icon = TIER_ICONS[tier] || '?';
  console.log(`  ${icon} ${tier}: ${data.total} packages (${data.withReadme} READMEs, ${data.withTests} with tests)`);
}

const total = results.length;
const withReadme = results.filter((r) => r.readme).length;
const withTests = results.filter((r) => r.tests).length;
console.log(`\n  Total: ${total} packages | ${withReadme} READMEs (${Math.round((withReadme / total) * 100)}%) | ${withTests} with tests (${Math.round((withTests / total) * 100)}%)`);

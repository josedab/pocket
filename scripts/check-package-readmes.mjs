#!/usr/bin/env node

/**
 * Checks that stable and beta packages have a README.md.
 * Uses packages/.status.json for tier classification.
 * Usage: node scripts/check-package-readmes.mjs [--strict]
 *
 * --strict  Also require experimental packages to have READMEs (default: only stable + beta).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATUS_PATH = join(ROOT, 'packages', '.status.json');

const strict = process.argv.includes('--strict');
const requiredTiers = strict
  ? ['stable', 'beta', 'experimental']
  : ['stable', 'beta'];

if (!existsSync(STATUS_PATH)) {
  console.error('❌ packages/.status.json not found.');
  process.exit(1);
}

const status = JSON.parse(readFileSync(STATUS_PATH, 'utf-8'));
const missing = [];

for (const tier of requiredTiers) {
  const tierData = status.tiers[tier];
  if (!tierData) continue;

  for (const pkg of tierData.packages) {
    const dirName = pkg.replace('@pocket/', '');
    const readmePath = join(ROOT, 'packages', dirName, 'README.md');

    if (!existsSync(readmePath)) {
      missing.push({ pkg, tier });
    }
  }
}

if (missing.length === 0) {
  const tierLabel = requiredTiers.join(' + ');
  console.log(`✅ All ${tierLabel} packages have a README.md.`);
  process.exit(0);
}

console.log(`\n❌ ${missing.length} package(s) are missing a README.md:\n`);

const grouped = {};
for (const { pkg, tier } of missing) {
  grouped[tier] = grouped[tier] || [];
  grouped[tier].push(pkg);
}

for (const [tier, packages] of Object.entries(grouped)) {
  console.log(`  ${tier}:`);
  for (const pkg of packages) {
    const dirName = pkg.replace('@pocket/', '');
    console.log(`    - ${pkg}  (packages/${dirName}/README.md)`);
  }
  console.log();
}

console.log('Add a README.md to each package, or move it to the experimental tier in packages/.status.json.');
process.exit(1);

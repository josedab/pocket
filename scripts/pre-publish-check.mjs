#!/usr/bin/env node

/**
 * Pre-publish verification script.
 * Validates that core packages are ready for npm publication.
 *
 * Usage: node scripts/pre-publish-check.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const CORE_PACKAGES = [
  'core',
  'react',
  'sync',
  'server',
  'storage-indexeddb',
  'storage-memory',
  'storage-opfs',
  'pocket',
];

const errors = [];
const warnings = [];

function check(condition, message, level = 'error') {
  if (!condition) {
    if (level === 'error') errors.push(message);
    else warnings.push(message);
  }
}

console.log('🔍 Pre-publish verification\n');

for (const pkg of CORE_PACKAGES) {
  const pkgDir = join(root, 'packages', pkg);
  const pkgJsonPath = join(pkgDir, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    errors.push(`${pkg}: package.json not found`);
    continue;
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const label = pkgJson.name || pkg;

  // Required fields
  check(pkgJson.name, `${label}: missing "name"`);
  check(pkgJson.version, `${label}: missing "version"`);
  check(pkgJson.description, `${label}: missing "description"`);
  check(pkgJson.license, `${label}: missing "license"`);
  check(pkgJson.repository, `${label}: missing "repository"`);
  check(!pkgJson.private, `${label}: is marked "private: true"`);

  // Exports configuration
  check(pkgJson.exports, `${label}: missing "exports" field`);
  if (pkgJson.exports) {
    const dot = pkgJson.exports['.'];
    if (dot) {
      check(dot.types, `${label}: exports["."] missing "types"`);
      check(dot.import || dot.default, `${label}: exports["."] missing "import"`);
    } else {
      check(false, `${label}: exports missing "." entry`);
    }
  }

  // Files field
  check(pkgJson.files, `${label}: missing "files" field`);
  if (pkgJson.files) {
    check(pkgJson.files.includes('dist'), `${label}: "files" does not include "dist"`);
  }

  // Dist must exist
  const distDir = join(pkgDir, 'dist');
  check(existsSync(distDir), `${label}: dist/ directory not found (run "pnpm build" first)`);

  // README
  check(
    existsSync(join(pkgDir, 'README.md')),
    `${label}: README.md not found`,
    'warn'
  );

  // Changelog-relevant: version should not be 0.0.0
  check(
    pkgJson.version !== '0.0.0',
    `${label}: version is 0.0.0 — set a real version before publishing`,
    'warn'
  );
}

// Report
console.log(`Checked ${CORE_PACKAGES.length} core packages\n`);

if (warnings.length > 0) {
  console.log(`⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`   ${w}`);
  console.log();
}

if (errors.length > 0) {
  console.log(`❌ ${errors.length} error(s):`);
  for (const e of errors) console.log(`   ${e}`);
  console.log('\nFix the errors above before publishing.');
  process.exit(1);
} else {
  console.log('✅ All core packages are ready for publish!');
}

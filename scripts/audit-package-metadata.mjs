#!/usr/bin/env node

// Audits all workspace package.json files for required metadata fields.
// Returns non-zero exit code if any issues are found.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');

const REQUIRED_KEYWORDS = ['pocket', 'database', 'local-first'];
const MIN_KEYWORDS = 5;

const EXPECTED = {
  homepage: 'https://pocket-db.dev',
  'bugs.url': 'https://github.com/pocket-db/pocket/issues',
};

function getPackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .filter((name) => {
      const pkgPath = join(PACKAGES_DIR, name, 'package.json');
      try {
        statSync(pkgPath);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

function auditPackage(dirName) {
  const pkgPath = join(PACKAGES_DIR, dirName, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const issues = [];

  // description
  if (!pkg.description) {
    issues.push('Missing "description"');
  }

  // license
  if (!pkg.license) {
    issues.push('Missing "license"');
  }

  // repository.directory
  if (!pkg.repository?.directory) {
    issues.push('Missing "repository.directory"');
  } else if (pkg.repository.directory !== `packages/${dirName}`) {
    issues.push(
      `"repository.directory" should be "packages/${dirName}", got "${pkg.repository.directory}"`
    );
  }

  // homepage
  if (!pkg.homepage) {
    issues.push('Missing "homepage"');
  }

  // bugs.url
  if (!pkg.bugs?.url) {
    issues.push('Missing "bugs.url"');
  }

  // keywords
  if (!Array.isArray(pkg.keywords) || pkg.keywords.length === 0) {
    issues.push('Missing "keywords"');
  } else {
    if (pkg.keywords.length < MIN_KEYWORDS) {
      issues.push(
        `"keywords" has ${pkg.keywords.length} entries, need at least ${MIN_KEYWORDS}`
      );
    }
    for (const kw of REQUIRED_KEYWORDS) {
      if (!pkg.keywords.includes(kw)) {
        issues.push(`"keywords" missing required keyword "${kw}"`);
      }
    }
  }

  return { name: pkg.name, dirName, issues };
}

// Run audit
const dirs = getPackageDirs();
let totalIssues = 0;
const results = [];

for (const dir of dirs) {
  const result = auditPackage(dir);
  results.push(result);
  totalIssues += result.issues.length;
}

// Report
const packagesWithIssues = results.filter((r) => r.issues.length > 0);

if (packagesWithIssues.length === 0) {
  console.log(`✅ All ${dirs.length} packages have complete metadata.`);
  process.exit(0);
} else {
  console.log(
    `\n📋 Package Metadata Audit: ${packagesWithIssues.length}/${dirs.length} packages have issues\n`
  );

  for (const { name, dirName, issues } of packagesWithIssues) {
    console.log(`❌ ${name} (packages/${dirName})`);
    for (const issue of issues) {
      console.log(`   • ${issue}`);
    }
    console.log();
  }

  console.log(`Total issues: ${totalIssues}`);
  process.exit(1);
}

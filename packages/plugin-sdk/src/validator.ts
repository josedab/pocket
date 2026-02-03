/**
 * Plugin Validator — validates plugin manifests and structure.
 */

import type { PluginManifest, PluginValidationResult } from './types.js';

const VALID_CATEGORIES = [
  'storage', 'sync', 'security', 'analytics',
  'ui', 'data', 'devtools', 'integration', 'other',
];

const SEMVER_REGEX = /^\d+\.\d+\.\d+/;

/**
 * Validate a plugin manifest for completeness and correctness.
 */
export function validateManifest(manifest: Partial<PluginManifest>): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!manifest.name || manifest.name.trim() === '') {
    errors.push('Plugin name is required');
  } else if (!/^[@a-z0-9][\w./-]*$/.test(manifest.name)) {
    errors.push('Plugin name must be a valid npm package name');
  }

  if (!manifest.version) {
    errors.push('Version is required');
  } else if (!SEMVER_REGEX.test(manifest.version)) {
    errors.push('Version must be valid semver (e.g., 1.0.0)');
  }

  if (!manifest.description || manifest.description.trim() === '') {
    errors.push('Description is required');
  } else if (manifest.description.length < 10) {
    warnings.push('Description should be at least 10 characters');
  }

  if (!manifest.author || manifest.author.trim() === '') {
    errors.push('Author is required');
  }

  if (!manifest.category) {
    errors.push('Category is required');
  } else if (!VALID_CATEGORIES.includes(manifest.category)) {
    errors.push(`Invalid category "${manifest.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (!manifest.pocketVersion) {
    errors.push('pocketVersion compatibility range is required');
  }

  // Optional field warnings
  if (!manifest.license) {
    warnings.push('License is recommended');
  }

  if (!manifest.keywords || manifest.keywords.length === 0) {
    warnings.push('Keywords improve discoverability');
  }

  if (!manifest.repository) {
    warnings.push('Repository URL is recommended');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate plugin structure (checks for required files).
 */
export function validatePluginStructure(
  files: string[],
): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasPackageJson = files.some((f) => f === 'package.json' || f.endsWith('/package.json'));
  if (!hasPackageJson) {
    errors.push('Missing package.json');
  }

  const hasIndex = files.some(
    (f) => f.includes('index.ts') || f.includes('index.js'),
  );
  if (!hasIndex) {
    errors.push('Missing entry point (index.ts or index.js)');
  }

  const hasTests = files.some(
    (f) => f.includes('.test.') || f.includes('.spec.'),
  );
  if (!hasTests) {
    warnings.push('No test files found — tests are recommended');
  }

  const hasReadme = files.some(
    (f) => f.toLowerCase() === 'readme.md' || f.toLowerCase().endsWith('/readme.md'),
  );
  if (!hasReadme) {
    warnings.push('README.md is recommended');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

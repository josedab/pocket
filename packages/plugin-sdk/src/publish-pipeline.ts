/**
 * End-to-end plugin publish validation pipeline.
 *
 * Chains manifest validation, quality scoring, and security scanning
 * into a single publishPlugin() function that returns a comprehensive
 * publish readiness report.
 *
 * @module publish-pipeline
 */

import { validateManifest, validatePluginStructure } from './validator.js';
import { createQualityScorer, type PluginAnalysis, type ScorerQualityScore } from './quality-scorer.js';
import { SecurityScanner, type SecurityScanResult, type PluginScanInput } from './security-scanner.js';

/** Publish readiness status */
export type PublishReadiness = 'ready' | 'needs-fixes' | 'blocked';

/** Single validation check result */
export interface PublishCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
  readonly severity: 'blocker' | 'warning' | 'info';
}

/** Full publish validation report */
export interface PublishReport {
  readonly pluginName: string;
  readonly version: string;
  readonly readiness: PublishReadiness;
  readonly checks: readonly PublishCheck[];
  readonly manifestValid: boolean;
  readonly structureValid: boolean;
  readonly qualityScore: ScorerQualityScore | null;
  readonly securityScan: SecurityScanResult | null;
  readonly timestamp: number;
  readonly durationMs: number;
}

/** Options for the publish pipeline */
export interface PublishPipelineOptions {
  /** Minimum quality score to pass (default: 50) */
  readonly minQualityScore?: number;
  /** Skip security scanning (default: false) */
  readonly skipSecurity?: boolean;
  /** Skip quality scoring (default: false) */
  readonly skipQuality?: boolean;
}

/**
 * Run the complete publish validation pipeline.
 *
 * @example
 * ```typescript
 * import { publishPlugin } from '@pocket/plugin-sdk';
 *
 * const report = publishPlugin({
 *   manifest: { name: '@pocket/my-plugin', version: '1.0.0', ... },
 *   sourceFiles: new Map([['src/index.ts', code]]),
 *   dependencies: ['rxjs'],
 * });
 *
 * if (report.readiness === 'ready') {
 *   console.log('Plugin is ready for marketplace!');
 * } else {
 *   for (const check of report.checks.filter(c => !c.passed)) {
 *     console.log(`[${check.severity}] ${check.name}: ${check.details}`);
 *   }
 * }
 * ```
 */
export function publishPlugin(
  input: PluginScanInput,
  options: PublishPipelineOptions = {},
): PublishReport {
  const start = Date.now();
  const checks: PublishCheck[] = [];
  const minScore = options.minQualityScore ?? 50;

  // Step 1: Manifest validation
  const manifestResult = validateManifest(input.manifest);
  const manifestValid = manifestResult.valid;
  checks.push({
    name: 'Manifest Validation',
    passed: manifestValid,
    details: manifestValid
      ? `Manifest is valid (${Object.keys(input.manifest).length} fields)`
      : `${manifestResult.errors.length} error(s): ${manifestResult.errors.join('; ')}`,
    severity: manifestValid ? 'info' : 'blocker',
  });

  // Step 2: Structure validation
  const fileList = Array.from(input.sourceFiles.keys());
  const structureResult = validatePluginStructure(fileList);
  const structureValid = structureResult.valid;
  checks.push({
    name: 'Plugin Structure',
    passed: structureValid,
    details: structureValid
      ? 'Plugin structure is valid'
      : `${structureResult.errors.length} issue(s): ${structureResult.errors.join('; ')}`,
    severity: structureValid ? 'info' : 'warning',
  });

  // Step 3: Quality scoring
  let qualityScore: ScorerQualityScore | null = null;
  if (!options.skipQuality) {
    const scorer = createQualityScorer();
    const analysis: PluginAnalysis = {
      hasTests: fileList.some((f) => f.includes('.test.')),
      testCount: fileList.filter((f) => f.includes('.test.')).length,
      hasReadme: input.sourceFiles.has('README.md'),
      hasChangelog: input.sourceFiles.has('CHANGELOG.md'),
      hasLicense: input.sourceFiles.has('LICENSE'),
      hasTypes: fileList.some((f) => f.endsWith('.d.ts')),
      hasExamples: fileList.some((f) => f.includes('example')),
      dependencyCount: input.dependencies?.length ?? 0,
      codeLines: Array.from(input.sourceFiles.values()).reduce((sum, content) => sum + content.split('\n').length, 0),
      exportCount: Array.from(input.sourceFiles.values()).reduce((sum, content) => sum + (content.match(/^export /gm)?.length ?? 0), 0),
      lastUpdatedAt: Date.now(),
    };
    qualityScore = scorer.score(analysis);

    const qualityPassed = qualityScore.overall >= minScore;
    checks.push({
      name: 'Quality Score',
      passed: qualityPassed,
      details: `Score: ${qualityScore.overall}/100 (minimum: ${minScore})`,
      severity: qualityPassed ? 'info' : 'warning',
    });
  }

  // Step 4: Security scan
  let securityScan: SecurityScanResult | null = null;
  if (!options.skipSecurity) {
    const scanner = new SecurityScanner({ scanDependencies: true });
    securityScan = scanner.scan(input);

    checks.push({
      name: 'Security Scan',
      passed: securityScan.passed,
      details: securityScan.passed
        ? `Passed (${securityScan.scannedFiles} files, ${securityScan.scannedLines} lines)`
        : `${securityScan.summary.critical} critical, ${securityScan.summary.high} high findings`,
      severity: securityScan.passed ? 'info' : 'blocker',
    });
  }

  // Determine overall readiness
  const hasBlockers = checks.some((c) => !c.passed && c.severity === 'blocker');
  const hasWarnings = checks.some((c) => !c.passed && c.severity === 'warning');
  const readiness: PublishReadiness = hasBlockers ? 'blocked' : hasWarnings ? 'needs-fixes' : 'ready';

  return {
    pluginName: input.manifest.name,
    version: input.manifest.version,
    readiness,
    checks,
    manifestValid,
    structureValid,
    qualityScore,
    securityScan,
    timestamp: Date.now(),
    durationMs: Date.now() - start,
  };
}

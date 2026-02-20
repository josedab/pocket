/**
 * Marketplace integration for the security scanner.
 *
 * Adds a security scan step to the plugin publish workflow,
 * ensuring all published plugins pass security review before
 * being listed in the marketplace.
 *
 * @module marketplace-security
 */

import { SecurityScanner, type SecurityScanResult, type PluginScanInput } from './security-scanner.js';

/** Result of a marketplace security review */
export interface MarketplaceSecurityReview {
  readonly pluginName: string;
  readonly version: string;
  readonly passed: boolean;
  readonly scanResult: SecurityScanResult;
  readonly reviewedAt: number;
  readonly reviewDurationMs: number;
  readonly policyViolations: readonly string[];
  readonly recommendation: 'approve' | 'reject' | 'manual-review';
}

/** Marketplace security policy */
export interface SecurityPolicy {
  /** Maximum allowed critical findings */
  readonly maxCritical?: number;
  /** Maximum allowed high findings */
  readonly maxHigh?: number;
  /** Require dependency scanning */
  readonly requireDependencyScan?: boolean;
  /** Blocked dependency names */
  readonly blockedDependencies?: readonly string[];
  /** Required security patterns to pass */
  readonly requiredPatterns?: readonly string[];
}

const DEFAULT_POLICY: Required<SecurityPolicy> = {
  maxCritical: 0,
  maxHigh: 0,
  requireDependencyScan: true,
  blockedDependencies: ['eval5', 'vm2'],
  requiredPatterns: [],
};

/**
 * Performs a marketplace security review for a plugin.
 *
 * @example
 * ```typescript
 * import { reviewPluginSecurity } from '@pocket/plugin-sdk';
 *
 * const review = reviewPluginSecurity({
 *   manifest: pluginManifest,
 *   sourceFiles: new Map([['src/index.ts', sourceCode]]),
 *   dependencies: ['rxjs'],
 * });
 *
 * if (review.passed) {
 *   console.log('Plugin approved for marketplace');
 * } else {
 *   console.log('Rejected:', review.policyViolations);
 * }
 * ```
 */
export function reviewPluginSecurity(
  input: PluginScanInput,
  policy: SecurityPolicy = {},
): MarketplaceSecurityReview {
  const start = Date.now();
  const effectivePolicy = { ...DEFAULT_POLICY, ...policy };

  const scanner = new SecurityScanner({
    scanDependencies: effectivePolicy.requireDependencyScan,
  });

  const scanResult = scanner.scan(input);
  const violations: string[] = [];

  // Check critical findings
  if (scanResult.summary.critical > effectivePolicy.maxCritical) {
    violations.push(
      `${scanResult.summary.critical} critical finding(s) exceed maximum of ${effectivePolicy.maxCritical}`,
    );
  }

  // Check high findings
  if (scanResult.summary.high > effectivePolicy.maxHigh) {
    violations.push(
      `${scanResult.summary.high} high finding(s) exceed maximum of ${effectivePolicy.maxHigh}`,
    );
  }

  // Check blocked dependencies
  if (input.dependencies) {
    for (const dep of input.dependencies) {
      if (effectivePolicy.blockedDependencies.includes(dep)) {
        violations.push(`Blocked dependency: ${dep}`);
      }
    }
  }

  const passed = violations.length === 0;
  const recommendation: MarketplaceSecurityReview['recommendation'] =
    passed ? 'approve' :
    scanResult.summary.critical > 0 ? 'reject' : 'manual-review';

  return {
    pluginName: input.manifest.name,
    version: input.manifest.version,
    passed,
    scanResult,
    reviewedAt: Date.now(),
    reviewDurationMs: Date.now() - start,
    policyViolations: violations,
    recommendation,
  };
}

/**
 * Batch review multiple plugins for marketplace listing.
 */
export function batchReviewPlugins(
  inputs: readonly PluginScanInput[],
  policy?: SecurityPolicy,
): readonly MarketplaceSecurityReview[] {
  return inputs.map((input) => reviewPluginSecurity(input, policy));
}

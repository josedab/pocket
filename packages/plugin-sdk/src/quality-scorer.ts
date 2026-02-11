/**
 * Quality Scorer — evaluate plugin quality based on multiple criteria.
 *
 * @example
 * ```typescript
 * const scorer = createQualityScorer();
 * const score = scorer.score({ hasTests: true, testCount: 15, hasReadme: true, ... });
 * const explanations = scorer.explain(score);
 * ```
 *
 * @module @pocket/plugin-sdk/quality-scorer
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input analysis data for scoring a plugin */
export interface PluginAnalysis {
  readonly hasTests: boolean;
  readonly testCount: number;
  readonly hasReadme: boolean;
  readonly hasChangelog: boolean;
  readonly hasTypes: boolean;
  readonly hasExamples: boolean;
  readonly dependencyCount: number;
  readonly codeLines: number;
  readonly exportCount: number;
  readonly hasLicense: boolean;
  readonly lastUpdatedAt: number;
}

/** Detailed quality score result */
export interface ScorerQualityScore {
  readonly overall: number;
  readonly breakdown: {
    readonly documentation: number;
    readonly testing: number;
    readonly maintenance: number;
    readonly architecture: number;
    readonly metadata: number;
  };
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly badges: string[];
}

/** Quality scorer interface */
export interface QualityScorer {
  score(plugin: PluginAnalysis): ScorerQualityScore;
  explain(score: ScorerQualityScore): string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDocumentation(plugin: PluginAnalysis): number {
  let points = 0;
  if (plugin.hasReadme) points += 10;
  if (plugin.hasChangelog) points += 5;
  if (plugin.hasExamples) points += 10;
  return points; // max 25
}

function computeTesting(plugin: PluginAnalysis): number {
  let points = 0;
  if (plugin.hasTests) points += 10;
  if (plugin.testCount > 5) points += 8;
  if (plugin.testCount > 20) points += 7;
  return points; // max 25
}

function computeMaintenance(plugin: PluginAnalysis): number {
  const now = Date.now();
  const daysSinceUpdate = (now - plugin.lastUpdatedAt) / (1000 * 60 * 60 * 24);

  let points = 0;
  if (daysSinceUpdate <= 30) {
    points += 10;
  } else if (daysSinceUpdate <= 90) {
    points += 5;
  }
  if (plugin.hasChangelog) points += 5;
  return points; // max 15, weighted to 20
}

function computeArchitecture(plugin: PluginAnalysis): number {
  let points = 0;
  if (plugin.hasTypes) points += 8;
  if (plugin.dependencyCount < 10) points += 7;
  return points; // max 15
}

function computeMetadata(plugin: PluginAnalysis): number {
  let points = 0;
  if (plugin.hasLicense) points += 8;
  if (plugin.exportCount > 0) points += 7;
  return points; // max 15
}

function deriveGrade(overall: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (overall >= 80) return 'A';
  if (overall >= 60) return 'B';
  if (overall >= 40) return 'C';
  if (overall >= 20) return 'D';
  return 'F';
}

function deriveBadges(plugin: PluginAnalysis, overall: number): string[] {
  const badges: string[] = [];
  if (plugin.hasTests && plugin.testCount > 20) badges.push('well-tested');
  if (plugin.hasReadme && plugin.hasExamples) badges.push('well-documented');
  if (plugin.hasTypes) badges.push('typed');
  if (plugin.hasLicense) badges.push('licensed');
  if (overall >= 80) badges.push('high-quality');
  return badges;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a quality scorer instance */
export function createQualityScorer(): QualityScorer {
  return {
    score(plugin: PluginAnalysis): ScorerQualityScore {
      const documentation = computeDocumentation(plugin);
      const testing = computeTesting(plugin);
      const maintenance = computeMaintenance(plugin);
      const architecture = computeArchitecture(plugin);
      const metadata = computeMetadata(plugin);
      const overall = documentation + testing + maintenance + architecture + metadata;

      return {
        overall,
        breakdown: { documentation, testing, maintenance, architecture, metadata },
        grade: deriveGrade(overall),
        badges: deriveBadges(plugin, overall),
      };
    },

    explain(score: ScorerQualityScore): string[] {
      const lines: string[] = [];
      lines.push(`Overall score: ${score.overall}/100 (Grade: ${score.grade})`);
      lines.push(`Documentation: ${score.breakdown.documentation}/25`);
      lines.push(`Testing: ${score.breakdown.testing}/25`);
      lines.push(`Maintenance: ${score.breakdown.maintenance}/20`);
      lines.push(`Architecture: ${score.breakdown.architecture}/15`);
      lines.push(`Metadata: ${score.breakdown.metadata}/15`);
      if (score.badges.length > 0) {
        lines.push(`Badges: ${score.badges.join(', ')}`);
      }
      return lines;
    },
  };
}

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPluginDiscovery,
  type PluginDiscovery,
  type PluginEntry,
} from '../plugin-discovery.js';
import { createQualityScorer, type PluginAnalysis, type QualityScorer } from '../quality-scorer.js';

// ─── QualityScorer Tests ──────────────────────────────────────────────────────

describe('QualityScorer', () => {
  let scorer: QualityScorer;

  beforeEach(() => {
    scorer = createQualityScorer();
  });

  function makeAnalysis(overrides: Partial<PluginAnalysis> = {}): PluginAnalysis {
    return {
      hasTests: false,
      testCount: 0,
      hasReadme: false,
      hasChangelog: false,
      hasTypes: false,
      hasExamples: false,
      dependencyCount: 0,
      codeLines: 100,
      exportCount: 0,
      hasLicense: false,
      lastUpdatedAt: 0,
      ...overrides,
    };
  }

  it('should return grade F for a minimal plugin', () => {
    const result = scorer.score(makeAnalysis());
    expect(result.grade).toBe('F');
    expect(result.overall).toBeLessThan(20);
  });

  it('should return grade A for a high-quality plugin', () => {
    const result = scorer.score(
      makeAnalysis({
        hasTests: true,
        testCount: 25,
        hasReadme: true,
        hasChangelog: true,
        hasTypes: true,
        hasExamples: true,
        dependencyCount: 3,
        exportCount: 5,
        hasLicense: true,
        lastUpdatedAt: Date.now() - 1000 * 60 * 60 * 24 * 5, // 5 days ago
      })
    );
    expect(result.grade).toBe('A');
    expect(result.overall).toBeGreaterThanOrEqual(80);
  });

  it('should score documentation correctly', () => {
    const result = scorer.score(
      makeAnalysis({
        hasReadme: true,
        hasChangelog: true,
        hasExamples: true,
      })
    );
    expect(result.breakdown.documentation).toBe(25);
  });

  it('should score testing correctly with testCount thresholds', () => {
    const noTests = scorer.score(makeAnalysis());
    expect(noTests.breakdown.testing).toBe(0);

    const fewTests = scorer.score(makeAnalysis({ hasTests: true, testCount: 3 }));
    expect(fewTests.breakdown.testing).toBe(10);

    const someTests = scorer.score(makeAnalysis({ hasTests: true, testCount: 10 }));
    expect(someTests.breakdown.testing).toBe(18);

    const manyTests = scorer.score(makeAnalysis({ hasTests: true, testCount: 25 }));
    expect(manyTests.breakdown.testing).toBe(25);
  });

  it('should score maintenance based on lastUpdatedAt', () => {
    const recent = scorer.score(
      makeAnalysis({
        lastUpdatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10, // 10 days
        hasChangelog: true,
      })
    );
    expect(recent.breakdown.maintenance).toBe(15);

    const moderate = scorer.score(
      makeAnalysis({
        lastUpdatedAt: Date.now() - 1000 * 60 * 60 * 24 * 60, // 60 days
        hasChangelog: true,
      })
    );
    expect(moderate.breakdown.maintenance).toBe(10);

    const old = scorer.score(
      makeAnalysis({
        lastUpdatedAt: Date.now() - 1000 * 60 * 60 * 24 * 365, // 365 days
      })
    );
    expect(old.breakdown.maintenance).toBe(0);
  });

  it('should score architecture correctly', () => {
    const result = scorer.score(makeAnalysis({ hasTypes: true, dependencyCount: 3 }));
    expect(result.breakdown.architecture).toBe(15);

    const tooManyDeps = scorer.score(makeAnalysis({ hasTypes: true, dependencyCount: 15 }));
    expect(tooManyDeps.breakdown.architecture).toBe(8);
  });

  it('should score metadata correctly', () => {
    const result = scorer.score(makeAnalysis({ hasLicense: true, exportCount: 5 }));
    expect(result.breakdown.metadata).toBe(15);
  });

  it('should assign correct grades', () => {
    // Grade D: 20-39
    const gradeD = scorer.score(
      makeAnalysis({ hasReadme: true, hasExamples: true, hasLicense: true })
    );
    expect(gradeD.grade).toBe('D');

    // Grade C: 40-59
    const gradeC = scorer.score(
      makeAnalysis({
        hasReadme: true,
        hasExamples: true,
        hasTests: true,
        testCount: 10,
        hasLicense: true,
      })
    );
    expect(gradeC.grade).toBe('C');
  });

  it('should assign badges for well-tested plugins', () => {
    const result = scorer.score(makeAnalysis({ hasTests: true, testCount: 25 }));
    expect(result.badges).toContain('well-tested');
  });

  it('should assign well-documented badge', () => {
    const result = scorer.score(makeAnalysis({ hasReadme: true, hasExamples: true }));
    expect(result.badges).toContain('well-documented');
  });

  it('should explain a score', () => {
    const result = scorer.score(
      makeAnalysis({
        hasTests: true,
        testCount: 25,
        hasReadme: true,
        hasTypes: true,
        hasLicense: true,
        exportCount: 5,
        lastUpdatedAt: Date.now(),
      })
    );
    const lines = scorer.explain(result);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('Overall score');
    expect(lines[0]).toContain('Grade');
  });
});

// ─── PluginDiscovery Tests ────────────────────────────────────────────────────

describe('PluginDiscovery', () => {
  let discovery: PluginDiscovery;

  function makeEntry(overrides: Partial<PluginEntry> = {}): PluginEntry {
    return {
      name: 'test-plugin',
      description: 'A test plugin',
      version: '1.0.0',
      author: 'tester',
      category: 'data',
      keywords: ['test'],
      downloads: 100,
      score: 75,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    discovery = createPluginDiscovery();
  });

  it('should start empty when no plugins provided', () => {
    expect(discovery.getAllPlugins()).toHaveLength(0);
  });

  it('should accept initial plugins', () => {
    const d = createPluginDiscovery([makeEntry(), makeEntry({ name: 'other' })]);
    expect(d.getAllPlugins()).toHaveLength(2);
  });

  it('should add plugins', () => {
    discovery.addPlugin(makeEntry({ name: 'alpha' }));
    discovery.addPlugin(makeEntry({ name: 'beta' }));
    expect(discovery.getAllPlugins()).toHaveLength(2);
  });

  it('should search by name', () => {
    discovery.addPlugin(makeEntry({ name: 'auth-plugin' }));
    discovery.addPlugin(makeEntry({ name: 'data-sync' }));
    const results = discovery.search('auth');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('auth-plugin');
  });

  it('should search by description', () => {
    discovery.addPlugin(makeEntry({ description: 'Handles authentication' }));
    discovery.addPlugin(makeEntry({ description: 'Syncs data' }));
    const results = discovery.search('authentication');
    expect(results).toHaveLength(1);
  });

  it('should search by keywords', () => {
    discovery.addPlugin(makeEntry({ name: 'a', keywords: ['auth', 'security'] }));
    discovery.addPlugin(makeEntry({ name: 'b', keywords: ['data'] }));
    const results = discovery.search('security');
    expect(results).toHaveLength(1);
  });

  it('should search case-insensitively', () => {
    discovery.addPlugin(makeEntry({ name: 'Auth-Plugin' }));
    expect(discovery.search('auth')).toHaveLength(1);
    expect(discovery.search('AUTH')).toHaveLength(1);
  });

  it('should filter by category', () => {
    discovery.addPlugin(makeEntry({ name: 'a', category: 'data' }));
    discovery.addPlugin(makeEntry({ name: 'b', category: 'auth' }));
    discovery.addPlugin(makeEntry({ name: 'c', category: 'data' }));
    expect(discovery.filterByCategory('data')).toHaveLength(2);
    expect(discovery.filterByCategory('auth')).toHaveLength(1);
  });

  it('should filter by minimum score', () => {
    discovery.addPlugin(makeEntry({ name: 'a', score: 90 }));
    discovery.addPlugin(makeEntry({ name: 'b', score: 50 }));
    discovery.addPlugin(makeEntry({ name: 'c', score: 30 }));
    expect(discovery.filterByScore(60)).toHaveLength(1);
    expect(discovery.filterByScore(40)).toHaveLength(2);
  });

  it('should return popular plugins sorted by downloads', () => {
    discovery.addPlugin(makeEntry({ name: 'low', downloads: 10 }));
    discovery.addPlugin(makeEntry({ name: 'high', downloads: 1000 }));
    discovery.addPlugin(makeEntry({ name: 'mid', downloads: 500 }));
    const popular = discovery.getPopular(2);
    expect(popular).toHaveLength(2);
    expect(popular[0]!.name).toBe('high');
    expect(popular[1]!.name).toBe('mid');
  });

  it('should return recent plugins sorted by createdAt', () => {
    const now = Date.now();
    discovery.addPlugin(makeEntry({ name: 'old', createdAt: now - 90000 }));
    discovery.addPlugin(makeEntry({ name: 'new', createdAt: now }));
    discovery.addPlugin(makeEntry({ name: 'mid', createdAt: now - 50000 }));
    const recent = discovery.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.name).toBe('new');
    expect(recent[1]!.name).toBe('mid');
  });

  it('should return unique categories', () => {
    discovery.addPlugin(makeEntry({ category: 'data' }));
    discovery.addPlugin(makeEntry({ category: 'auth' }));
    discovery.addPlugin(makeEntry({ category: 'data' }));
    const categories = discovery.getCategories();
    expect(categories).toHaveLength(2);
    expect(categories).toContain('data');
    expect(categories).toContain('auth');
  });

  it('should use default limit of 10 for getPopular and getRecent', () => {
    for (let i = 0; i < 15; i++) {
      discovery.addPlugin(makeEntry({ name: `plugin-${i}`, downloads: i, createdAt: i }));
    }
    expect(discovery.getPopular()).toHaveLength(10);
    expect(discovery.getRecent()).toHaveLength(10);
  });
});

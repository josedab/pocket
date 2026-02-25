import { describe, expect, it } from 'vitest';
import { DocGenerator } from '../../../../scripts/doc-generator.js';

describe('DocGenerator', () => {
  const generator = new DocGenerator({
    packages: [
      {
        name: '@pocket/core',
        description: 'Core database engine',
        version: '0.1.0',
        category: 'Core',
        exportCount: 50,
        testCount: 174,
        maturity: 'stable',
        hasReadme: true,
      },
      {
        name: '@pocket/react',
        description: 'React hooks',
        version: '0.1.0',
        category: 'Framework',
        exportCount: 15,
        testCount: 30,
        maturity: 'stable',
        hasReadme: true,
      },
      {
        name: '@pocket/ai',
        description: 'AI integration',
        version: '0.1.0',
        category: 'Extension',
        exportCount: 20,
        testCount: 149,
        maturity: 'beta',
        hasReadme: false,
      },
    ],
  });

  it('should generate package docs for all packages', () => {
    const output = generator.generate();
    expect(output.packageDocs).toHaveLength(3);
    expect(output.packageDocs[0]!.path).toContain('core.md');
  });

  it('should generate migration guides', () => {
    const output = generator.generate();
    expect(output.migrationGuides.length).toBeGreaterThanOrEqual(2);
    expect(output.migrationGuides[0]!.content).toContain('Migrating from');
  });

  it('should generate tutorials', () => {
    const output = generator.generate();
    expect(output.tutorials.length).toBeGreaterThanOrEqual(3);
    expect(output.tutorials[0]!.content).toContain('Getting Started');
  });

  it('should generate sidebar config', () => {
    const output = generator.generate();
    expect(output.sidebar).toContain('docs');
    expect(output.sidebar).toContain('Core');
  });

  it('should include maturity badges in package docs', () => {
    const output = generator.generate();
    expect(output.packageDocs[0]!.content).toContain('🟢');
    expect(output.packageDocs[2]!.content).toContain('🟡');
  });
});

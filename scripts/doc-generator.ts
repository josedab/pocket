/**
 * DocGenerator — Automated API reference and documentation generation.
 *
 * Scans packages and generates structured documentation metadata,
 * migration guides, and tutorial scaffolds.
 */

export interface DocPackageInfo {
  name: string;
  description: string;
  version: string;
  category: string;
  exportCount: number;
  testCount: number;
  maturity: 'stable' | 'beta' | 'experimental';
  hasReadme: boolean;
}

export interface DocSiteConfig {
  packages: DocPackageInfo[];
  outputDir?: string;
  baseUrl?: string;
  title?: string;
}

export interface MigrationGuide {
  from: string;
  title: string;
  sections: { heading: string; content: string }[];
}

export interface TutorialScaffold {
  title: string;
  slug: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  sections: string[];
}

export interface DocSiteOutput {
  packageDocs: { path: string; content: string }[];
  migrationGuides: { path: string; content: string }[];
  tutorials: { path: string; content: string }[];
  sidebar: string;
}

export class DocGenerator {
  private readonly config: Required<DocSiteConfig>;

  constructor(config: DocSiteConfig) {
    this.config = {
      packages: config.packages,
      outputDir: config.outputDir ?? './docs',
      baseUrl: config.baseUrl ?? '/docs',
      title: config.title ?? 'Pocket Documentation',
    };
  }

  generate(): DocSiteOutput {
    return {
      packageDocs: this.generatePackageDocs(),
      migrationGuides: this.generateMigrationGuides(),
      tutorials: this.generateTutorials(),
      sidebar: this.generateSidebar(),
    };
  }

  private generatePackageDocs(): { path: string; content: string }[] {
    return this.config.packages.map((pkg) => ({
      path: `api/${pkg.name.replace('@pocket/', '')}.md`,
      content: this.packageToMarkdown(pkg),
    }));
  }

  private packageToMarkdown(pkg: DocPackageInfo): string {
    const maturityBadge = { stable: '🟢', beta: '🟡', experimental: '🔵' }[pkg.maturity];
    return [
      `---`,
      `title: ${pkg.name}`,
      `sidebar_label: ${pkg.name.replace('@pocket/', '')}`,
      `---`,
      ``,
      `# ${pkg.name} ${maturityBadge}`,
      ``,
      `> ${pkg.description}`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Version | ${pkg.version} |`,
      `| Category | ${pkg.category} |`,
      `| Exports | ${pkg.exportCount} |`,
      `| Tests | ${pkg.testCount} |`,
      `| Maturity | ${pkg.maturity} |`,
      ``,
      `## Installation`,
      ``,
      '```bash',
      `npm install ${pkg.name}`,
      '```',
      ``,
      `## API Reference`,
      ``,
      `See [TypeDoc API →](../typedoc/${pkg.name.replace('@pocket/', '')})`,
    ].join('\n');
  }

  private generateMigrationGuides(): { path: string; content: string }[] {
    const guides: MigrationGuide[] = [
      {
        from: 'RxDB',
        title: 'Migrating from RxDB to Pocket',
        sections: [
          {
            heading: 'Schema Mapping',
            content: 'RxDB schemas map directly to Pocket SchemaDefinition...',
          },
          {
            heading: 'Query Translation',
            content: 'RxDB uses Mango queries; Pocket supports the same operators...',
          },
          {
            heading: 'Sync Configuration',
            content: 'Replace RxDB replication with Pocket sync engine...',
          },
        ],
      },
      {
        from: 'PouchDB',
        title: 'Migrating from PouchDB to Pocket',
        sections: [
          {
            heading: 'Document Format',
            content: 'PouchDB documents with _id and _rev work directly in Pocket...',
          },
          {
            heading: 'Data Import',
            content: 'Use @pocket/portable-export to import PouchDB data dumps...',
          },
          {
            heading: 'View Migration',
            content: 'Replace CouchDB views with Pocket MaterializedView...',
          },
        ],
      },
    ];

    return guides.map((guide) => ({
      path: `guides/migrate-from-${guide.from.toLowerCase()}.md`,
      content: this.guideToMarkdown(guide),
    }));
  }

  private guideToMarkdown(guide: MigrationGuide): string {
    const sections = guide.sections.map((s) => `## ${s.heading}\n\n${s.content}`).join('\n\n');
    return `---\ntitle: "${guide.title}"\n---\n\n# ${guide.title}\n\n${sections}`;
  }

  private generateTutorials(): { path: string; content: string }[] {
    const tutorials: TutorialScaffold[] = [
      {
        title: 'Getting Started with Pocket',
        slug: 'getting-started',
        difficulty: 'beginner',
        estimatedMinutes: 5,
        sections: ['Installation', 'Create a Database', 'CRUD Operations', 'Reactive Queries'],
      },
      {
        title: 'Building a Todo App',
        slug: 'todo-app',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        sections: ['Setup', 'Define Schema', 'Build UI', 'Add Sync'],
      },
      {
        title: 'Adding Real-Time Sync',
        slug: 'sync-setup',
        difficulty: 'intermediate',
        estimatedMinutes: 20,
        sections: ['Server Setup', 'Client Config', 'Conflict Resolution', 'Offline Support'],
      },
      {
        title: 'Collaborative Editing',
        slug: 'collaboration',
        difficulty: 'advanced',
        estimatedMinutes: 30,
        sections: ['CRDT Setup', 'Presence', 'Text Collaboration', 'Conflict Visualization'],
      },
    ];

    return tutorials.map((t) => ({
      path: `tutorials/${t.slug}.md`,
      content: this.tutorialToMarkdown(t),
    }));
  }

  private tutorialToMarkdown(t: TutorialScaffold): string {
    const sections = t.sections
      .map((s, i) => `## Step ${i + 1}: ${s}\n\nTODO: Add content`)
      .join('\n\n');
    return `---\ntitle: "${t.title}"\nsidebar_label: "${t.title}"\n---\n\n# ${t.title}\n\n**Difficulty:** ${t.difficulty} | **Time:** ~${t.estimatedMinutes} min\n\n${sections}`;
  }

  private generateSidebar(): string {
    const categories = new Map<string, string[]>();
    for (const pkg of this.config.packages) {
      const cat = pkg.category;
      const list = categories.get(cat) ?? [];
      list.push(pkg.name.replace('@pocket/', ''));
      categories.set(cat, list);
    }

    const items: string[] = [];
    for (const [cat, pkgs] of categories) {
      items.push(
        `  { type: 'category', label: '${cat}', items: [${pkgs.map((p) => `'api/${p}'`).join(', ')}] },`
      );
    }

    return `module.exports = {\n  docs: [\n${items.join('\n')}\n  ],\n};`;
  }

  getConfig(): Required<DocSiteConfig> {
    return this.config;
  }
}

export function createDocGenerator(config: DocSiteConfig): DocGenerator {
  return new DocGenerator(config);
}

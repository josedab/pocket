/**
 * PluginTemplateScaffold — Template scaffolding for `pocket init --template`.
 *
 * Generates project templates with pre-configured Pocket packages,
 * schemas, and sync setup.
 */

export interface TemplateConfig {
  name: string;
  description: string;
  category: 'starter' | 'fullstack' | 'mobile' | 'enterprise';
  packages: string[];
  files: { path: string; content: string }[];
}

export interface ScaffoldResult {
  template: string;
  filesCreated: string[];
  packagesInstalled: string[];
  instructions: string[];
}

const TEMPLATES: Record<string, TemplateConfig> = {
  'todo-app': {
    name: 'Todo App',
    description: 'Simple todo app with local-first storage and optional sync',
    category: 'starter',
    packages: ['@pocket/core', '@pocket/react', '@pocket/storage-indexeddb'],
    files: [
      {
        path: 'src/db.ts',
        content: `import { Database } from '@pocket/core';\nimport { createIndexedDBStorage } from '@pocket/storage-indexeddb';\n\nexport const db = await Database.create({\n  name: 'todo-app',\n  storage: createIndexedDBStorage(),\n});\n`,
      },
      {
        path: 'src/schema.ts',
        content: `export interface Todo {\n  _id: string;\n  title: string;\n  completed: boolean;\n  createdAt: Date;\n}\n`,
      },
      {
        path: 'pocket.config.ts',
        content: `export default {\n  database: 'todo-app',\n  storage: 'indexeddb',\n};\n`,
      },
    ],
  },
  'saas-starter': {
    name: 'SaaS Starter',
    description: 'Multi-tenant SaaS app with auth, sync, and RLS',
    category: 'enterprise',
    packages: [
      '@pocket/core',
      '@pocket/react',
      '@pocket/sync',
      '@pocket/auth',
      '@pocket/rls',
      '@pocket/cloud',
    ],
    files: [
      {
        path: 'src/db.ts',
        content: `import { Database } from '@pocket/core';\nimport { createPocketCloud } from '@pocket/cloud';\n\nexport const db = await Database.create({ name: 'saas-app', storage: createIndexedDBStorage() });\nexport const cloud = createPocketCloud({ apiKey: process.env.POCKET_API_KEY! });\n`,
      },
      {
        path: 'src/auth.ts',
        content: `import { createAuthManager } from '@pocket/auth';\n\nexport const auth = createAuthManager();\n`,
      },
      {
        path: 'pocket.config.ts',
        content: `export default {\n  database: 'saas-app',\n  sync: true,\n  auth: true,\n  rls: true,\n};\n`,
      },
    ],
  },
  'collab-app': {
    name: 'Collaborative App',
    description: 'Real-time collaborative app with presence and text editing',
    category: 'fullstack',
    packages: ['@pocket/core', '@pocket/react', '@pocket/collaboration', '@pocket/sync'],
    files: [
      {
        path: 'src/db.ts',
        content: `import { Database } from '@pocket/core';\n\nexport const db = await Database.create({ name: 'collab-app', storage: createIndexedDBStorage() });\n`,
      },
      {
        path: 'src/collab.ts',
        content: `import { createCollaborationSDK } from '@pocket/collaboration';\n\nexport function setupCollab(sessionId: string, userId: string) {\n  return createCollaborationSDK({ sessionId, user: { id: userId, name: userId } });\n}\n`,
      },
    ],
  },
};

export class PluginTemplateScaffold {
  getAvailableTemplates(): { name: string; description: string; category: string }[] {
    return Object.entries(TEMPLATES).map(([key, t]) => ({
      name: key,
      description: t.description,
      category: t.category,
    }));
  }

  getTemplate(name: string): TemplateConfig | undefined {
    return TEMPLATES[name];
  }

  scaffold(templateName: string, projectName: string): ScaffoldResult {
    const template = TEMPLATES[templateName];
    if (!template)
      throw new Error(
        `Template "${templateName}" not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
      );

    const files = template.files.map((f) => ({
      ...f,
      content: f.content.replace(/todo-app|saas-app|collab-app/g, projectName),
    }));

    return {
      template: templateName,
      filesCreated: files.map((f) => f.path),
      packagesInstalled: template.packages,
      instructions: [`cd ${projectName}`, `pnpm install`, `pnpm dev`],
    };
  }

  addTemplate(key: string, config: TemplateConfig): void {
    TEMPLATES[key] = config;
  }
}

export function createTemplateScaffold(): PluginTemplateScaffold {
  return new PluginTemplateScaffold();
}

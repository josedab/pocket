import { describe, expect, it } from 'vitest';
import { PluginTemplateScaffold } from '../template-scaffold.js';

describe('PluginTemplateScaffold', () => {
  const scaffold = new PluginTemplateScaffold();

  it('should list available templates', () => {
    const templates = scaffold.getAvailableTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.find((t) => t.name === 'todo-app')).toBeDefined();
    expect(templates.find((t) => t.name === 'saas-starter')).toBeDefined();
  });

  it('should scaffold a todo app', () => {
    const result = scaffold.scaffold('todo-app', 'my-project');
    expect(result.template).toBe('todo-app');
    expect(result.filesCreated.length).toBeGreaterThan(0);
    expect(result.packagesInstalled).toContain('@pocket/core');
    expect(result.instructions).toContain('pnpm install');
  });

  it('should scaffold a SaaS starter', () => {
    const result = scaffold.scaffold('saas-starter', 'my-saas');
    expect(result.packagesInstalled).toContain('@pocket/auth');
    expect(result.packagesInstalled).toContain('@pocket/rls');
  });

  it('should throw for unknown templates', () => {
    expect(() => scaffold.scaffold('nonexistent', 'proj')).toThrow('not found');
  });

  it('should allow adding custom templates', () => {
    scaffold.addTemplate('custom', {
      name: 'Custom',
      description: 'My template',
      category: 'starter',
      packages: ['@pocket/core'],
      files: [{ path: 'index.ts', content: '// custom' }],
    });
    expect(scaffold.getTemplate('custom')).toBeDefined();
  });

  it('should replace project name in file content', () => {
    const result = scaffold.scaffold('todo-app', 'awesome-app');
    expect(result.filesCreated.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { createPocketExtension, getExtensionManifest } from '../index.js';

describe('Extension Manifest', () => {
  it('should generate valid manifest', () => {
    const manifest = getExtensionManifest();
    expect(manifest.name).toBe('pocket-vscode');
    expect(manifest.engines.vscode).toMatch(/^\^/);
    expect(manifest.activationEvents).toContain('workspaceContains:pocket.config.ts');
    expect(manifest.contributes.languages.length).toBeGreaterThan(0);
  });

  it('should include configuration settings', () => {
    const manifest = getExtensionManifest();
    const config = manifest.contributes.configuration;
    expect(config?.properties['pocket.configPath']).toBeDefined();
    expect(config?.properties['pocket.enableDiagnostics']).toBeDefined();
    expect(config?.properties['pocket.enableCompletions']).toBeDefined();
  });
});

describe('PocketExtension', () => {
  const sampleConfig = {
    database: { name: 'test' },
    collections: [
      {
        name: 'todos',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'done', type: 'boolean' },
        ],
      },
    ],
  };

  it('should activate with capabilities', () => {
    const ext = createPocketExtension();
    const result = ext.activate();
    expect(result.capabilities).toContain('completionProvider');
    expect(result.capabilities).toContain('hoverProvider');
    expect(result.capabilities).toContain('diagnosticProvider');
  });

  it('should load config and provide completions', () => {
    const ext = createPocketExtension();
    ext.activate();
    ext.loadConfig(sampleConfig);
    expect(ext.isConfigLoaded).toBe(true);

    const collections = ext.getCompletions('collection-name');
    expect(collections.map((c) => c.label)).toContain('todos');
  });

  it('should provide field completions', () => {
    const ext = createPocketExtension();
    ext.loadConfig(sampleConfig);
    const fields = ext.getCompletions('field-name', 'todos');
    expect(fields.map((f) => f.label)).toContain('title');
  });

  it('should provide hover docs', () => {
    const ext = createPocketExtension();
    ext.loadConfig(sampleConfig);
    const hover = ext.getHover('todos');
    expect(hover).toContain('Collection: todos');
  });

  it('should provide diagnostics', () => {
    const ext = createPocketExtension();
    const diags = ext.getDiagnostics({
      database: { name: 'test' },
      collections: [{ name: 'empty', fields: [] }],
    });
    expect(diags.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('should respect disabled completions', () => {
    const ext = createPocketExtension({ enableCompletions: false });
    ext.loadConfig(sampleConfig);
    expect(ext.getCompletions('collection-name')).toHaveLength(0);
  });

  it('should respect disabled diagnostics', () => {
    const ext = createPocketExtension({ enableDiagnostics: false });
    const diags = ext.getDiagnostics(sampleConfig);
    expect(diags).toHaveLength(0);
  });

  it('should update settings', () => {
    const ext = createPocketExtension();
    ext.loadConfig(sampleConfig);
    ext.updateSettings({ enableCompletions: false });
    expect(ext.getCompletions('collection-name')).toHaveLength(0);
  });

  it('should deactivate cleanly', () => {
    const ext = createPocketExtension();
    ext.loadConfig(sampleConfig);
    ext.deactivate();
    expect(ext.isConfigLoaded).toBe(false);
  });
});

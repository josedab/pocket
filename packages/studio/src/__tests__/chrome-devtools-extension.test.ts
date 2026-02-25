import { describe, expect, it } from 'vitest';
import {
  generateContentScript,
  generateDevToolsPage,
  generateExtensionFiles,
  generateExtensionManifest,
  generatePanelHTML,
} from '../chrome-devtools-extension.js';

describe('Chrome DevTools Extension Generator', () => {
  it('should generate a valid Manifest V3', () => {
    const manifest = generateExtensionManifest('1.2.3');
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toContain('Pocket');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(manifest.content_scripts.length).toBe(1);
    expect(manifest.content_scripts[0]!.matches).toContain('<all_urls>');
  });

  it('should generate devtools.html with panel registration', () => {
    const html = generateDevToolsPage({ title: 'MyDB' });
    expect(html).toContain('chrome.devtools.panels.create');
    expect(html).toContain('MyDB');
    expect(html).toContain('panel.html');
  });

  it('should generate content script with detector', () => {
    const script = generateContentScript();
    expect(script).toContain('__POCKET_DEVTOOLS__');
    expect(script).toContain('indexedDB');
    expect(script).toContain('POCKET_DETECT_RESULT');
  });

  it('should generate panel HTML with tab navigation', () => {
    const html = generatePanelHTML({ tabs: ['inspector', 'playground'] });
    expect(html).toContain('Inspector');
    expect(html).toContain('Playground');
    expect(html).toContain('tab-btn');
    expect(html).toContain('tab-panel');
  });

  it('should generate all extension files', () => {
    const files = generateExtensionFiles('0.1.0');
    expect(files.length).toBe(4);
    expect(files.find((f) => f.path === 'manifest.json')).toBeDefined();
    expect(files.find((f) => f.path === 'devtools.html')).toBeDefined();
    expect(files.find((f) => f.path === 'content-script.js')).toBeDefined();
    expect(files.find((f) => f.path === 'panel.html')).toBeDefined();

    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.content);
    expect(manifest.manifest_version).toBe(3);
  });

  it('should include all default tabs in panel', () => {
    const html = generatePanelHTML();
    expect(html).toContain('Inspector');
    expect(html).toContain('Playground');
    expect(html).toContain('Sync Monitor');
    expect(html).toContain('Profiler');
    expect(html).toContain('Conflicts');
    expect(html).toContain('Timeline');
  });
});

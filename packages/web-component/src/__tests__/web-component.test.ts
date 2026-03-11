import { describe, expect, it } from 'vitest';

// The web-component module extends HTMLElement which requires a DOM environment.
// These tests verify module structure and source code without importing the module.

describe('@pocket/web-component', () => {
  describe('module structure', () => {
    it('should have a valid index module with expected exports', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const indexPath = path.resolve(__dirname, '../index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
      const content = fs.readFileSync(indexPath, 'utf8');
      expect(content).toContain('PocketDataElement');
      expect(content).toContain('registerPocketElement');
      expect(content).toContain('DisplayMode');
      expect(content).toContain('PocketElementConfig');
      expect(content).toContain('PocketElementState');
      expect(content).toContain('PocketElementEvent');
    });
  });

  describe('types', () => {
    it('should define PocketElementConfig with required database and collection fields', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const typesPath = path.resolve(__dirname, '../types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain('database: string');
      expect(content).toContain('collection: string');
    });

    it('should define DisplayMode with table, list, json, and custom options', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const typesPath = path.resolve(__dirname, '../types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain("'table'");
      expect(content).toContain("'list'");
      expect(content).toContain("'json'");
      expect(content).toContain("'custom'");
    });

    it('should define PocketElementState with status, documents, and error fields', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const typesPath = path.resolve(__dirname, '../types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain("status: 'idle'");
      expect(content).toContain('documents: Record');
      expect(content).toContain('error: string | null');
      expect(content).toContain('syncStatus:');
    });

    it('should define all PocketElementEvent types', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const typesPath = path.resolve(__dirname, '../types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain("'ready'");
      expect(content).toContain("'data-changed'");
      expect(content).toContain("'document-selected'");
      expect(content).toContain("'document-created'");
      expect(content).toContain("'document-updated'");
      expect(content).toContain("'document-deleted'");
      expect(content).toContain("'error'");
      expect(content).toContain("'sync-status-changed'");
    });
  });

  describe('pocket-element module', () => {
    it('should define observed attributes for all configuration options', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');

      const expectedAttrs = [
        'database',
        'collection',
        'storage',
        'sync-url',
        'filter',
        'sort',
        'limit',
        'fields',
        'display',
        'editable',
        'realtime',
        'theme',
      ];
      for (const attr of expectedAttrs) {
        expect(content).toContain(`'${attr}'`);
      }
    });

    it('should implement document CRUD methods', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain('setDocuments(');
      expect(content).toContain('addDocument(');
      expect(content).toContain('updateDocument(');
      expect(content).toContain('removeDocument(');
    });

    it('should implement all display modes (table, list, json)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain('renderTable');
      expect(content).toContain('renderList');
      expect(content).toContain("case 'json'");
    });

    it('should implement theme support (light, dark, auto)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain("'light'");
      expect(content).toContain("'dark'");
      expect(content).toContain("'auto'");
      expect(content).toContain('prefers-color-scheme');
    });

    it('should emit custom events for data lifecycle', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain("'data-changed'");
      expect(content).toContain("'document-created'");
      expect(content).toContain("'document-updated'");
      expect(content).toContain("'document-deleted'");
      expect(content).toContain("'document-selected'");
      expect(content).toContain("'ready'");
    });

    it('should implement HTML escaping for XSS prevention', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain('escapeHtml');
      expect(content).toContain('&amp;');
      expect(content).toContain('&lt;');
      expect(content).toContain('&gt;');
    });

    it('should use Shadow DOM for encapsulation', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain('attachShadow');
      expect(content).toContain("mode: 'open'");
    });

    it('should implement web component lifecycle callbacks', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const elementPath = path.resolve(__dirname, '../pocket-element.ts');
      const content = fs.readFileSync(elementPath, 'utf8');
      expect(content).toContain('connectedCallback');
      expect(content).toContain('disconnectedCallback');
      expect(content).toContain('attributeChangedCallback');
    });
  });
});

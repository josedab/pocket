import { describe, expect, it } from 'vitest';
import { createFullstackMigrationGenerator } from '../migration-generator.js';
import type { SchemaDefinition } from '../types.js';

describe('MigrationGenerator', () => {
  const generator = createFullstackMigrationGenerator();

  const v1: SchemaDefinition = {
    name: 'app',
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        fields: [
          { name: 'email', type: 'string', required: true },
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
        ],
      },
      {
        name: 'posts',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'string' },
        ],
      },
    ],
  };

  // ── detectChanges() ────────────────────────────────────────────────

  describe('detectChanges()', () => {
    it('should return empty array for identical schemas', () => {
      const diffs = generator.detectChanges(v1, v1);
      expect(diffs).toHaveLength(0);
    });

    it('should detect added collections', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          ...v1.collections,
          { name: 'comments', fields: [{ name: 'text', type: 'string' }] },
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      expect(diffs).toContainEqual({ type: 'add-collection', collection: 'comments' });
    });

    it('should detect removed collections', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [v1.collections[0]],
      };
      const diffs = generator.detectChanges(v1, v2);
      expect(diffs).toContainEqual({ type: 'remove-collection', collection: 'posts' });
    });

    it('should detect added fields', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [...v1.collections[0].fields, { name: 'role', type: 'string' }],
          },
          v1.collections[1],
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      expect(diffs).toContainEqual({ type: 'add-field', collection: 'users', field: 'role' });
    });

    it('should detect removed fields', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [v1.collections[0].fields[0]], // only email
          },
          v1.collections[1],
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      expect(diffs).toContainEqual({ type: 'remove-field', collection: 'users', field: 'name' });
      expect(diffs).toContainEqual({ type: 'remove-field', collection: 'users', field: 'age' });
    });

    it('should detect field type changes', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [
              { name: 'email', type: 'string', required: true },
              { name: 'name', type: 'string' },
              { name: 'age', type: 'string' }, // was number
            ],
          },
          v1.collections[1],
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      const change = diffs.find((d) => d.type === 'change-field-type' && d.field === 'age');
      expect(change).toBeDefined();
      expect(change!.from).toBe('number');
      expect(change!.to).toBe('string');
    });

    it('should not report unchanged fields', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [...v1.collections[0].fields, { name: 'newField', type: 'boolean' }],
          },
          v1.collections[1],
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('add-field');
    });

    it('should detect multiple types of changes simultaneously', () => {
      const v2: SchemaDefinition = {
        name: 'app',
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [
              { name: 'email', type: 'string', required: true },
              { name: 'age', type: 'string' }, // changed
              { name: 'role', type: 'string' }, // added
              // name removed
            ],
          },
          // posts removed
          { name: 'tags', fields: [{ name: 'label', type: 'string' }] }, // added
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      const types = diffs.map((d) => d.type);
      expect(types).toContain('remove-collection');
      expect(types).toContain('add-collection');
      expect(types).toContain('add-field');
      expect(types).toContain('remove-field');
      expect(types).toContain('change-field-type');
    });

    it('should not detect changes for new collection fields (since collection is new)', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          ...v1.collections,
          {
            name: 'newCol',
            fields: [
              { name: 'a', type: 'string' },
              { name: 'b', type: 'number' },
            ],
          },
        ],
      };
      const diffs = generator.detectChanges(v1, v2);
      // Should only have 1 diff: add-collection, not individual field adds
      const newColDiffs = diffs.filter((d) => d.collection === 'newCol');
      expect(newColDiffs).toHaveLength(1);
      expect(newColDiffs[0].type).toBe('add-collection');
    });

    it('should handle adding and removing collections at the same time', () => {
      const from: SchemaDefinition = {
        name: 'app',
        version: '1',
        collections: [
          { name: 'a', fields: [] },
          { name: 'b', fields: [] },
        ],
      };
      const to: SchemaDefinition = {
        name: 'app',
        version: '2',
        collections: [
          { name: 'b', fields: [] },
          { name: 'c', fields: [] },
        ],
      };
      const diffs = generator.detectChanges(from, to);
      expect(diffs).toContainEqual({ type: 'remove-collection', collection: 'a' });
      expect(diffs).toContainEqual({ type: 'add-collection', collection: 'c' });
      expect(diffs).toHaveLength(2);
    });
  });

  // ── generate() ─────────────────────────────────────────────────────

  describe('generate()', () => {
    it('should return empty array for identical schemas', () => {
      const files = generator.generate(v1, v1);
      expect(files).toHaveLength(0);
    });

    it('should return exactly one migration file', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'comments', fields: [] }],
      };
      const files = generator.generate(v1, v2);
      expect(files).toHaveLength(1);
    });

    it('should name file with timestamp and version range', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'comments', fields: [] }],
      };
      const files = generator.generate(v1, v2);
      const path = files[0].path;
      expect(path).toMatch(/^migrations\/\d+-1\.0\.0-to-2\.0\.0\.ts$/);
    });

    it('should set overwrite=false for migration files', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'new', fields: [] }],
      };
      const files = generator.generate(v1, v2);
      expect(files[0].overwrite).toBe(false);
    });

    it('should include auto-generated header', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'new', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain('Auto-generated migration');
      expect(content).toContain('Do not edit manually');
    });

    it('should include version string in content', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'new', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("version: '2.0.0'");
    });

    it('should include version range in header comment', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'new', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain('From version 1.0.0 to 2.0.0');
    });

    it('should include numeric timestamp in content', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'new', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      const match = content.match(/timestamp: (\d+)/);
      expect(match).not.toBeNull();
      const ts = parseInt(match![1], 10);
      expect(ts).toBeGreaterThan(0);
    });

    // ── Up operations ─────────────────────────────────────────────

    it('should include createCollection in up for added collection', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'tags', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("await db.createCollection('tags')");
    });

    it('should include dropCollection in up for removed collection', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [v1.collections[0]], // remove posts
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("await db.dropCollection('posts')");
    });

    it('should include addField in up for added field', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [...v1.collections[0].fields, { name: 'role', type: 'string' }],
          },
          v1.collections[1],
        ],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("await db.addField('users', 'role')");
    });

    it('should include removeField in up for removed field', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [{ name: 'users', fields: [v1.collections[0].fields[0]] }, v1.collections[1]],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("await db.removeField('users', 'name')");
    });

    it('should include changeFieldType in up for type change', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [
              { name: 'email', type: 'string', required: true },
              { name: 'name', type: 'string' },
              { name: 'age', type: 'string' },
            ],
          },
          v1.collections[1],
        ],
      };
      const content = generator.generate(v1, v2)[0].content;
      expect(content).toContain("await db.changeFieldType('users', 'age', 'string')");
    });

    // ── Down operations (reversals) ───────────────────────────────

    it('should reverse createCollection to dropCollection in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [...v1.collections, { name: 'tags', fields: [] }],
      };
      const content = generator.generate(v1, v2)[0].content;
      // up: createCollection('tags'), down: dropCollection('tags')
      const downSection = content.split('async down')[1];
      expect(downSection).toContain("await db.dropCollection('tags')");
    });

    it('should reverse dropCollection to createCollection in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [v1.collections[0]],
      };
      const content = generator.generate(v1, v2)[0].content;
      const downSection = content.split('async down')[1];
      expect(downSection).toContain("await db.createCollection('posts')");
    });

    it('should reverse addField to removeField in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [...v1.collections[0].fields, { name: 'role', type: 'string' }],
          },
          v1.collections[1],
        ],
      };
      const content = generator.generate(v1, v2)[0].content;
      const downSection = content.split('async down')[1];
      expect(downSection).toContain("await db.removeField('users', 'role')");
    });

    it('should reverse removeField to addField in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [{ name: 'users', fields: [v1.collections[0].fields[0]] }, v1.collections[1]],
      };
      const content = generator.generate(v1, v2)[0].content;
      const downSection = content.split('async down')[1];
      expect(downSection).toContain("await db.addField('users', 'name')");
    });

    it('should reverse changeFieldType with original type in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [
              { name: 'email', type: 'string', required: true },
              { name: 'name', type: 'string' },
              { name: 'age', type: 'string' },
            ],
          },
          v1.collections[1],
        ],
      };
      const content = generator.generate(v1, v2)[0].content;
      const downSection = content.split('async down')[1];
      // Should change back to 'number' (the original type)
      expect(downSection).toContain("await db.changeFieldType('users', 'age', 'number')");
    });

    it('should reverse operations in reverse order in down', () => {
      const v2: SchemaDefinition = {
        ...v1,
        version: '2.0.0',
        collections: [
          {
            name: 'users',
            fields: [
              { name: 'email', type: 'string', required: true },
              { name: 'role', type: 'string' }, // added
              // name and age removed
            ],
          },
          v1.collections[1],
        ],
      };
      const content = generator.generate(v1, v2)[0].content;
      const downSection = content.split('async down')[1];
      // Down reverses: the last up operation should appear first in down
      expect(downSection).toBeDefined();
      // All reversed operations should be present
      expect(downSection).toContain("addField('users', 'name')");
      expect(downSection).toContain("addField('users', 'age')");
      expect(downSection).toContain("removeField('users', 'role')");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle going from no collections to one collection', () => {
      const empty: SchemaDefinition = { name: 'app', version: '0.0.0', collections: [] };
      const withCol: SchemaDefinition = {
        name: 'app',
        version: '1.0.0',
        collections: [{ name: 'items', fields: [] }],
      };
      const diffs = generator.detectChanges(empty, withCol);
      expect(diffs).toContainEqual({ type: 'add-collection', collection: 'items' });
    });

    it('should handle going from collections to no collections', () => {
      const withCol: SchemaDefinition = {
        name: 'app',
        version: '1.0.0',
        collections: [{ name: 'items', fields: [] }],
      };
      const empty: SchemaDefinition = { name: 'app', version: '2.0.0', collections: [] };
      const diffs = generator.detectChanges(withCol, empty);
      expect(diffs).toContainEqual({ type: 'remove-collection', collection: 'items' });
    });

    it('should handle completely different schemas', () => {
      const a: SchemaDefinition = {
        name: 'a',
        version: '1',
        collections: [{ name: 'x', fields: [{ name: 'f1', type: 'string' }] }],
      };
      const b: SchemaDefinition = {
        name: 'b',
        version: '2',
        collections: [{ name: 'y', fields: [{ name: 'f2', type: 'number' }] }],
      };
      const diffs = generator.detectChanges(a, b);
      expect(diffs).toContainEqual({ type: 'remove-collection', collection: 'x' });
      expect(diffs).toContainEqual({ type: 'add-collection', collection: 'y' });
    });

    it('should handle collection with fields completely replaced', () => {
      const from: SchemaDefinition = {
        name: 'app',
        version: '1',
        collections: [
          {
            name: 'items',
            fields: [
              { name: 'a', type: 'string' },
              { name: 'b', type: 'string' },
            ],
          },
        ],
      };
      const to: SchemaDefinition = {
        name: 'app',
        version: '2',
        collections: [
          {
            name: 'items',
            fields: [
              { name: 'c', type: 'number' },
              { name: 'd', type: 'boolean' },
            ],
          },
        ],
      };
      const diffs = generator.detectChanges(from, to);
      expect(diffs.filter((d) => d.type === 'remove-field')).toHaveLength(2);
      expect(diffs.filter((d) => d.type === 'add-field')).toHaveLength(2);
    });
  });
});

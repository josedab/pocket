import { describe, expect, it } from 'vitest';
import { createFullstackCodeGenerator } from '../index.js';
import type { SchemaDefinition } from '../types.js';

describe('createFullstackCodeGenerator (pipeline)', () => {
  const schema: SchemaDefinition = {
    name: 'my-app',
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        fields: [
          { name: 'email', type: 'string', required: true },
          { name: 'name', type: 'string' },
        ],
        timestamps: true,
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

  // ── Target: typescript ─────────────────────────────────────────────

  describe('target: typescript', () => {
    const gen = createFullstackCodeGenerator({
      schema,
      outputDir: 'out',
      targets: ['typescript'],
    });

    it('should generate types.ts prefixed with outputDir', () => {
      const result = gen.generate(schema);
      expect(result.files.some((f) => f.path === 'out/types.ts')).toBe(true);
    });

    it('should contain all collection interfaces', () => {
      const result = gen.generate(schema);
      const typesFile = result.files.find((f) => f.path === 'out/types.ts')!;
      expect(typesFile.content).toContain('export interface Users');
      expect(typesFile.content).toContain('export interface Posts');
    });
  });

  // ── Target: react-hooks ────────────────────────────────────────────

  describe('target: react-hooks', () => {
    const gen = createFullstackCodeGenerator({
      schema,
      outputDir: 'gen',
      targets: ['react-hooks'],
    });

    it('should generate hook files prefixed with outputDir', () => {
      const result = gen.generate(schema);
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('gen/hooks/useUsers.ts');
      expect(paths).toContain('gen/hooks/usePosts.ts');
    });
  });

  // ── Target: api-routes ─────────────────────────────────────────────

  describe('target: api-routes (express)', () => {
    const gen = createFullstackCodeGenerator({
      schema,
      outputDir: 'src',
      targets: ['api-routes'],
      framework: 'express',
    });

    it('should generate route files prefixed with outputDir', () => {
      const result = gen.generate(schema);
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('src/routes/users.ts');
      expect(paths).toContain('src/routes/posts.ts');
    });
  });

  describe('target: api-routes (next)', () => {
    const gen = createFullstackCodeGenerator({
      schema,
      outputDir: 'src',
      targets: ['api-routes'],
      framework: 'next',
    });

    it('should generate Next.js route files prefixed with outputDir', () => {
      const result = gen.generate(schema);
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('src/app/api/users/route.ts');
      expect(paths).toContain('src/app/api/posts/route.ts');
    });
  });

  // ── Target: validation ─────────────────────────────────────────────

  describe('target: validation', () => {
    const gen = createFullstackCodeGenerator({
      schema,
      outputDir: 'generated',
      targets: ['validation'],
    });

    it('should generate validation.ts prefixed with outputDir', () => {
      const result = gen.generate(schema);
      expect(result.files.some((f) => f.path === 'generated/validation.ts')).toBe(true);
    });
  });

  // ── Multiple targets ───────────────────────────────────────────────

  describe('multiple targets', () => {
    it('should generate files for all specified targets', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript', 'react-hooks', 'api-routes', 'validation'],
        framework: 'express',
      });
      const result = gen.generate(schema);
      const paths = result.files.map((f) => f.path);

      // typescript
      expect(paths.some((p) => p.endsWith('types.ts'))).toBe(true);
      // hooks
      expect(paths.some((p) => p.includes('hooks/'))).toBe(true);
      // routes
      expect(paths.some((p) => p.includes('routes/'))).toBe(true);
      // validation
      expect(paths.some((p) => p.endsWith('validation.ts'))).toBe(true);
    });

    it('should produce correct file count for all targets', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript', 'react-hooks', 'api-routes', 'validation'],
        framework: 'express',
      });
      const result = gen.generate(schema);
      // 1 types + 2 hooks + 2 routes + 1 validation = 6
      expect(result.files).toHaveLength(6);
    });
  });

  // ── Empty / single target ──────────────────────────────────────────

  describe('empty and single targets', () => {
    it('should produce no files for empty targets array', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: [],
      });
      const result = gen.generate(schema);
      expect(result.files).toHaveLength(0);
    });

    it('should only generate typescript files when only typescript target', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const result = gen.generate(schema);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('out/types.ts');
    });
  });

  // ── Input formats ──────────────────────────────────────────────────

  describe('input formats', () => {
    it('should accept SchemaDefinition object as input', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const result = gen.generate(schema);
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('should accept JSON string as input', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const result = gen.generate(JSON.stringify(schema));
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].content).toContain('export interface');
    });
  });

  // ── Validation warnings ────────────────────────────────────────────

  describe('validation and warnings', () => {
    it('should return empty warnings for valid schema', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const result = gen.generate(schema);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return warnings for schema with empty name', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const invalid: SchemaDefinition = { name: '', version: '1', collections: [] };
      const result = gen.generate(invalid);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should return warnings for schema with missing version', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const invalid: SchemaDefinition = { name: 'x', version: '', collections: [] };
      const result = gen.generate(invalid);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should return warnings for schema with no collections', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['typescript'],
      });
      const invalid: SchemaDefinition = { name: 'x', version: '1', collections: [] };
      const result = gen.generate(invalid);
      expect(result.warnings.some((w) => w.includes('collection'))).toBe(true);
    });
  });

  // ── OutputDir prefixing ────────────────────────────────────────────

  describe('outputDir prefixing', () => {
    it('should prefix all generated file paths with outputDir', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'my/output/dir',
        targets: ['typescript', 'react-hooks', 'api-routes', 'validation'],
        framework: 'express',
      });
      const result = gen.generate(schema);
      for (const file of result.files) {
        expect(file.path.startsWith('my/output/dir/')).toBe(true);
      }
    });
  });

  // ── Complex schema ─────────────────────────────────────────────────

  describe('complex schema', () => {
    const complexSchema: SchemaDefinition = {
      name: 'ecommerce',
      version: '1.0.0',
      collections: [
        {
          name: 'products',
          timestamps: true,
          softDelete: true,
          primaryKey: 'sku',
          fields: [
            { name: 'name', type: 'string', required: true },
            { name: 'price', type: 'number', required: true },
            { name: 'description', type: 'string' },
            { name: 'tags', type: 'array' },
            { name: 'metadata', type: 'object' },
            { name: 'available', type: 'boolean' },
            {
              name: 'category',
              type: 'string',
              relation: { collection: 'categories', type: 'one-to-one' },
            },
            {
              name: 'reviews',
              type: 'string',
              relation: { collection: 'reviews', type: 'one-to-many' },
            },
          ],
        },
        {
          name: 'categories',
          fields: [
            { name: 'label', type: 'string', required: true },
            {
              name: 'parent',
              type: 'string',
              relation: { collection: 'categories', type: 'one-to-one' },
            },
          ],
        },
        {
          name: 'reviews',
          timestamps: true,
          fields: [
            { name: 'rating', type: 'number', required: true },
            { name: 'comment', type: 'string' },
            {
              name: 'author',
              type: 'string',
              relation: { collection: 'users', type: 'one-to-one' },
            },
          ],
        },
        {
          name: 'users',
          timestamps: true,
          softDelete: true,
          fields: [
            { name: 'email', type: 'string', required: true, unique: true },
            {
              name: 'orders',
              type: 'string',
              relation: { collection: 'orders', type: 'one-to-many' },
            },
          ],
        },
        {
          name: 'orders',
          timestamps: true,
          fields: [
            { name: 'total', type: 'number', required: true },
            { name: 'status', type: 'enum', required: true },
            { name: 'items', type: 'array', required: true },
            { name: 'shippingAddress', type: 'object' },
          ],
        },
      ],
    };

    it('should generate all files for a complex multi-collection schema', () => {
      const gen = createFullstackCodeGenerator({
        schema: complexSchema,
        outputDir: 'gen',
        targets: ['typescript', 'react-hooks', 'api-routes', 'validation'],
        framework: 'express',
      });
      const result = gen.generate(complexSchema);

      // 1 types + 5 hooks + 5 routes + 1 validation = 12
      expect(result.files).toHaveLength(12);
      expect(result.warnings).toHaveLength(0);
    });

    it('should correctly generate types for complex schema', () => {
      const gen = createFullstackCodeGenerator({
        schema: complexSchema,
        outputDir: 'gen',
        targets: ['typescript'],
      });
      const result = gen.generate(complexSchema);
      const content = result.files[0].content;

      expect(content).toContain('export interface Products');
      expect(content).toContain('export interface Categories');
      expect(content).toContain('export interface Reviews');
      expect(content).toContain('export interface Users');
      expect(content).toContain('export interface Orders');

      // Custom primary key
      expect(content).toContain('sku: string;');
      // Relations
      expect(content).toContain('category?: Categories;');
      expect(content).toContain('reviews?: Reviews[];');
    });
  });

  // ── Migration target is not handled ────────────────────────────────

  describe('migration target', () => {
    it('should skip migration target gracefully (no crash)', () => {
      const gen = createFullstackCodeGenerator({
        schema,
        outputDir: 'out',
        targets: ['migration' as any],
      });
      const result = gen.generate(schema);
      // migration isn't wired in the switch, so no files
      expect(result.files).toHaveLength(0);
    });
  });
});

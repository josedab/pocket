import { describe, expect, it } from 'vitest';
import { createFullstackSchemaParser } from '../schema-parser.js';
import { createTypeGenerator } from '../type-generator.js';
import { createHooksGenerator } from '../hooks-generator.js';
import { createApiGenerator } from '../api-generator.js';
import { createFullstackMigrationGenerator } from '../migration-generator.js';
import { createFullstackCodeGenerator } from '../index.js';
import type { SchemaDefinition } from '../types.js';

const testSchema: SchemaDefinition = {
  name: 'test-app',
  version: '1.0.0',
  collections: [
    {
      name: 'users',
      fields: [
        { name: 'email', type: 'string', required: true, unique: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
        { name: 'active', type: 'boolean' },
      ],
      timestamps: true,
      softDelete: true,
    },
    {
      name: 'posts',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'content', type: 'string' },
        { name: 'published', type: 'boolean' },
        {
          name: 'author',
          type: 'string',
          relation: { collection: 'users', type: 'one-to-one' },
        },
      ],
      timestamps: true,
    },
  ],
};

describe('codegen-fullstack', () => {
  describe('SchemaParser', () => {
    const parser = createFullstackSchemaParser();

    it('should parse a JSON string into SchemaDefinition', () => {
      const result = parser.parse(JSON.stringify(testSchema));
      expect(result.name).toBe('test-app');
      expect(result.collections).toHaveLength(2);
    });

    it('should parse an object directly', () => {
      const result = parser.parse(testSchema);
      expect(result.name).toBe('test-app');
      expect(result.version).toBe('1.0.0');
    });

    it('should validate a valid schema', () => {
      const result = parser.validate(testSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing name', () => {
      const invalid = { ...testSchema, name: '' };
      const result = parser.validate(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('should detect missing version', () => {
      const invalid = { ...testSchema, version: '' };
      const result = parser.validate(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('version'))).toBe(true);
    });

    it('should detect empty collections', () => {
      const invalid = { ...testSchema, collections: [] };
      const result = parser.validate(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('collection'))).toBe(true);
    });

    it('should detect duplicate collection names', () => {
      const invalid = {
        ...testSchema,
        collections: [testSchema.collections[0], testSchema.collections[0]],
      };
      const result = parser.validate(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('should normalize schema with defaults', () => {
      const normalized = parser.normalize(testSchema);
      expect(normalized.collections[0].primaryKey).toBe('_id');
      expect(normalized.collections[0].timestamps).toBe(true);
      expect(normalized.collections[0].softDelete).toBe(true);
      expect(normalized.collections[0].fields[0].required).toBe(true);
      expect(normalized.collections[0].fields[2].required).toBe(false);
    });
  });

  describe('TypeGenerator', () => {
    const generator = createTypeGenerator();

    it('should generate TypeScript interfaces', () => {
      const files = generator.generate(testSchema);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('types.ts');

      const content = files[0].content;
      expect(content).toContain('export interface Users');
      expect(content).toContain('export interface Posts');
    });

    it('should generate correct field types', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;

      expect(content).toContain('email: string;');
      expect(content).toContain('age?: number;');
      expect(content).toContain('active?: boolean;');
    });

    it('should mark required fields without optional marker', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;

      // email is required, so no ?
      expect(content).toContain('email: string;');
      expect(content).not.toContain('email?: string;');
    });

    it('should include timestamps when enabled', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;
      expect(content).toContain('createdAt?: Date;');
      expect(content).toContain('updatedAt?: Date;');
    });

    it('should include softDelete field when enabled', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;
      expect(content).toContain('deletedAt?: Date;');
    });

    it('should handle relation fields', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;
      expect(content).toContain('author?: Users;');
    });

    it('should generate validation schemas', () => {
      const files = generator.generateValidation(testSchema);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('validation.ts');

      const content = files[0].content;
      expect(content).toContain('validateUsers');
      expect(content).toContain('validatePosts');
      expect(content).toContain("email is required");
    });
  });

  describe('HooksGenerator', () => {
    const generator = createHooksGenerator();

    it('should generate hook files per collection', () => {
      const files = generator.generate(testSchema);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('hooks/useUsers.ts');
      expect(files[1].path).toBe('hooks/usePosts.ts');
    });

    it('should generate correct hook names', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;

      expect(content).toContain('useUsersQuery');
      expect(content).toContain('useUsersById');
      expect(content).toContain('useUsersMutation');
    });

    it('should include React imports', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;
      expect(content).toContain("import { useState, useEffect, useCallback } from 'react';");
    });

    it('should generate CRUD operations in mutation hook', () => {
      const files = generator.generate(testSchema);
      const content = files[0].content;

      expect(content).toContain('const create = useCallback');
      expect(content).toContain('const update = useCallback');
      expect(content).toContain('const remove = useCallback');
      expect(content).toContain("method: 'POST'");
      expect(content).toContain("method: 'PATCH'");
      expect(content).toContain("method: 'DELETE'");
    });
  });

  describe('ApiGenerator', () => {
    it('should generate express route files per collection', () => {
      const generator = createApiGenerator({ framework: 'express' });
      const files = generator.generate(testSchema);

      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('routes/users.ts');
      expect(files[1].path).toBe('routes/posts.ts');
    });

    it('should generate CRUD endpoints', () => {
      const generator = createApiGenerator({ framework: 'express' });
      const files = generator.generate(testSchema);
      const content = files[0].content;

      expect(content).toContain("router.get('/'");
      expect(content).toContain("router.get('/:id'");
      expect(content).toContain("router.post('/'");
      expect(content).toContain("router.patch('/:id'");
      expect(content).toContain("router.delete('/:id'");
    });

    it('should include validation for required fields', () => {
      const generator = createApiGenerator({ framework: 'express' });
      const files = generator.generate(testSchema);
      const content = files[0].content;

      expect(content).toContain("email is required");
      expect(content).toContain("name is required");
    });

    it('should generate Next.js routes when configured', () => {
      const generator = createApiGenerator({ framework: 'next' });
      const files = generator.generate(testSchema);

      expect(files[0].path).toBe('app/api/users/route.ts');
      expect(files[0].content).toContain('NextRequest');
      expect(files[0].content).toContain('NextResponse');
    });

    it('should default to express framework', () => {
      const generator = createApiGenerator();
      const files = generator.generate(testSchema);
      expect(files[0].content).toContain('Router');
    });
  });

  describe('MigrationGenerator', () => {
    const generator = createFullstackMigrationGenerator();

    const schemaV2: SchemaDefinition = {
      name: 'test-app',
      version: '2.0.0',
      collections: [
        {
          name: 'users',
          fields: [
            { name: 'email', type: 'string', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'string' }, // type changed: number -> string
            { name: 'role', type: 'string' }, // new field
            // 'active' field removed
          ],
        },
        {
          name: 'comments', // new collection
          fields: [
            { name: 'text', type: 'string', required: true },
          ],
        },
        // 'posts' collection removed
      ],
    };

    it('should detect added collections', () => {
      const diffs = generator.detectChanges(testSchema, schemaV2);
      expect(diffs.some((d) => d.type === 'add-collection' && d.collection === 'comments')).toBe(true);
    });

    it('should detect removed collections', () => {
      const diffs = generator.detectChanges(testSchema, schemaV2);
      expect(diffs.some((d) => d.type === 'remove-collection' && d.collection === 'posts')).toBe(true);
    });

    it('should detect added fields', () => {
      const diffs = generator.detectChanges(testSchema, schemaV2);
      expect(diffs.some((d) => d.type === 'add-field' && d.field === 'role')).toBe(true);
    });

    it('should detect removed fields', () => {
      const diffs = generator.detectChanges(testSchema, schemaV2);
      expect(diffs.some((d) => d.type === 'remove-field' && d.field === 'active')).toBe(true);
    });

    it('should detect field type changes', () => {
      const diffs = generator.detectChanges(testSchema, schemaV2);
      const typeChange = diffs.find((d) => d.type === 'change-field-type' && d.field === 'age');
      expect(typeChange).toBeDefined();
      expect(typeChange!.from).toBe('number');
      expect(typeChange!.to).toBe('string');
    });

    it('should generate migration files', () => {
      const files = generator.generate(testSchema, schemaV2);
      expect(files).toHaveLength(1);

      const content = files[0].content;
      expect(content).toContain("version: '2.0.0'");
      expect(content).toContain('async up');
      expect(content).toContain('async down');
    });

    it('should return empty array when schemas are identical', () => {
      const files = generator.generate(testSchema, testSchema);
      expect(files).toHaveLength(0);
    });

    it('should include up and down operations', () => {
      const files = generator.generate(testSchema, schemaV2);
      const content = files[0].content;

      expect(content).toContain("createCollection('comments')");
      expect(content).toContain("dropCollection('posts')");
      expect(content).toContain("addField('users', 'role')");
      expect(content).toContain("removeField('users', 'active')");
      expect(content).toContain("changeFieldType('users', 'age', 'string')");
    });
  });

  describe('createFullstackCodeGenerator (full pipeline)', () => {
    it('should generate files for all targets', () => {
      const generator = createFullstackCodeGenerator({
        schema: testSchema,
        outputDir: 'generated',
        targets: ['typescript', 'react-hooks', 'api-routes', 'validation'],
        framework: 'express',
      });

      const result = generator.generate(testSchema);

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.warnings).toHaveLength(0);

      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.includes('types.ts'))).toBe(true);
      expect(paths.some((p) => p.includes('hooks/'))).toBe(true);
      expect(paths.some((p) => p.includes('routes/'))).toBe(true);
      expect(paths.some((p) => p.includes('validation.ts'))).toBe(true);
    });

    it('should prefix all paths with outputDir', () => {
      const generator = createFullstackCodeGenerator({
        schema: testSchema,
        outputDir: 'src/generated',
        targets: ['typescript'],
      });

      const result = generator.generate(testSchema);
      for (const file of result.files) {
        expect(file.path.startsWith('src/generated/')).toBe(true);
      }
    });

    it('should accept JSON string as input', () => {
      const generator = createFullstackCodeGenerator({
        schema: testSchema,
        outputDir: 'out',
        targets: ['typescript'],
      });

      const result = generator.generate(JSON.stringify(testSchema));
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('should report validation warnings for invalid schema', () => {
      const generator = createFullstackCodeGenerator({
        schema: testSchema,
        outputDir: 'out',
        targets: ['typescript'],
      });

      const invalidSchema = { name: '', version: '', collections: [] };
      const result = generator.generate(invalidSchema);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  generateFromContract,
  parseSchemaContract,
  SchemaContractEngine,
} from '../schema-contract-engine.js';

const SAMPLE_SCHEMA = `
version "2.0"

collection users @timestamps @sync {
  name: string @required @desc("Full name")
  email: string @required @unique
  age: number @default(0)
  active: boolean @default(true)
  tags: string[] @index
}

collection posts {
  title: string @required
  body: string
  authorId: string @required @index
  publishedAt: datetime
}
`;

describe('Schema Contract Engine', () => {
  describe('parseSchemaContract', () => {
    it('should parse collections and fields', () => {
      const result = parseSchemaContract(SAMPLE_SCHEMA);
      expect(result.errors).toHaveLength(0);
      expect(result.version).toBe('2.0');
      expect(result.collections).toHaveLength(2);
    });

    it('should parse field directives', () => {
      const result = parseSchemaContract(SAMPLE_SCHEMA);
      const users = result.collections.find((c) => c.name === 'users')!;
      const nameField = users.fields.find((f) => f.name === 'name')!;
      expect(nameField.required).toBe(true);
      expect(nameField.description).toBe('Full name');

      const emailField = users.fields.find((f) => f.name === 'email')!;
      expect(emailField.unique).toBe(true);
      expect(emailField.indexed).toBe(true);

      const ageField = users.fields.find((f) => f.name === 'age')!;
      expect(ageField.defaultValue).toBe(0);
    });

    it('should parse collection options', () => {
      const result = parseSchemaContract(SAMPLE_SCHEMA);
      const users = result.collections.find((c) => c.name === 'users')!;
      expect(users.options.timestamps).toBe(true);
      expect(users.options.sync).toBe(true);
    });

    it('should parse array types', () => {
      const result = parseSchemaContract(SAMPLE_SCHEMA);
      const users = result.collections.find((c) => c.name === 'users')!;
      const tags = users.fields.find((f) => f.name === 'tags')!;
      expect(tags.type).toBe('string[]');
    });

    it('should report errors for invalid syntax', () => {
      const result = parseSchemaContract(`collection bad {\n  invalid line\n}`);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn about empty collections', () => {
      const result = parseSchemaContract(`collection empty {\n}`);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should report unclosed blocks', () => {
      const result = parseSchemaContract(`collection broken {`);
      expect(result.errors.some((e) => e.includes('Unclosed'))).toBe(true);
    });
  });

  describe('generateFromContract', () => {
    it('should generate TypeScript files', () => {
      const parsed = parseSchemaContract(SAMPLE_SCHEMA);
      const output = generateFromContract(parsed);
      expect(output.typesGenerated).toBe(2);
      expect(output.files.length).toBe(2);
    });

    it('should generate correct TypeScript interfaces', () => {
      const parsed = parseSchemaContract(SAMPLE_SCHEMA);
      const output = generateFromContract(parsed);
      const usersFile = output.files.find((f) => f.path === 'users.ts')!;
      expect(usersFile.content).toContain('export interface Users extends Document');
      expect(usersFile.content).toContain('name: string;');
      expect(usersFile.content).toContain('age?: number;');
      expect(usersFile.content).toContain('tags?: string[];');
      expect(usersFile.content).toContain('createdAt: Date;');
    });
  });

  describe('SchemaContractEngine', () => {
    it('should process schema and return combined result', () => {
      const engine = new SchemaContractEngine();
      const result = engine.processSchema(SAMPLE_SCHEMA);
      expect(result.parseResult.errors).toHaveLength(0);
      expect(result.typesGenerated).toBe(2);
      expect(result.files.length).toBe(2);
    });
  });
});

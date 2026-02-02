import { describe, it, expect } from 'vitest';
import { FormGenerator } from '../generators/form-generator.js';
import { APIGenerator } from '../generators/api-generator.js';
import type { CollectionSchema } from '../types.js';

const testSchema: CollectionSchema = {
  name: 'todos',
  fields: {
    title: { type: 'string', required: true },
    completed: { type: 'boolean', default: false },
    priority: {
      type: 'string',
      validation: { enum: ['low', 'medium', 'high'] },
    },
    dueDate: { type: 'date' },
    score: { type: 'number', validation: { min: 0, max: 100 } },
  },
  timestamps: true,
};

describe('FormGenerator', () => {
  const generator = new FormGenerator();

  it('should generate form files for collections', () => {
    const files = generator.generateForms([testSchema]);
    expect(files.length).toBe(2); // form + index
    expect(files[0]!.path).toBe('forms/todos-form.tsx');
    expect(files[1]!.path).toBe('forms/index.ts');
  });

  it('should produce valid React component structure', () => {
    const files = generator.generateForms([testSchema]);
    const form = files[0]!.content;
    expect(form).toContain('export function TodoForm(');
    expect(form).toContain('export interface TodoFormProps');
    expect(form).toContain('useState');
    expect(form).toContain('handleSubmit');
    expect(form).toContain('<form');
  });

  it('should include select element for enum fields', () => {
    const files = generator.generateForms([testSchema]);
    const form = files[0]!.content;
    expect(form).toContain('<select');
    expect(form).toContain('"low"');
    expect(form).toContain('"high"');
  });

  it('should include checkbox for boolean fields', () => {
    const files = generator.generateForms([testSchema]);
    const form = files[0]!.content;
    expect(form).toContain('type="checkbox"');
    expect(form).toContain('completed');
  });

  it('should generate validation for required fields', () => {
    const files = generator.generateForms([testSchema]);
    const form = files[0]!.content;
    expect(form).toContain("title is required");
  });

  it('should generate number validation constraints', () => {
    const files = generator.generateForms([testSchema]);
    const form = files[0]!.content;
    expect(form).toContain('must be at least 0');
    expect(form).toContain('must be at most 100');
  });

  it('should handle multiple collections', () => {
    const second: CollectionSchema = {
      name: 'users',
      fields: { name: { type: 'string', required: true } },
    };
    const files = generator.generateForms([testSchema, second]);
    expect(files.length).toBe(3); // 2 forms + index
    expect(files[2]!.content).toContain('TodoForm');
    expect(files[2]!.content).toContain('UserForm');
  });
});

describe('APIGenerator', () => {
  const generator = new APIGenerator();

  it('should generate route files for collections', () => {
    const files = generator.generateAPI([testSchema]);
    expect(files.length).toBe(2); // routes + index
    expect(files[0]!.path).toBe('api/todos.routes.ts');
    expect(files[1]!.path).toBe('api/index.ts');
  });

  it('should produce CRUD route handlers', () => {
    const files = generator.generateAPI([testSchema]);
    const routes = files[0]!.content;
    expect(routes).toContain('async list(');
    expect(routes).toContain('async getById(');
    expect(routes).toContain('async create(');
    expect(routes).toContain('async update(');
    expect(routes).toContain('async remove(');
  });

  it('should include error handling in each route', () => {
    const files = generator.generateAPI([testSchema]);
    const routes = files[0]!.content;
    expect(routes).toContain('try {');
    expect(routes).toContain('catch (error)');
    expect(routes).toContain('status(500)');
  });

  it('should include input validation', () => {
    const files = generator.generateAPI([testSchema]);
    const routes = files[0]!.content;
    expect(routes).toContain("'Missing id parameter'");
    expect(routes).toContain("'Request body is required'");
  });

  it('should generate registration function in index', () => {
    const files = generator.generateAPI([testSchema]);
    const index = files[1]!.content;
    expect(index).toContain('registerAllRoutes');
    expect(index).toContain("'GET'");
    expect(index).toContain("'POST'");
    expect(index).toContain("'DELETE'");
  });

  it('should handle multiple collections', () => {
    const second: CollectionSchema = {
      name: 'users',
      fields: { name: { type: 'string', required: true } },
    };
    const files = generator.generateAPI([testSchema, second]);
    expect(files.length).toBe(3); // 2 routes + index
    const index = files[2]!.content;
    expect(index).toContain('createTodoRoutes');
    expect(index).toContain('createUserRoutes');
  });
});

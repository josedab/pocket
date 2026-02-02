import { describe, expect, it } from 'vitest';
import { ReactGenerator, createReactGenerator } from '../generators/react-generator.js';
import type { CollectionSchema } from '../types.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const todoSchema: CollectionSchema = {
  name: 'todos',
  description: 'A list of tasks',
  fields: {
    title: { type: 'string', required: true },
    completed: { type: 'boolean', default: false },
    priority: { type: 'number', validation: { min: 1, max: 5 } },
  },
  timestamps: true,
};

const userSchema: CollectionSchema = {
  name: 'users',
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    age: { type: 'number' },
    role: { type: 'string', validation: { enum: ['admin', 'user', 'moderator'] } },
  },
};

// ─── ReactGenerator Tests ─────────────────────────────────────────────────────

describe('ReactGenerator', () => {
  let generator: ReactGenerator;

  it('should be created via factory function', () => {
    generator = createReactGenerator();
    expect(generator).toBeInstanceOf(ReactGenerator);
  });

  describe('generateHooks', () => {
    it('should generate hooks file for a collection', () => {
      generator = createReactGenerator();
      const file = generator.generateHooks(todoSchema);

      expect(file.path).toBe('hooks/useTodo.ts');
      expect(file.type).toBe('hooks');
      expect(file.content).toContain('useTodoQuery');
      expect(file.content).toContain('useTodoDocument');
      expect(file.content).toContain('useTodoMutation');
    });

    it('should include correct imports', () => {
      generator = createReactGenerator();
      const file = generator.generateHooks(todoSchema);

      expect(file.content).toContain("import { useLiveQuery, useDocument, useMutation } from '@pocket/react'");
      expect(file.content).toContain("import type { Todo } from '../types/todos.types.js'");
    });

    it('should generate typed query hook', () => {
      generator = createReactGenerator();
      const file = generator.generateHooks(userSchema);

      expect(file.content).toContain('useUserQuery');
      expect(file.content).toContain('Partial<User>');
      expect(file.content).toContain("useLiveQuery<User>('users'");
    });

    it('should generate typed document hook', () => {
      generator = createReactGenerator();
      const file = generator.generateHooks(todoSchema);

      expect(file.content).toContain('useTodoDocument');
      expect(file.content).toContain('id: string | null');
      expect(file.content).toContain("useDocument<Todo>('todos'");
    });

    it('should generate typed mutation hook', () => {
      generator = createReactGenerator();
      const file = generator.generateHooks(todoSchema);

      expect(file.content).toContain('useTodoMutation');
      expect(file.content).toContain("useMutation<Todo>('todos')");
    });
  });

  describe('generateFormComponent', () => {
    it('should generate form component file', () => {
      generator = createReactGenerator();
      const file = generator.generateFormComponent(todoSchema);

      expect(file.path).toBe('components/TodoForm.tsx');
      expect(file.content).toContain('TodoForm');
      expect(file.content).toContain('TodoFormProps');
    });

    it('should include React import', () => {
      generator = createReactGenerator();
      const file = generator.generateFormComponent(todoSchema);

      expect(file.content).toContain("import React, { useState, useCallback } from 'react'");
    });

    it('should generate form fields for each schema field', () => {
      generator = createReactGenerator();
      const file = generator.generateFormComponent(todoSchema);

      expect(file.content).toContain('htmlFor="title"');
      expect(file.content).toContain('htmlFor="completed"');
      expect(file.content).toContain('htmlFor="priority"');
    });

    it('should use appropriate input types', () => {
      generator = createReactGenerator();
      const file = generator.generateFormComponent(todoSchema);

      expect(file.content).toContain('type="text"');
      expect(file.content).toContain('type="checkbox"');
      expect(file.content).toContain('type="number"');
    });

    it('should include submit and cancel buttons', () => {
      generator = createReactGenerator();
      const file = generator.generateFormComponent(todoSchema);

      expect(file.content).toContain('type="submit"');
      expect(file.content).toContain('onCancel');
    });
  });

  describe('generateListComponent', () => {
    it('should generate list component file', () => {
      generator = createReactGenerator();
      const file = generator.generateListComponent(userSchema);

      expect(file.path).toBe('components/UserList.tsx');
      expect(file.content).toContain('UserList');
      expect(file.content).toContain('UserListProps');
    });

    it('should include sort and filter support', () => {
      generator = createReactGenerator();
      const file = generator.generateListComponent(userSchema);

      expect(file.content).toContain('sortField');
      expect(file.content).toContain('sortDirection');
      expect(file.content).toContain('filterText');
      expect(file.content).toContain('Filter...');
    });

    it('should include table headers for each field', () => {
      generator = createReactGenerator();
      const file = generator.generateListComponent(userSchema);

      expect(file.content).toContain("toggleSort('name')");
      expect(file.content).toContain("toggleSort('email')");
      expect(file.content).toContain("toggleSort('age')");
      expect(file.content).toContain("toggleSort('role')");
    });

    it('should include correct type import', () => {
      generator = createReactGenerator();
      const file = generator.generateListComponent(userSchema);

      expect(file.content).toContain("import type { User } from '../types/users.types.js'");
    });
  });
});

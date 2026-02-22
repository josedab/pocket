import { describe, expect, it } from 'vitest';
import {
  createDSLParser,
  parsePocketSchema,
  schemaToCodegenInput,
} from '../schema-dsl.js';
import type {
  PocketCollectionDef,
  PocketDslSchema,
  SchemaParseResult,
} from '../schema-dsl.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expectSuccess(result: SchemaParseResult): PocketDslSchema {
  expect(result.success).toBe(true);
  expect(result.errors).toHaveLength(0);
  expect(result.schema).toBeDefined();
  return result.schema!;
}

function coll(schema: PocketDslSchema, name: string): PocketCollectionDef {
  const c = schema.collections.find((c) => c.name === name);
  expect(c).toBeDefined();
  return c!;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parsePocketSchema', () => {
  it('parses a single collection', () => {
    const result = parsePocketSchema(`
collection Todos {
  title: string
  completed: boolean
}
`);
    const schema = expectSuccess(result);
    expect(schema.collections).toHaveLength(1);
    const todos = coll(schema, 'Todos');
    expect(todos.fields).toHaveLength(2);
    expect(todos.fields[0].name).toBe('title');
    expect(todos.fields[0].type).toBe('string');
    expect(todos.fields[1].name).toBe('completed');
    expect(todos.fields[1].type).toBe('boolean');
  });

  it('parses multiple collections', () => {
    const result = parsePocketSchema(`
collection Todos {
  title: string
}

collection Notes {
  content: string
}
`);
    const schema = expectSuccess(result);
    expect(schema.collections).toHaveLength(2);
    expect(coll(schema, 'Todos')).toBeDefined();
    expect(coll(schema, 'Notes')).toBeDefined();
  });

  it('parses optional fields', () => {
    const result = parsePocketSchema(`
collection Items {
  name: string
  dueDate?: date
}
`);
    const schema = expectSuccess(result);
    const items = coll(schema, 'Items');
    expect(items.fields[0].optional).toBe(false);
    expect(items.fields[1].optional).toBe(true);
    expect(items.fields[1].type).toBe('date');
  });

  it('parses default values', () => {
    const result = parsePocketSchema(`
collection Config {
  enabled: boolean = true
  count: number = 42
  label: string = "hello"
}
`);
    const schema = expectSuccess(result);
    const cfg = coll(schema, 'Config');
    expect(cfg.fields[0].defaultValue).toBe(true);
    expect(cfg.fields[1].defaultValue).toBe(42);
    expect(cfg.fields[2].defaultValue).toBe('hello');
  });

  it('parses array types', () => {
    const result = parsePocketSchema(`
collection Lists {
  tags: string[]
  scores: number[]
}
`);
    const schema = expectSuccess(result);
    const lists = coll(schema, 'Lists');
    expect(lists.fields[0].isArray).toBe(true);
    expect(lists.fields[0].type).toBe('string[]');
    expect(lists.fields[1].isArray).toBe(true);
    expect(lists.fields[1].type).toBe('number[]');
  });

  it('parses @index directives', () => {
    const result = parsePocketSchema(`
collection Todos {
  title: string
  priority: number
  dueDate?: date

  @index(title)
  @index(priority, dueDate)
}
`);
    const schema = expectSuccess(result);
    const todos = coll(schema, 'Todos');
    expect(todos.indexes).toEqual([['title'], ['priority', 'dueDate']]);
  });

  it('parses @unique directives', () => {
    const result = parsePocketSchema(`
collection Users {
  email: string

  @unique(email)
}
`);
    const schema = expectSuccess(result);
    const users = coll(schema, 'Users');
    expect(users.uniques).toEqual([['email']]);
  });

  it('returns syntax errors with line numbers', () => {
    const result = parsePocketSchema(`
collection Bad {
  broken line
  title: unknowntype
}
`);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    for (const err of result.errors) {
      expect(err.line).toBeGreaterThan(0);
      expect(err.message).toBeTruthy();
    }
  });

  it('parses an empty collection', () => {
    const result = parsePocketSchema(`
collection Empty {
}
`);
    const schema = expectSuccess(result);
    expect(coll(schema, 'Empty').fields).toHaveLength(0);
  });

  it('reports error for unclosed collection', () => {
    const result = parsePocketSchema(`collection Open {
  title: string
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Unclosed'))).toBe(true);
  });

  it('reports error for invalid default value', () => {
    const result = parsePocketSchema(`
collection Bad {
  count: number = abc
}
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Invalid default'))).toBe(true);
  });
});

describe('schemaToCodegenInput', () => {
  it('converts DSL AST to codegen PocketSchema', () => {
    const dsl: PocketDslSchema = {
      collections: [
        {
          name: 'Todos',
          fields: [
            { name: 'title', type: 'string', optional: false, isArray: false },
            { name: 'done', type: 'boolean', optional: false, defaultValue: false, isArray: false },
            { name: 'tags', type: 'string[]', optional: true, isArray: true },
          ],
          indexes: [['title'], ['title', 'done']],
          uniques: [['title']],
        },
      ],
    };

    const schema = schemaToCodegenInput(dsl);
    expect(schema.version).toBe('1.0.0');
    expect(schema.collections).toHaveLength(1);

    const todos = schema.collections[0];
    expect(todos.name).toBe('Todos');

    // Simple field
    expect(todos.fields['title'].type).toBe('string');
    expect(todos.fields['title'].required).toBe(true);
    expect(todos.fields['title'].index).toBe(true);
    expect(todos.fields['title'].unique).toBe(true);

    // Default value
    expect(todos.fields['done'].default).toBe(false);

    // Array field
    expect(todos.fields['tags'].type).toBe('array');
    expect(todos.fields['tags'].items?.type).toBe('string');
    expect(todos.fields['tags'].required).toBe(false);

    // Compound index
    expect(todos.indexes).toEqual([{ fields: ['title', 'done'] }]);
  });
});

describe('createDSLParser', () => {
  it('returns a parser with parse and toCodegenInput', () => {
    const parser = createDSLParser();
    expect(typeof parser.parse).toBe('function');
    expect(typeof parser.toCodegenInput).toBe('function');

    const result = parser.parse(`
collection X {
  name: string
}
`);
    const schema = expectSuccess(result);
    const codegen = parser.toCodegenInput(schema);
    expect(codegen.collections[0].name).toBe('X');
  });
});

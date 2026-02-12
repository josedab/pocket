/**
 * Full-stack code generator that produces a complete application scaffold.
 *
 * Generates in a single pass: TypeScript types, Zod validators, React hooks,
 * REST endpoints, GraphQL schema + resolvers, OpenAPI spec, and database
 * migration scripts — all from a single Pocket schema definition.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, GeneratedFile, PocketSchema, SchemaField } from '../types.js';

// ── Types ─────────────────────────────────────────────────

export interface FullStackGeneratorConfig {
  /** The schema to generate from */
  readonly schema: PocketSchema;
  /** Output directory prefix (default: 'generated') */
  readonly outputDir?: string;
  /** Which layers to generate */
  readonly layers?: {
    /** TypeScript interfaces (default: true) */
    readonly types?: boolean;
    /** Zod runtime validators (default: true) */
    readonly validators?: boolean;
    /** React hooks (default: true) */
    readonly reactHooks?: boolean;
    /** REST API route handlers (default: true) */
    readonly restApi?: boolean;
    /** GraphQL schema + resolvers (default: true) */
    readonly graphql?: boolean;
    /** OpenAPI 3.0 specification (default: true) */
    readonly openapi?: boolean;
    /** Migration scripts (default: true) */
    readonly migrations?: boolean;
  };
}

function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

function toFieldType(field: SchemaField): string {
  switch (field.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'array':
      return `${field.items ? toFieldType(field.items) : 'unknown'}[]`;
    case 'object':
      return 'Record<string, unknown>';
    case 'reference':
      return 'string';
    default:
      return 'unknown';
  }
}

function toGraphQLType(field: SchemaField): string {
  switch (field.type) {
    case 'string':
      return 'String';
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'String';
    case 'array':
      return `[${field.items ? toGraphQLType(field.items) : 'String'}]`;
    case 'object':
      return 'JSON';
    case 'reference':
      return 'ID';
    default:
      return 'String';
  }
}

function toOpenAPIType(field: SchemaField): Record<string, unknown> {
  switch (field.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'array':
      return {
        type: 'array',
        items: field.items ? toOpenAPIType(field.items) : { type: 'string' },
      };
    case 'object':
      return { type: 'object', additionalProperties: true };
    case 'reference':
      return { type: 'string', format: 'uuid' };
    default:
      return { type: 'string' };
  }
}

function toZodType(field: SchemaField): string {
  switch (field.type) {
    case 'string': {
      let z = 'z.string()';
      if (field.validation?.min != null) z += `.min(${field.validation.min})`;
      if (field.validation?.max != null) z += `.max(${field.validation.max})`;
      if (field.validation?.pattern) z += `.regex(/${field.validation.pattern}/)`;
      return z;
    }
    case 'number': {
      let z = 'z.number()';
      if (field.validation?.min != null) z += `.min(${field.validation.min})`;
      if (field.validation?.max != null) z += `.max(${field.validation.max})`;
      return z;
    }
    case 'boolean':
      return 'z.boolean()';
    case 'date':
      return 'z.date()';
    case 'array':
      return `z.array(${field.items ? toZodType(field.items) : 'z.unknown()'})`;
    case 'object':
      return 'z.record(z.unknown())';
    case 'reference':
      return 'z.string()';
    default:
      return 'z.unknown()';
  }
}

// ── FullStackGenerator ────────────────────────────────────

/**
 * Generates a complete application scaffold from a Pocket schema.
 *
 * @example
 * ```typescript
 * const generator = createFullStackGenerator({
 *   schema: mySchema,
 *   layers: { graphql: true, openapi: true },
 * });
 *
 * const files = generator.generate();
 * // files: types.ts, validators.ts, hooks.ts, api/, graphql/, openapi.json, migrations/
 * ```
 */
export class FullStackGenerator {
  private readonly config: Required<FullStackGeneratorConfig>;

  constructor(config: FullStackGeneratorConfig) {
    const defaults = {
      types: true,
      validators: true,
      reactHooks: true,
      restApi: true,
      graphql: true,
      openapi: true,
      migrations: true,
    };
    this.config = {
      schema: config.schema,
      outputDir: config.outputDir ?? 'generated',
      layers: { ...defaults, ...config.layers },
    };
  }

  /** Generate all configured layers and return all files. */
  generate(): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const { layers } = this.config;
    const collections = this.config.schema.collections;

    if (layers.types) files.push(...this.generateTypes(collections));
    if (layers.validators) files.push(...this.generateValidators(collections));
    if (layers.reactHooks) files.push(...this.generateReactHooks(collections));
    if (layers.restApi) files.push(...this.generateRestApi(collections));
    if (layers.graphql) files.push(...this.generateGraphQL(collections));
    if (layers.openapi) files.push(...this.generateOpenAPI(collections));
    if (layers.migrations) files.push(...this.generateMigrations(collections));

    // Index barrel
    files.push(this.generateBarrel(files));

    return files;
  }

  /** Return a summary of what would be generated without generating files. */
  dryRun(): { layerCount: number; fileCount: number; layers: string[] } {
    const files = this.generate();
    const layers = [...new Set(files.map((f) => f.type))];
    return { layerCount: layers.length, fileCount: files.length, layers };
  }

  // ── Layer Generators ────────────────────────────────────

  private generateTypes(collections: CollectionSchema[]): GeneratedFile[] {
    const lines: string[] = ['// Auto-generated by @pocket/codegen — do not edit manually', ''];

    for (const col of collections) {
      const typeName = toPascalCase(col.name);
      if (col.description) lines.push(`/** ${col.description} */`);
      lines.push(`export interface ${typeName} {`);
      lines.push('  _id: string;');

      for (const [name, field] of Object.entries(col.fields)) {
        const optional = field.required ? '' : '?';
        if (field.description) lines.push(`  /** ${field.description} */`);
        lines.push(`  ${name}${optional}: ${toFieldType(field)};`);
      }

      if (col.timestamps) {
        lines.push('  createdAt: Date;');
        lines.push('  updatedAt: Date;');
      }
      if (col.softDelete) {
        lines.push('  _deleted?: boolean;');
      }

      lines.push('}');
      lines.push('');
    }

    return [
      {
        path: `${this.config.outputDir}/types.ts`,
        content: lines.join('\n'),
        type: 'types',
      },
    ];
  }

  private generateValidators(collections: CollectionSchema[]): GeneratedFile[] {
    const lines: string[] = [
      '// Auto-generated by @pocket/codegen — do not edit manually',
      "import { z } from 'zod';",
      '',
    ];

    for (const col of collections) {
      const name = toPascalCase(col.name);
      lines.push(`export const ${name}Schema = z.object({`);
      lines.push('  _id: z.string(),');

      for (const [fieldName, field] of Object.entries(col.fields)) {
        let zodType = toZodType(field);
        if (!field.required) zodType += '.optional()';
        if (field.default !== undefined) zodType += `.default(${JSON.stringify(field.default)})`;
        lines.push(`  ${fieldName}: ${zodType},`);
      }

      if (col.timestamps) {
        lines.push('  createdAt: z.date(),');
        lines.push('  updatedAt: z.date(),');
      }

      lines.push('});');
      lines.push(`export type ${name}Input = z.infer<typeof ${name}Schema>;`);
      lines.push('');
    }

    return [
      {
        path: `${this.config.outputDir}/validators.ts`,
        content: lines.join('\n'),
        type: 'validation',
      },
    ];
  }

  private generateReactHooks(collections: CollectionSchema[]): GeneratedFile[] {
    const imports = collections.map((c) => toPascalCase(c.name));
    const lines: string[] = [
      '// Auto-generated by @pocket/codegen — do not edit manually',
      "import { useLiveQuery, useCollection } from '@pocket/react';",
      `import type { ${imports.join(', ')} } from './types';`,
      '',
    ];

    for (const col of collections) {
      const typeName = toPascalCase(col.name);
      const hookName = `use${typeName}s`;
      const singleHook = `use${typeName}`;

      lines.push(`/** Live query hook for ${col.name} collection. */`);
      lines.push(`export function ${hookName}(filter?: Partial<${typeName}>) {`);
      lines.push(`  return useLiveQuery<${typeName}>(`);
      lines.push(
        `    (db) => db.collection<${typeName}>('${col.name}').find$({ filter: filter as Record<string, unknown> }),`
      );
      lines.push(`    [filter],`);
      lines.push('  );');
      lines.push('}');
      lines.push('');

      lines.push(`/** Single document hook for ${col.name} collection. */`);
      lines.push(`export function ${singleHook}(id: string) {`);
      lines.push(`  return useLiveQuery<${typeName}>(`);
      lines.push(
        `    (db) => db.collection<${typeName}>('${col.name}').find$({ filter: { _id: id } }),`
      );
      lines.push(`    [id],`);
      lines.push('  );');
      lines.push('}');
      lines.push('');

      lines.push(`/** Collection accessor for ${col.name}. */`);
      lines.push(`export function use${typeName}Collection() {`);
      lines.push(`  return useCollection<${typeName}>('${col.name}');`);
      lines.push('}');
      lines.push('');
    }

    return [
      {
        path: `${this.config.outputDir}/hooks.ts`,
        content: lines.join('\n'),
        type: 'hooks',
      },
    ];
  }

  private generateRestApi(collections: CollectionSchema[]): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    for (const col of collections) {
      const typeName = toPascalCase(col.name);
      const lines: string[] = [
        '// Auto-generated by @pocket/codegen — do not edit manually',
        `import type { ${typeName} } from '../types';`,
        `import { ${typeName}Schema } from '../validators';`,
        '',
        `export const ${col.name}Routes = {`,
        `  /** GET /${col.name} */`,
        `  async list(req: { query?: { limit?: number; offset?: number; filter?: string } }) {`,
        `    const limit = req.query?.limit ?? 50;`,
        `    const offset = req.query?.offset ?? 0;`,
        `    return { collection: '${col.name}', limit, offset };`,
        '  },',
        '',
        `  /** GET /${col.name}/:id */`,
        `  async getById(req: { params: { id: string } }) {`,
        `    return { collection: '${col.name}', id: req.params.id };`,
        '  },',
        '',
        `  /** POST /${col.name} */`,
        `  async create(req: { body: unknown }) {`,
        `    const validated = ${typeName}Schema.parse(req.body);`,
        `    return { collection: '${col.name}', data: validated, created: true };`,
        '  },',
        '',
        `  /** PUT /${col.name}/:id */`,
        `  async update(req: { params: { id: string }; body: unknown }) {`,
        `    const validated = ${typeName}Schema.partial().parse(req.body);`,
        `    return { collection: '${col.name}', id: req.params.id, data: validated, updated: true };`,
        '  },',
        '',
        `  /** DELETE /${col.name}/:id */`,
        `  async delete(req: { params: { id: string } }) {`,
        `    return { collection: '${col.name}', id: req.params.id, deleted: true };`,
        '  },',
        '};',
      ];

      files.push({
        path: `${this.config.outputDir}/api/${col.name}.routes.ts`,
        content: lines.join('\n'),
        type: 'crud',
      });
    }

    return files;
  }

  private generateGraphQL(collections: CollectionSchema[]): GeneratedFile[] {
    // Schema SDL
    const schemaLines: string[] = [
      '# Auto-generated by @pocket/codegen — do not edit manually',
      'scalar JSON',
      'scalar DateTime',
      '',
    ];

    const queryFields: string[] = [];
    const mutationFields: string[] = [];

    for (const col of collections) {
      const typeName = toPascalCase(col.name);
      schemaLines.push(`type ${typeName} {`);
      schemaLines.push('  _id: ID!');

      for (const [name, field] of Object.entries(col.fields)) {
        const gqlType = toGraphQLType(field);
        const required = field.required ? '!' : '';
        schemaLines.push(`  ${name}: ${gqlType}${required}`);
      }

      if (col.timestamps) {
        schemaLines.push('  createdAt: DateTime!');
        schemaLines.push('  updatedAt: DateTime!');
      }

      schemaLines.push('}');
      schemaLines.push('');

      schemaLines.push(`input ${typeName}Input {`);
      for (const [name, field] of Object.entries(col.fields)) {
        const gqlType = toGraphQLType(field);
        schemaLines.push(`  ${name}: ${gqlType}`);
      }
      schemaLines.push('}');
      schemaLines.push('');

      queryFields.push(`  ${col.name}(limit: Int, offset: Int, filter: JSON): [${typeName}!]!`);
      queryFields.push(`  ${col.name}ById(id: ID!): ${typeName}`);
      mutationFields.push(`  create${typeName}(input: ${typeName}Input!): ${typeName}!`);
      mutationFields.push(`  update${typeName}(id: ID!, input: ${typeName}Input!): ${typeName}!`);
      mutationFields.push(`  delete${typeName}(id: ID!): Boolean!`);
    }

    schemaLines.push('type Query {');
    schemaLines.push(...queryFields);
    schemaLines.push('}');
    schemaLines.push('');
    schemaLines.push('type Mutation {');
    schemaLines.push(...mutationFields);
    schemaLines.push('}');

    // Resolver stubs
    const resolverLines: string[] = [
      '// Auto-generated by @pocket/codegen — do not edit manually',
      '',
      'export const resolvers = {',
      '  Query: {',
    ];

    for (const col of collections) {
      resolverLines.push(
        `    ${col.name}: async (_: unknown, args: { limit?: number; offset?: number }) => {`
      );
      resolverLines.push(`      // TODO: implement ${col.name} query`);
      resolverLines.push(`      return [];`);
      resolverLines.push('    },');
      resolverLines.push(`    ${col.name}ById: async (_: unknown, args: { id: string }) => {`);
      resolverLines.push(`      // TODO: implement ${col.name}ById query`);
      resolverLines.push(`      return null;`);
      resolverLines.push('    },');
    }

    resolverLines.push('  },');
    resolverLines.push('  Mutation: {');

    for (const col of collections) {
      const typeName = toPascalCase(col.name);
      resolverLines.push(
        `    create${typeName}: async (_: unknown, args: { input: unknown }) => {`
      );
      resolverLines.push(`      // TODO: implement create${typeName}`);
      resolverLines.push(`      return { _id: 'new', ...args.input as Record<string, unknown> };`);
      resolverLines.push('    },');
      resolverLines.push(
        `    update${typeName}: async (_: unknown, args: { id: string; input: unknown }) => {`
      );
      resolverLines.push(`      // TODO: implement update${typeName}`);
      resolverLines.push(
        `      return { _id: args.id, ...args.input as Record<string, unknown> };`
      );
      resolverLines.push('    },');
      resolverLines.push(`    delete${typeName}: async (_: unknown, args: { id: string }) => {`);
      resolverLines.push(`      // TODO: implement delete${typeName}`);
      resolverLines.push(`      return true;`);
      resolverLines.push('    },');
    }

    resolverLines.push('  },');
    resolverLines.push('};');

    return [
      {
        path: `${this.config.outputDir}/graphql/schema.graphql`,
        content: schemaLines.join('\n'),
        type: 'types',
      },
      {
        path: `${this.config.outputDir}/graphql/resolvers.ts`,
        content: resolverLines.join('\n'),
        type: 'crud',
      },
    ];
  }

  private generateOpenAPI(collections: CollectionSchema[]): GeneratedFile[] {
    const paths: Record<string, unknown> = {};
    const schemas: Record<string, unknown> = {};

    for (const col of collections) {
      const typeName = toPascalCase(col.name);

      // Schema object
      const properties: Record<string, unknown> = { _id: { type: 'string', format: 'uuid' } };
      const required: string[] = ['_id'];

      for (const [name, field] of Object.entries(col.fields)) {
        properties[name] = toOpenAPIType(field);
        if (field.required) required.push(name);
      }

      if (col.timestamps) {
        properties.createdAt = { type: 'string', format: 'date-time' };
        properties.updatedAt = { type: 'string', format: 'date-time' };
        required.push('createdAt', 'updatedAt');
      }

      schemas[typeName] = { type: 'object', properties, required };

      // Paths
      paths[`/${col.name}`] = {
        get: {
          summary: `List ${col.name}`,
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: `List of ${col.name}`,
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: `#/components/schemas/${typeName}` } },
                },
              },
            },
          },
        },
        post: {
          summary: `Create a ${typeName}`,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${typeName}` } },
            },
          },
          responses: { '201': { description: `Created ${typeName}` } },
        },
      };

      paths[`/${col.name}/{id}`] = {
        get: {
          summary: `Get ${typeName} by ID`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: typeName,
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${typeName}` } },
              },
            },
            '404': { description: 'Not found' },
          },
        },
        put: {
          summary: `Update ${typeName}`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${typeName}` } },
            },
          },
          responses: { '200': { description: `Updated ${typeName}` } },
        },
        delete: {
          summary: `Delete ${typeName}`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Deleted' } },
        },
      };
    }

    const spec = {
      openapi: '3.0.3',
      info: {
        title: 'Pocket API',
        version: this.config.schema.version,
        description: 'Auto-generated API from Pocket schema',
      },
      paths,
      components: { schemas },
    };

    return [
      {
        path: `${this.config.outputDir}/openapi.json`,
        content: JSON.stringify(spec, null, 2),
        type: 'types',
      },
    ];
  }

  private generateMigrations(collections: CollectionSchema[]): GeneratedFile[] {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const lines: string[] = [
      '// Auto-generated by @pocket/codegen — do not edit manually',
      `// Migration: ${timestamp}_initial_schema`,
      '',
      'export const migration = {',
      `  version: '${this.config.schema.version}',`,
      `  name: 'initial_schema',`,
      `  timestamp: '${new Date().toISOString()}',`,
      '',
      '  async up(db: { createCollection: (name: string, options?: unknown) => Promise<void> }) {',
    ];

    for (const col of collections) {
      const indexes =
        col.indexes
          ?.map(
            (idx) => `{ fields: ${JSON.stringify(idx.fields)}, unique: ${idx.unique ?? false} }`
          )
          .join(', ') ?? '';
      lines.push(
        `    await db.createCollection('${col.name}'${indexes ? `, { indexes: [${indexes}] }` : ''});`
      );
    }

    lines.push('  },');
    lines.push('');
    lines.push('  async down(db: { dropCollection: (name: string) => Promise<void> }) {');

    for (const col of [...collections].reverse()) {
      lines.push(`    await db.dropCollection('${col.name}');`);
    }

    lines.push('  },');
    lines.push('};');

    return [
      {
        path: `${this.config.outputDir}/migrations/${timestamp}_initial_schema.ts`,
        content: lines.join('\n'),
        type: 'migration',
      },
    ];
  }

  private generateBarrel(files: GeneratedFile[]): GeneratedFile {
    const exports: string[] = ['// Auto-generated by @pocket/codegen — do not edit manually', ''];

    const tsFiles = files.filter(
      (f) =>
        f.path.endsWith('.ts') &&
        !f.path.includes('/api/') &&
        !f.path.includes('/graphql/') &&
        !f.path.includes('/migrations/')
    );
    for (const file of tsFiles) {
      const rel = file.path.replace(`${this.config.outputDir}/`, './').replace(/\.ts$/, '');
      exports.push(`export * from '${rel}';`);
    }

    return {
      path: `${this.config.outputDir}/index.ts`,
      content: exports.join('\n'),
      type: 'index',
    };
  }
}

/**
 * Create a FullStackGenerator.
 */
export function createFullStackGenerator(config: FullStackGeneratorConfig): FullStackGenerator {
  return new FullStackGenerator(config);
}

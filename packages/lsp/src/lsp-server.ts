/**
 * Pocket LSP — Language Server Protocol implementation for
 * pocket.config.ts with schema-aware completions, diagnostics,
 * and hover documentation.
 */

/** A parsed collection from pocket.config.ts. */
export interface ParsedCollection {
  readonly name: string;
  readonly fields: readonly ParsedField[];
  readonly indexes?: readonly string[];
}

/** A parsed field definition. */
export interface ParsedField {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly description?: string;
}

/** Parsed pocket config. */
export interface ParsedPocketConfig {
  readonly database: { name: string };
  readonly collections: readonly ParsedCollection[];
}

/** LSP completion item. */
export interface CompletionItem {
  readonly label: string;
  readonly kind: 'collection' | 'field' | 'operator' | 'method' | 'type';
  readonly detail?: string;
  readonly documentation?: string;
  readonly insertText?: string;
}

/** LSP diagnostic. */
export interface Diagnostic {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly source: string;
}

/** LSP hover result. */
export interface HoverResult {
  readonly content: string;
  readonly range?: { startLine: number; endLine: number };
}

// ─── Query Operators ─────────────────────────────────────────────

const QUERY_OPERATORS: CompletionItem[] = [
  {
    label: 'eq',
    kind: 'operator',
    detail: 'Equal to',
    documentation: 'Matches documents where field equals value',
    insertText: '{ eq: }',
  },
  {
    label: 'ne',
    kind: 'operator',
    detail: 'Not equal',
    documentation: 'Matches documents where field does not equal value',
    insertText: '{ ne: }',
  },
  {
    label: 'gt',
    kind: 'operator',
    detail: 'Greater than',
    documentation: 'Matches documents where field is greater than value',
    insertText: '{ gt: }',
  },
  {
    label: 'gte',
    kind: 'operator',
    detail: 'Greater than or equal',
    documentation: 'Matches documents where field is >= value',
    insertText: '{ gte: }',
  },
  {
    label: 'lt',
    kind: 'operator',
    detail: 'Less than',
    documentation: 'Matches documents where field is less than value',
    insertText: '{ lt: }',
  },
  {
    label: 'lte',
    kind: 'operator',
    detail: 'Less than or equal',
    documentation: 'Matches documents where field is <= value',
    insertText: '{ lte: }',
  },
  {
    label: 'in',
    kind: 'operator',
    detail: 'In array',
    documentation: 'Matches if field value is in the provided array',
    insertText: '{ in: [] }',
  },
  {
    label: 'contains',
    kind: 'operator',
    detail: 'String contains',
    documentation: 'Matches if string field contains the substring',
    insertText: '{ contains: "" }',
  },
  {
    label: 'startsWith',
    kind: 'operator',
    detail: 'String starts with',
    documentation: 'Matches if string field starts with prefix',
    insertText: '{ startsWith: "" }',
  },
  {
    label: 'exists',
    kind: 'operator',
    detail: 'Field exists',
    documentation: 'Matches if the field exists (or does not exist)',
    insertText: '{ exists: true }',
  },
];

const COLLECTION_METHODS: CompletionItem[] = [
  {
    label: 'find',
    kind: 'method',
    detail: 'Query documents',
    documentation: 'Find documents matching a filter',
    insertText: 'find({ filter: {} })',
  },
  {
    label: 'find$',
    kind: 'method',
    detail: 'Reactive query',
    documentation: 'Subscribe to live query results',
    insertText: 'find$({ filter: {} })',
  },
  {
    label: 'insert',
    kind: 'method',
    detail: 'Insert document',
    documentation: 'Insert a new document',
    insertText: 'insert({})',
  },
  {
    label: 'update',
    kind: 'method',
    detail: 'Update document',
    documentation: 'Update a document by ID',
    insertText: "update('id', {})",
  },
  {
    label: 'delete',
    kind: 'method',
    detail: 'Delete document',
    documentation: 'Delete a document by ID',
    insertText: "delete('id')",
  },
  {
    label: 'get',
    kind: 'method',
    detail: 'Get by ID',
    documentation: 'Get a document by its ID',
    insertText: "get('id')",
  },
  {
    label: 'count',
    kind: 'method',
    detail: 'Count documents',
    documentation: 'Count documents matching a filter',
    insertText: 'count()',
  },
];

const FIELD_TYPES: CompletionItem[] = [
  { label: 'string', kind: 'type', detail: 'String field type' },
  { label: 'number', kind: 'type', detail: 'Number field type' },
  { label: 'boolean', kind: 'type', detail: 'Boolean field type' },
  { label: 'date', kind: 'type', detail: 'Date field type' },
  { label: 'array', kind: 'type', detail: 'Array field type' },
  { label: 'object', kind: 'type', detail: 'Object/nested field type' },
];

// ─── Schema Symbol Table ─────────────────────────────────────────

export class SchemaSymbolTable {
  private collections: ParsedCollection[] = [];

  /** Load collections from a parsed config. */
  load(config: ParsedPocketConfig): void {
    this.collections = [...config.collections];
  }

  /** Add a single collection. */
  addCollection(collection: ParsedCollection): void {
    this.collections.push(collection);
  }

  /** Get completions at a given context. */
  getCompletions(context: CompletionContext): readonly CompletionItem[] {
    switch (context.type) {
      case 'collection-name':
        return this.collections.map((c) => ({
          label: c.name,
          kind: 'collection' as const,
          detail: `Collection with ${c.fields.length} fields`,
          documentation: `Fields: ${c.fields.map((f) => f.name).join(', ')}`,
          insertText: `'${c.name}'`,
        }));

      case 'field-name': {
        const col = this.collections.find((c) => c.name === context.collection);
        if (!col) return [];
        return col.fields.map((f) => ({
          label: f.name,
          kind: 'field' as const,
          detail: `${f.type}${f.required ? ' (required)' : ''}`,
          documentation: f.description,
          insertText: f.name,
        }));
      }

      case 'operator':
        return QUERY_OPERATORS;

      case 'method':
        return COLLECTION_METHODS;

      case 'field-type':
        return FIELD_TYPES;

      default:
        return [];
    }
  }

  /** Get hover documentation for a symbol. */
  getHover(symbol: string): HoverResult | null {
    // Check if it's a collection name
    const col = this.collections.find((c) => c.name === symbol);
    if (col) {
      const fieldList = col.fields
        .map((f) => `  - \`${f.name}\`: ${f.type}${f.required ? ' (required)' : ''}`)
        .join('\n');
      return {
        content: `**Collection: ${col.name}**\n\nFields:\n${fieldList}`,
      };
    }

    // Check if it's a field name in any collection
    for (const c of this.collections) {
      const field = c.fields.find((f) => f.name === symbol);
      if (field) {
        return {
          content: `**${c.name}.${field.name}**: ${field.type}${field.required ? ' (required)' : ''}\n\n${field.description ?? ''}`,
        };
      }
    }

    // Check operators
    const op = QUERY_OPERATORS.find((o) => o.label === symbol);
    if (op) {
      return { content: `**Operator: ${op.label}**\n\n${op.documentation ?? ''}` };
    }

    return null;
  }

  /** Validate a config and return diagnostics. */
  validate(config: ParsedPocketConfig): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (!config.database?.name) {
      diagnostics.push({
        line: 1,
        column: 1,
        message: 'Missing database.name configuration',
        severity: 'error',
        source: 'pocket-lsp',
      });
    }

    const collectionNames = new Set<string>();
    for (const col of config.collections) {
      if (collectionNames.has(col.name)) {
        diagnostics.push({
          line: 1,
          column: 1,
          message: `Duplicate collection name: "${col.name}"`,
          severity: 'error',
          source: 'pocket-lsp',
        });
      }
      collectionNames.add(col.name);

      if (col.fields.length === 0) {
        diagnostics.push({
          line: 1,
          column: 1,
          message: `Collection "${col.name}" has no fields defined`,
          severity: 'warning',
          source: 'pocket-lsp',
        });
      }

      const fieldNames = new Set<string>();
      for (const field of col.fields) {
        if (fieldNames.has(field.name)) {
          diagnostics.push({
            line: 1,
            column: 1,
            message: `Duplicate field "${field.name}" in collection "${col.name}"`,
            severity: 'error',
            source: 'pocket-lsp',
          });
        }
        fieldNames.add(field.name);

        if (field.name.startsWith('_') && field.name !== '_id') {
          diagnostics.push({
            line: 1,
            column: 1,
            message: `Field "${field.name}" uses reserved prefix "_" in collection "${col.name}"`,
            severity: 'warning',
            source: 'pocket-lsp',
          });
        }
      }
    }

    return diagnostics;
  }

  /** Get all known collection names. */
  getCollectionNames(): readonly string[] {
    return this.collections.map((c) => c.name);
  }
}

/** Context for completion requests. */
export interface CompletionContext {
  readonly type: 'collection-name' | 'field-name' | 'operator' | 'method' | 'field-type';
  readonly collection?: string;
}

export function createSchemaSymbolTable(): SchemaSymbolTable {
  return new SchemaSymbolTable();
}

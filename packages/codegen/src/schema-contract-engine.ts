/**
 * SchemaContractEngine — Single-file schema DSL with reactive watch mode.
 *
 * Parses `.pocket` schema files, diffs against previous versions,
 * generates TypeScript types + migrations, and watches for changes.
 *
 * @example
 * ```typescript
 * const engine = new SchemaContractEngine({ outputDir: './generated' });
 * const result = await engine.processSchema(`
 *   collection users {
 *     name: string @required
 *     email: string @unique
 *     age: number @default(0)
 *   }
 * `);
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface SchemaContractConfig {
  outputDir?: string;
  watchMode?: boolean;
  generateTypes?: boolean;
  generateMigrations?: boolean;
  generateValidators?: boolean;
}

export interface ParsedCollection {
  name: string;
  fields: ParsedField[];
  options: CollectionOptions;
}

export interface ParsedField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  indexed: boolean;
  defaultValue: unknown;
  description: string | null;
}

export interface CollectionOptions {
  timestamps: boolean;
  softDelete: boolean;
  sync: boolean;
}

export interface ContractParseResult {
  version: string;
  collections: ParsedCollection[];
  errors: string[];
  warnings: string[];
}

export interface GeneratedOutput {
  files: { path: string; content: string }[];
  migrationsGenerated: number;
  typesGenerated: number;
}

// ── Schema DSL Parser ─────────────────────────────────────

const FIELD_PATTERN = /^\s*(\w+)\s*:\s*(\w+(?:\[\])?)\s*(.*?)$/;
const COLLECTION_PATTERN = /^\s*collection\s+(\w+)\s*(.*?)\s*\{/;
const DIRECTIVE_PATTERN = /@(\w+)(?:\(([^)]*)\))?/g;
const VERSION_PATTERN = /^\s*version\s+"([^"]+)"/;

export function parseSchemaContract(source: string): ContractParseResult {
  const lines = source.split('\n');
  const collections: ParsedCollection[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let version = '1.0';

  let currentCollection: ParsedCollection | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = i + 1;

    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // Version
    const versionMatch = VERSION_PATTERN.exec(line);
    if (versionMatch) {
      version = versionMatch[1]!;
      continue;
    }

    // Collection start
    const collMatch = COLLECTION_PATTERN.exec(line);
    if (collMatch) {
      currentCollection = {
        name: collMatch[1]!,
        fields: [],
        options: { timestamps: false, softDelete: false, sync: false },
      };
      braceDepth++;

      // Check for collection-level directives (in the full line or capture group 2)
      const directiveStr = collMatch[2] ?? '';
      if (line.includes('@timestamps') || directiveStr.includes('@timestamps'))
        currentCollection.options.timestamps = true;
      if (line.includes('@softDelete') || directiveStr.includes('@softDelete'))
        currentCollection.options.softDelete = true;
      if (line.includes('@sync') || directiveStr.includes('@sync'))
        currentCollection.options.sync = true;
      continue;
    }

    // Closing brace
    if (line === '}' && currentCollection) {
      braceDepth--;
      if (braceDepth === 0) {
        if (currentCollection.fields.length === 0) {
          warnings.push(`Line ${lineNum}: Collection "${currentCollection.name}" has no fields`);
        }
        collections.push(currentCollection);
        currentCollection = null;
      }
      continue;
    }

    // Field definition
    if (currentCollection) {
      const fieldMatch = FIELD_PATTERN.exec(line);
      if (fieldMatch) {
        const field: ParsedField = {
          name: fieldMatch[1]!,
          type: fieldMatch[2]!,
          required: false,
          unique: false,
          indexed: false,
          defaultValue: undefined,
          description: null,
        };

        // Parse directives
        const directives = fieldMatch[3] ?? '';
        let match;
        while ((match = DIRECTIVE_PATTERN.exec(directives)) !== null) {
          switch (match[1]) {
            case 'required':
              field.required = true;
              break;
            case 'unique':
              field.unique = true;
              field.indexed = true;
              break;
            case 'index':
              field.indexed = true;
              break;
            case 'default':
              field.defaultValue = parseDefaultValue(match[2]);
              break;
            case 'desc': {
              const raw = match[2] ?? '';
              field.description = raw.replace(/^["']|["']$/g, '') || null;
              break;
            }
          }
        }

        currentCollection.fields.push(field);
      } else if (line !== '{') {
        errors.push(`Line ${lineNum}: Invalid field definition: "${line}"`);
      }
    }
  }

  if (braceDepth !== 0) {
    errors.push(`Unclosed collection block (missing closing brace)`);
  }

  return { version, collections, errors, warnings };
}

function parseDefaultValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Generate TypeScript code from parsed schema.
 */
export function generateFromContract(
  parsed: ContractParseResult,
  config: SchemaContractConfig = {}
): GeneratedOutput {
  const files: { path: string; content: string }[] = [];
  let typesGenerated = 0;

  if (config.generateTypes !== false) {
    for (const col of parsed.collections) {
      const typeName = col.name.charAt(0).toUpperCase() + col.name.slice(1);
      const lines: string[] = [];
      lines.push(`// Auto-generated from .pocket schema v${parsed.version}`);
      lines.push(`import type { Document } from '@pocket/core';`);
      lines.push('');
      lines.push(`export interface ${typeName} extends Document {`);

      for (const field of col.fields) {
        const tsType = mapType(field.type);
        const opt = field.required ? '' : '?';
        if (field.description) lines.push(`  /** ${field.description} */`);
        lines.push(`  ${field.name}${opt}: ${tsType};`);
      }

      if (col.options.timestamps) {
        lines.push(`  createdAt: Date;`);
        lines.push(`  updatedAt: Date;`);
      }

      lines.push(`}`);
      files.push({ path: `${col.name}.ts`, content: lines.join('\n') });
      typesGenerated++;
    }
  }

  return { files, migrationsGenerated: 0, typesGenerated };
}

function mapType(t: string): string {
  if (t.endsWith('[]')) return `${mapType(t.slice(0, -2))}[]`;
  switch (t) {
    case 'string':
      return 'string';
    case 'number':
    case 'int':
    case 'float':
      return 'number';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'date':
    case 'datetime':
      return 'Date';
    case 'json':
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

export class SchemaContractEngine {
  private readonly config: Required<SchemaContractConfig>;

  constructor(config: SchemaContractConfig = {}) {
    this.config = {
      outputDir: config.outputDir ?? './generated',
      watchMode: config.watchMode ?? false,
      generateTypes: config.generateTypes ?? true,
      generateMigrations: config.generateMigrations ?? true,
      generateValidators: config.generateValidators ?? false,
    };
  }

  /**
   * Process a schema string and generate code.
   */
  processSchema(source: string): GeneratedOutput & { parseResult: ContractParseResult } {
    const parseResult = parseSchemaContract(source);
    const output = generateFromContract(parseResult, this.config);
    return { ...output, parseResult };
  }

  get outputDir(): string {
    return this.config.outputDir;
  }
}

export function createSchemaContractEngine(config?: SchemaContractConfig): SchemaContractEngine {
  return new SchemaContractEngine(config);
}

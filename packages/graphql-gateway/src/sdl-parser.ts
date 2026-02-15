/**
 * GraphQL SDL Parser for Pocket
 *
 * Parses GraphQL Schema Definition Language (SDL) strings and converts them
 * to Pocket collection configurations. Supports custom Pocket directives
 * like @sync, @encrypted, @index, @default, and the deprecated directive.
 *
 * @module @pocket/graphql-gateway
 *
 * @example
 * ```typescript
 * import { createSDLParser } from '@pocket/graphql-gateway';
 *
 * const parser = createSDLParser({ enablePocketDirectives: true });
 *
 * const sdl = `
 *   type Todo @sync {
 *     id: ID!
 *     title: String! @index
 *     completed: Boolean @default(value: false)
 *     secret: String @encrypted
 *   }
 * `;
 *
 * // Parse into structured AST
 * const parsed = parser.parse(sdl);
 *
 * // Convert directly to Pocket collection configs
 * const result = parser.toCollections(sdl);
 *
 * // Validate SDL
 * const { valid, errors } = parser.validate(sdl);
 *
 * // Generate TypeScript interfaces
 * const tsCode = parser.generateTypeScript(parsed);
 * ```
 */

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ── Types ─────────────────────────────────────────────────

/** Supported Pocket directive names. */
export type PocketDirective =
  | 'sync'
  | 'encrypted'
  | 'index'
  | 'default'
  | 'deprecated'
  | 'relation'
  | 'computed'
  | 'ttl';

/** A parsed directive with its arguments. */
export interface DirectiveDefinition {
  name: PocketDirective;
  args: Record<string, unknown>;
}

/** A parsed field from a GraphQL type definition. */
export interface ParsedField {
  name: string;
  type: string;
  required: boolean;
  isList: boolean;
  description?: string;
  directives: DirectiveDefinition[];
  defaultValue?: unknown;
}

/** A parsed GraphQL type (object type). */
export interface ParsedType {
  name: string;
  fields: ParsedField[];
  description?: string;
  directives: DirectiveDefinition[];
  implements?: string[];
}

/** A parsed GraphQL enum type. */
export interface ParsedEnum {
  name: string;
  values: { name: string; description?: string; deprecated?: boolean }[];
  description?: string;
}

/** The full result of parsing an SDL string. */
export interface ParsedSDL {
  types: ParsedType[];
  enums: ParsedEnum[];
  inputs: ParsedType[];
  interfaces: ParsedType[];
  scalars: string[];
  directives: string[];
}

/** Configuration for the SDL parser. */
export interface SDLParserConfig {
  /** Allow custom Pocket directives (default: true). */
  enablePocketDirectives?: boolean;
  /** Strict mode — error on unknown directives (default: false). */
  strict?: boolean;
}

/** A single collection configuration derived from an SDL type. */
export interface CollectionConfig {
  name: string;
  fields: Record<
    string,
    { type: string; required: boolean; default?: unknown; encrypted?: boolean; indexed?: boolean }
  >;
  indexes: { fields: string[]; unique?: boolean }[];
  syncEnabled: boolean;
  ttl?: number;
}

/** Result of converting SDL to Pocket collection configurations. */
export interface SDLToCollectionResult {
  collections: CollectionConfig[];
  enums: Record<string, string[]>;
  relations: {
    from: string;
    to: string;
    field: string;
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  }[];
  warnings: string[];
}

// ── Constants ─────────────────────────────────────────────

const KNOWN_POCKET_DIRECTIVES: ReadonlySet<string> = new Set<PocketDirective>([
  'sync',
  'encrypted',
  'index',
  'default',
  'deprecated',
  'relation',
  'computed',
  'ttl',
]);

const GRAPHQL_TO_POCKET_TYPE: Record<string, string> = {
  String: 'string',
  Int: 'integer',
  Float: 'number',
  Boolean: 'boolean',
  ID: 'id',
};

const POCKET_TO_TS_TYPE: Record<string, string> = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  ID: 'string',
};

// ── SDL Parser ────────────────────────────────────────────

/**
 * Parses GraphQL SDL strings and converts them to Pocket collection
 * configurations. Handles custom Pocket directives (@sync, @encrypted,
 * @index, @default, deprecated, @relation, @computed, @ttl).
 *
 * @example
 * ```typescript
 * const parser = new SDLParser({ strict: true });
 * const result = parser.toCollections(`
 *   type User @sync {
 *     id: ID!
 *     email: String! @index
 *     name: String
 *   }
 * `);
 * console.log(result.collections);
 * ```
 */
export class SDLParser {
  private readonly config: Required<SDLParserConfig>;
  private readonly id = generateId();

  constructor(config?: SDLParserConfig) {
    this.config = {
      enablePocketDirectives: config?.enablePocketDirectives ?? true,
      strict: config?.strict ?? false,
    };
  }

  /**
   * Parse a raw SDL string into a structured {@link ParsedSDL}.
   *
   * @example
   * ```typescript
   * const parsed = parser.parse(`
   *   type Post {
   *     id: ID!
   *     title: String!
   *   }
   * `);
   * console.log(parsed.types[0].name); // 'Post'
   * ```
   */
  parse(sdl: string): ParsedSDL {
    const types: ParsedType[] = [];
    const enums: ParsedEnum[] = [];
    const inputs: ParsedType[] = [];
    const interfaces: ParsedType[] = [];
    const scalars: string[] = [];
    const directives: string[] = [];

    const lines = sdl.split('\n').map((l) => l.trim());

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;

      // Skip empty lines and comments
      if (line === '' || line.startsWith('#')) {
        i++;
        continue;
      }

      // Scalar declarations
      if (line.startsWith('scalar ')) {
        scalars.push(line.replace('scalar ', '').trim());
        i++;
        continue;
      }

      // Directive declarations
      if (line.startsWith('directive ')) {
        directives.push(line);
        i++;
        continue;
      }

      // Enum definitions
      if (line.startsWith('enum ')) {
        const enumResult = this.parseEnum(lines, i);
        enums.push(enumResult.enumDef);
        i = enumResult.endIndex + 1;
        continue;
      }

      // Type definitions
      if (line.startsWith('type ')) {
        const result = this.parseType(lines, i);
        types.push(result.type);
        i = result.endIndex + 1;
        continue;
      }

      // Input definitions
      if (line.startsWith('input ')) {
        const result = this.parseType(lines, i);
        inputs.push(result.type);
        i = result.endIndex + 1;
        continue;
      }

      // Interface definitions
      if (line.startsWith('interface ')) {
        const result = this.parseType(lines, i);
        interfaces.push(result.type);
        i = result.endIndex + 1;
        continue;
      }

      i++;
    }

    return { types, enums, inputs, interfaces, scalars, directives };
  }

  /**
   * Convert an SDL string directly to Pocket collection configurations.
   *
   * @example
   * ```typescript
   * const result = parser.toCollections(`
   *   type Task @sync @ttl(seconds: 86400) {
   *     id: ID!
   *     title: String! @index
   *     done: Boolean @default(value: false)
   *   }
   * `);
   * console.log(result.collections[0].syncEnabled); // true
   * ```
   */
  toCollections(sdl: string): SDLToCollectionResult {
    const parsed = this.parse(sdl);
    const collections: CollectionConfig[] = [];
    const enumMap: Record<string, string[]> = {};
    const relations: SDLToCollectionResult['relations'] = [];
    const warnings: string[] = [];

    // Build enum map
    for (const enumDef of parsed.enums) {
      enumMap[enumDef.name] = enumDef.values.map((v) => v.name);
    }

    // Convert types to collections
    for (const typeDef of parsed.types) {
      const fields: CollectionConfig['fields'] = {};
      const indexes: CollectionConfig['indexes'] = [];
      let syncEnabled = false;
      let ttl: number | undefined;

      // Check type-level directives
      for (const directive of typeDef.directives) {
        if (directive.name === 'sync') {
          syncEnabled = true;
        }
        if (directive.name === 'ttl' && typeof directive.args.seconds === 'number') {
          ttl = directive.args.seconds;
        }
      }

      for (const field of typeDef.fields) {
        const pocketType = this.mapGraphQLTypeToPocket(field.type);
        const fieldConfig: CollectionConfig['fields'][string] = {
          type: pocketType,
          required: field.required,
        };

        for (const directive of field.directives) {
          if (directive.name === 'encrypted') {
            fieldConfig.encrypted = true;
          }
          if (directive.name === 'index') {
            fieldConfig.indexed = true;
            const unique = directive.args.unique === true;
            indexes.push({ fields: [field.name], unique });
          }
          if (directive.name === 'default') {
            fieldConfig.default = directive.args.value;
          }
          if (directive.name === 'relation') {
            const relationType = (directive.args.type as string) ?? 'one-to-one';
            const target = (directive.args.to as string) ?? field.type;
            relations.push({
              from: typeDef.name,
              to: target,
              field: field.name,
              type: relationType as 'one-to-one' | 'one-to-many' | 'many-to-many',
            });
          }
          if (directive.name === 'deprecated') {
            warnings.push(
              `Field "${typeDef.name}.${field.name}" is deprecated: ${String(directive.args.reason ?? 'no reason given')}`
            );
          }
        }

        fields[field.name] = fieldConfig;
      }

      collections.push({
        name: typeDef.name,
        fields,
        indexes,
        syncEnabled,
        ...(ttl != null ? { ttl } : {}),
      });
    }

    return { collections, enums: enumMap, relations, warnings };
  }

  /**
   * Validate an SDL string for syntax and Pocket directive usage.
   *
   * @example
   * ```typescript
   * const { valid, errors } = parser.validate('type Foo { bar: Baz! }');
   * ```
   */
  validate(sdl: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!sdl.trim()) {
      errors.push('SDL string is empty');
      return { valid: false, errors };
    }

    // Check for balanced braces
    let braceDepth = 0;
    for (const ch of sdl) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (braceDepth < 0) {
        errors.push('Unexpected closing brace');
        break;
      }
    }
    if (braceDepth > 0) {
      errors.push('Unclosed brace — expected "}"');
    }

    // Try parsing and catch structural errors
    try {
      const parsed = this.parse(sdl);

      for (const typeDef of [...parsed.types, ...parsed.inputs, ...parsed.interfaces]) {
        if (!typeDef.name) {
          errors.push('Found type definition with no name');
        }
        if (typeDef.fields.length === 0) {
          errors.push(`Type "${typeDef.name}" has no fields`);
        }

        // Validate directives in strict mode
        if (this.config.strict) {
          for (const directive of typeDef.directives) {
            if (!KNOWN_POCKET_DIRECTIVES.has(directive.name)) {
              errors.push(`Unknown directive "@${directive.name}" on type "${typeDef.name}"`);
            }
          }
          for (const field of typeDef.fields) {
            for (const directive of field.directives) {
              if (!KNOWN_POCKET_DIRECTIVES.has(directive.name)) {
                errors.push(
                  `Unknown directive "@${directive.name}" on field "${typeDef.name}.${field.name}"`
                );
              }
            }
          }
        }
      }
    } catch {
      errors.push('Failed to parse SDL — check syntax');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate TypeScript interfaces from a parsed SDL result.
   *
   * @example
   * ```typescript
   * const parsed = parser.parse('type User { id: ID!, name: String }');
   * const ts = parser.generateTypeScript(parsed);
   * console.log(ts);
   * // export interface User {
   * //   id: string;
   * //   name?: string;
   * // }
   * ```
   */
  generateTypeScript(parsed: ParsedSDL): string {
    const parts: string[] = [];

    // Generate enums
    for (const enumDef of parsed.enums) {
      if (enumDef.description) {
        parts.push(`/** ${enumDef.description} */`);
      }
      const values = enumDef.values.map((v) => `  ${v.name} = '${v.name}',`);
      parts.push(`export enum ${enumDef.name} {`);
      parts.push(...values);
      parts.push('}');
      parts.push('');
    }

    // Generate interfaces from types, inputs, and interfaces
    for (const typeDef of [...parsed.types, ...parsed.inputs, ...parsed.interfaces]) {
      if (typeDef.description) {
        parts.push(`/** ${typeDef.description} */`);
      }
      parts.push(`export interface ${typeDef.name} {`);

      for (const field of typeDef.fields) {
        const tsType = this.mapGraphQLTypeToTS(field.type, field.isList);
        const optional = field.required ? '' : '?';
        if (field.description) {
          parts.push(`  /** ${field.description} */`);
        }
        parts.push(`  ${field.name}${optional}: ${tsType};`);
      }

      parts.push('}');
      parts.push('');
    }

    return parts.join('\n');
  }

  /** Release any internal resources held by the parser. */
  dispose(): void {
    // Reserved for future resource cleanup
    void this.id;
  }

  // ── Internals ─────────────────────────────────────────

  private parseType(lines: string[], startIndex: number): { type: ParsedType; endIndex: number } {
    const headerLine = lines[startIndex]!;

    // Extract name, directives, and implements clause from the header
    const headerMatch =
      /^(?:type|input|interface)\s+(\w+)(?:\s+implements\s+([\w\s&,]+))?(.*)?\{?\s*$/.exec(
        headerLine
      );
    const name = headerMatch?.[1] ?? '';
    const implementsClause = headerMatch?.[2]
      ?.split(/[&,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const directivesText = headerMatch?.[3] ?? '';
    const typeDirectives = this.parseDirectives(directivesText);

    const fields: ParsedField[] = [];
    let i = startIndex + 1;

    while (i < lines.length) {
      const line = lines[i]!;

      if (line === '}' || line.startsWith('}')) {
        break;
      }

      if (line === '' || line === '{' || line.startsWith('#')) {
        i++;
        continue;
      }

      const field = this.parseField(line);
      if (field) {
        fields.push(field);
      }

      i++;
    }

    return {
      type: {
        name,
        fields,
        directives: typeDirectives,
        ...(implementsClause && implementsClause.length > 0
          ? { implements: implementsClause }
          : {}),
      },
      endIndex: i,
    };
  }

  private parseField(line: string): ParsedField | null {
    // Match field pattern: name: Type! @directive(arg: value)
    const match = /^(\w+)\s*:\s*(.+)$/.exec(line);
    if (!match) return null;

    const name = match[1]!;
    let rest = match[2]!.trim();

    // Extract directives
    const directives = this.parseDirectives(rest);

    // Remove directives from the type portion
    rest = rest.replace(/@\w+(?:\([^)]*\))?/g, '').trim();

    // Parse list type
    const isList = rest.startsWith('[');
    let required = false;

    // Clean type string
    let type = rest.replace(/[[\]!]/g, '').trim();
    required = rest.endsWith('!');
    type = type || 'String';

    // Extract default value from @default directive
    const defaultDirective = directives.find((d) => d.name === 'default');
    const defaultValue = defaultDirective?.args.value;

    return {
      name,
      type,
      required,
      isList,
      directives,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  }

  private parseDirectives(text: string): DirectiveDefinition[] {
    if (!this.config.enablePocketDirectives) return [];

    const directives: DirectiveDefinition[] = [];
    const directiveRegex = /@(\w+)(?:\(([^)]*)\))?/g;
    let match: RegExpExecArray | null;

    while ((match = directiveRegex.exec(text)) !== null) {
      const name = match[1]! as PocketDirective;
      const argsStr = match[2];
      const args: Record<string, unknown> = {};

      if (argsStr) {
        // Parse simple key: value pairs
        const argPairs = argsStr.split(',');
        for (const pair of argPairs) {
          const colonIndex = pair.indexOf(':');
          if (colonIndex === -1) continue;

          const key = pair.substring(0, colonIndex).trim();
          let value: unknown = pair.substring(colonIndex + 1).trim();

          // Coerce values
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (typeof value === 'string' && !Number.isNaN(Number(value))) value = Number(value);
          else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }

          args[key] = value;
        }
      }

      directives.push({ name, args });
    }

    return directives;
  }

  private parseEnum(
    lines: string[],
    startIndex: number
  ): { enumDef: ParsedEnum; endIndex: number } {
    const headerLine = lines[startIndex]!;
    const name = headerLine
      .replace(/^enum\s+/, '')
      .replace(/\s*\{.*$/, '')
      .trim();

    const values: ParsedEnum['values'] = [];
    let i = startIndex + 1;

    while (i < lines.length) {
      const line = lines[i]!;

      if (line === '}' || line.startsWith('}')) {
        break;
      }

      if (line === '' || line === '{' || line.startsWith('#')) {
        i++;
        continue;
      }

      const deprecated = line.includes('@deprecated');
      const valueName = line.replace(/@\w+(?:\([^)]*\))?/g, '').trim();
      if (valueName) {
        values.push({ name: valueName, deprecated: deprecated || undefined });
      }

      i++;
    }

    return { enumDef: { name, values }, endIndex: i };
  }

  private mapGraphQLTypeToPocket(gqlType: string): string {
    return GRAPHQL_TO_POCKET_TYPE[gqlType] ?? 'string';
  }

  private mapGraphQLTypeToTS(gqlType: string, isList: boolean): string {
    const baseType = POCKET_TO_TS_TYPE[gqlType] ?? gqlType;
    return isList ? `${baseType}[]` : baseType;
  }
}

// ── Factory ───────────────────────────────────────────────

/**
 * Create a new SDL parser for converting GraphQL SDL to Pocket collections.
 *
 * @example
 * ```typescript
 * const parser = createSDLParser({ strict: true });
 * const result = parser.toCollections('type Todo @sync { id: ID! }');
 * ```
 */
export function createSDLParser(config?: SDLParserConfig): SDLParser {
  return new SDLParser(config);
}

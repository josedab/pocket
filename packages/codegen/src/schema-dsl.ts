/**
 * @pocket/codegen - Pocket Schema DSL Parser
 *
 * Parses `.pocket` schema DSL files into an AST and converts
 * to the existing codegen-compatible PocketSchema format.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, PocketSchema, SchemaField, SchemaFieldType } from './types.js';

// ─── DSL AST Types ───────────────────────────────────────────────────────────

/** Supported DSL field type strings */
export type DslFieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]';

/** A single field definition in the DSL */
export interface PocketFieldDef {
  name: string;
  type: DslFieldType;
  optional: boolean;
  defaultValue?: unknown;
  isArray: boolean;
}

/** A collection definition in the DSL */
export interface PocketCollectionDef {
  name: string;
  fields: PocketFieldDef[];
  indexes: string[][];
  uniques: string[][];
}

/** Top-level DSL schema AST */
export interface PocketDslSchema {
  collections: PocketCollectionDef[];
}

/** A parse error with location info */
export interface SchemaParseError {
  message: string;
  line: number;
  column?: number;
}

/** Result of parsing a DSL source string */
export interface SchemaParseResult {
  success: boolean;
  schema?: PocketDslSchema;
  errors: SchemaParseError[];
}

// ─── DSL Field Type Mapping ──────────────────────────────────────────────────

const SIMPLE_TYPE_SET = new Set<string>(['string', 'number', 'boolean', 'date']);
const ARRAY_TYPE_SET = new Set<string>(['string[]', 'number[]']);

function isValidDslType(t: string): t is DslFieldType {
  return SIMPLE_TYPE_SET.has(t) || ARRAY_TYPE_SET.has(t);
}

// ─── Tokenisation helpers ────────────────────────────────────────────────────

function stripComments(line: string): string {
  // Remove single-line // comments (not inside strings — good enough for DSL)
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a `.pocket` DSL source string into a {@link PocketDslSchema} AST.
 *
 * @param source - The DSL text
 * @returns A {@link SchemaParseResult} with the parsed schema or errors
 */
export function parsePocketSchema(source: string): SchemaParseResult {
  const errors: SchemaParseError[] = [];
  const collections: PocketCollectionDef[] = [];
  const lines = source.split('\n');

  let i = 0;

  while (i < lines.length) {
    const raw = stripComments(lines[i]!);
    const trimmed = raw.trim();

    // Skip blank lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // Expect "collection <Name> {"
    const collMatch = /^collection\s+(\w+)\s*\{$/.exec(trimmed);
    if (!collMatch) {
      errors.push({ message: `Expected collection definition, got: "${trimmed}"`, line: i + 1 });
      i++;
      continue;
    }

    const collName = collMatch[1]!;
    const fields: PocketFieldDef[] = [];
    const indexes: string[][] = [];
    const uniques: string[][] = [];
    i++;

    // Parse body until closing brace
    let closed = false;
    while (i < lines.length) {
      const bodyRaw = stripComments(lines[i]!);
      const bodyTrimmed = bodyRaw.trim();

      if (bodyTrimmed === '') {
        i++;
        continue;
      }

      if (bodyTrimmed === '}') {
        closed = true;
        i++;
        break;
      }

      // Directive: @index(...) or @unique(...)
      const directiveMatch = /^@(index|unique)\(([^)]*)\)$/.exec(bodyTrimmed);
      if (directiveMatch) {
        const kind = directiveMatch[1]!;
        const args = directiveMatch[2]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (args.length === 0) {
          errors.push({ message: `@${kind} requires at least one field`, line: i + 1 });
        } else if (kind === 'index') {
          indexes.push(args);
        } else {
          uniques.push(args);
        }
        i++;
        continue;
      }

      // Field: name[?]: type [= default]
      const fieldMatch = /^(\w+)(\?)?\s*:\s*(\w+(?:\[\])?)\s*(?:=\s*(.+))?$/.exec(bodyTrimmed);
      if (!fieldMatch) {
        errors.push({ message: `Invalid field syntax: "${bodyTrimmed}"`, line: i + 1 });
        i++;
        continue;
      }

      const fieldName = fieldMatch[1]!;
      const optional = fieldMatch[2] === '?';
      const rawType = fieldMatch[3]!;
      const rawDefault = fieldMatch[4]?.trim();

      if (!isValidDslType(rawType)) {
        errors.push({
          message: `Unknown type "${rawType}". Expected: string, number, boolean, date, string[], number[]`,
          line: i + 1,
        });
        i++;
        continue;
      }

      const isArray = ARRAY_TYPE_SET.has(rawType);
      let defaultValue: unknown = undefined;
      if (rawDefault !== undefined) {
        defaultValue = parseDefault(rawDefault, rawType);
        if (defaultValue === undefined) {
          errors.push({ message: `Invalid default value "${rawDefault}" for type ${rawType}`, line: i + 1 });
          i++;
          continue;
        }
      }

      fields.push({ name: fieldName, type: rawType as DslFieldType, optional, defaultValue, isArray });
      i++;
    }

    if (!closed) {
      errors.push({ message: `Unclosed collection "${collName}"`, line: i });
    }

    collections.push({ name: collName, fields, indexes, uniques });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, schema: { collections }, errors: [] };
}

// ─── Default value coercion ──────────────────────────────────────────────────

function parseDefault(raw: string, type: DslFieldType): unknown {
  // Remove surrounding quotes for strings
  if (type === 'string') {
    const strMatch = /^["'](.*)["']$/.exec(raw);
    return strMatch ? strMatch[1] : undefined;
  }
  if (type === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  // date and array defaults not supported
  return undefined;
}

// ─── Conversion to codegen PocketSchema ──────────────────────────────────────

/**
 * Convert a DSL AST to the codegen-compatible {@link PocketSchema} format.
 */
export function schemaToCodegenInput(schema: PocketDslSchema): PocketSchema {
  const collections: CollectionSchema[] = schema.collections.map((coll) => {
    const fields: Record<string, SchemaField> = {};

    for (const f of coll.fields) {
      const baseType = f.isArray ? f.type.replace('[]', '') : f.type;
      const schemaFieldType: SchemaFieldType = f.isArray ? 'array' : (baseType as SchemaFieldType);

      const field: SchemaField = {
        type: schemaFieldType,
        required: !f.optional,
      };

      if (f.defaultValue !== undefined) {
        field.default = f.defaultValue;
      }

      if (f.isArray) {
        field.items = { type: baseType as SchemaFieldType };
      }

      // Mark single-field indexes / uniques on the field itself
      for (const idx of coll.indexes) {
        if (idx.length === 1 && idx[0] === f.name) {
          field.index = true;
        }
      }
      for (const uq of coll.uniques) {
        if (uq.length === 1 && uq[0] === f.name) {
          field.unique = true;
        }
      }

      fields[f.name] = field;
    }

    // Compound indexes (2+ fields)
    const compoundIndexes = [
      ...coll.indexes.filter((idx) => idx.length > 1).map((idxFields) => ({ fields: idxFields })),
      ...coll.uniques
        .filter((uq) => uq.length > 1)
        .map((uqFields) => ({ fields: uqFields, unique: true as const })),
    ];

    const out: CollectionSchema = { name: coll.name, fields };
    if (compoundIndexes.length > 0) {
      out.indexes = compoundIndexes;
    }

    return out;
  });

  return { version: '1.0.0', collections };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a DSL parser instance (does not clash with `createSchemaParser`).
 */
export function createDSLParser() {
  return {
    parse: parsePocketSchema,
    toCodegenInput: schemaToCodegenInput,
  };
}

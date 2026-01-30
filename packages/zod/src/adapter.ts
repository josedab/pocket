/**
 * Zod to Pocket Schema Adapter
 *
 * Converts Zod schemas to Pocket-compatible validation schemas.
 *
 * @module @pocket/zod
 */

import type {
  Document,
  FieldDefinition,
  FieldType,
  FieldValidationError,
  SchemaDefinition,
  ValidationResult,
} from '@pocket/core';
import { z } from 'zod';

/**
 * Options for Zod schema conversion
 */
export interface ZodSchemaOptions {
  /** Whether to include _id and _rev fields automatically */
  includeDocumentFields?: boolean;
  /** Whether to validate on write operations */
  validateOnWrite?: boolean;
  /** Whether to validate on read operations */
  validateOnRead?: boolean;
  /** Whether to strip unknown fields */
  stripUnknown?: boolean;
}

/**
 * Pocket schema wrapper for Zod schemas
 */
export interface ZodPocketSchema<T extends Document> {
  /** Schema definition for Pocket */
  definition: SchemaDefinition;
  /** The original Zod schema */
  zodSchema: z.ZodType<T>;
  /** Validate data */
  validate: (data: unknown) => ValidationResult;
  /** Parse data using the Zod schema */
  parse: (data: unknown) => T;
  /** Safe parse data using the Zod schema */
  safeParse: (data: unknown) => z.SafeParseReturnType<unknown, T>;
  /** Whether to validate on write operations */
  validateOnWrite: boolean;
  /** Whether to validate on read operations */
  validateOnRead: boolean;
  /** Transform data before writing */
  beforeWrite?: (doc: T) => T;
  /** Transform data after reading */
  afterRead?: (doc: T) => T;
}

/** Internal type for Zod type definitions */
interface ZodTypeDef {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  value?: unknown;
  type?: z.ZodTypeAny;
  defaultValue?: () => unknown;
}

/**
 * Get the type name from a Zod type definition
 */
function getTypeName(zodType: z.ZodTypeAny): string | undefined {
  return (zodType._def as ZodTypeDef).typeName;
}

/**
 * Convert a Zod type to a Pocket schema field type
 */
function zodTypeToFieldType(zodType: z.ZodTypeAny): FieldType {
  const typeName = getTypeName(zodType);
  const def = zodType._def as ZodTypeDef;

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodDate':
      return 'date';
    case 'ZodArray':
      return 'array';
    case 'ZodObject':
      return 'object';
    case 'ZodOptional':
    case 'ZodNullable':
      // Get the inner type
      return def.innerType ? zodTypeToFieldType(def.innerType) : 'any';
    case 'ZodDefault':
      return def.innerType ? zodTypeToFieldType(def.innerType) : 'any';
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      // For unions, try to get the first option's type
      if (def.options && def.options.length > 0) {
        return zodTypeToFieldType(def.options[0]);
      }
      return 'any';
    case 'ZodLiteral': {
      const value = def.value;
      if (typeof value === 'string') return 'string';
      if (typeof value === 'number') return 'number';
      if (typeof value === 'boolean') return 'boolean';
      return 'any';
    }
    case 'ZodEnum':
      return 'string';
    case 'ZodNativeEnum':
      return 'any';
    default:
      return 'any';
  }
}

/**
 * Check if a Zod type is optional
 */
function isOptional(zodType: z.ZodTypeAny): boolean {
  const typeName = getTypeName(zodType);
  return typeName === 'ZodOptional' || typeName === 'ZodNullable';
}

/**
 * Check if a Zod type has a default value
 */
function hasDefault(zodType: z.ZodTypeAny): boolean {
  return getTypeName(zodType) === 'ZodDefault';
}

/**
 * Get the default value from a Zod type
 */
function getDefault(zodType: z.ZodTypeAny): unknown {
  if (hasDefault(zodType)) {
    const def = zodType._def as ZodTypeDef;
    return def.defaultValue?.();
  }
  return undefined;
}

/**
 * Extract schema fields from a Zod object schema
 */
function extractFields(zodSchema: z.ZodObject<z.ZodRawShape>): Record<string, FieldDefinition> {
  const shape = zodSchema.shape;
  const fields: Record<string, FieldDefinition> = {};

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value;
    const field: FieldDefinition = {
      type: zodTypeToFieldType(zodType),
      required: !isOptional(zodType),
    };

    // Add default value if present
    const defaultValue = getDefault(zodType);
    if (defaultValue !== undefined) {
      field.default = defaultValue;
    }

    // Add nested fields for objects
    if (getTypeName(zodType) === 'ZodObject') {
      field.properties = extractFields(zodType as z.ZodObject<z.ZodRawShape>);
    }

    // Add item type for arrays
    if (getTypeName(zodType) === 'ZodArray') {
      const def = zodType._def as ZodTypeDef;
      if (def.type) {
        field.items = {
          type: zodTypeToFieldType(def.type),
        };
      }
    }

    fields[key] = field;
  }

  return fields;
}

/**
 * Create a Pocket schema from a Zod schema
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodSchema } from '@pocket/zod';
 * import { Database } from '@pocket/core';
 *
 * const userZod = z.object({
 *   _id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 *   age: z.number().min(0).optional(),
 *   createdAt: z.date().default(() => new Date()),
 * });
 *
 * type User = z.infer<typeof userZod>;
 *
 * const db = await Database.create({ name: 'my-app' });
 * const users = db.collection<User>('users', {
 *   schema: zodSchema(userZod),
 * });
 *
 * // Documents are validated using the Zod schema
 * await users.insert({ _id: '1', name: 'John', email: 'john@example.com' });
 * ```
 */
export function zodSchema<T extends Document>(
  schema: z.ZodType<T>,
  options: ZodSchemaOptions = {}
): ZodPocketSchema<T> {
  const {
    includeDocumentFields = true,
    validateOnWrite = true,
    validateOnRead = false,
    stripUnknown = false,
  } = options;

  // Extract fields if it's an object schema
  let fields: Record<string, FieldDefinition> = {};

  if (getTypeName(schema) === 'ZodObject') {
    fields = extractFields(schema as unknown as z.ZodObject<z.ZodRawShape>);
  }

  // Add document fields if requested
  if (includeDocumentFields) {
    fields._id = fields._id ?? { type: 'string', required: true };
    fields._rev = fields._rev ?? { type: 'string', required: false };
  }

  // Create validation function that returns proper ValidationResult
  const validate = (data: unknown): ValidationResult => {
    const parseSchema =
      stripUnknown && getTypeName(schema) === 'ZodObject'
        ? (schema as unknown as z.ZodObject<z.ZodRawShape>).strip()
        : schema;

    const result = parseSchema.safeParse(data);

    if (result.success) {
      return { valid: true, errors: [] };
    }

    const errors: FieldValidationError[] = result.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    return {
      valid: false,
      errors,
    };
  };

  // Create SchemaDefinition
  const definition: SchemaDefinition = {
    version: 1,
    properties: fields,
  };

  return {
    definition,
    zodSchema: schema,

    validate,

    validateOnWrite,
    validateOnRead,

    parse: (data: unknown) => schema.parse(data),
    safeParse: (data: unknown) => schema.safeParse(data),

    // Transform data before writing
    beforeWrite: validateOnWrite
      ? (doc: T) => {
          const result = schema.safeParse(doc);
          if (!result.success) {
            const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
            throw new Error(`Validation failed: ${errors.join(', ')}`);
          }
          return result.data;
        }
      : undefined,

    // Transform data after reading
    afterRead: validateOnRead
      ? (doc: T) => {
          const result = schema.safeParse(doc);
          if (!result.success) {
            // Return original document on read validation failure
            // This can happen with legacy data or schema changes
            return doc;
          }
          return result.data;
        }
      : undefined,
  };
}

/**
 * Create a partial Zod schema (all fields optional)
 *
 * Useful for update operations where you only want to update some fields.
 *
 * @example
 * ```typescript
 * const userZod = z.object({ name: z.string(), age: z.number() });
 * const partialUser = partialZodSchema(userZod);
 *
 * // Now both fields are optional
 * partialUser.parse({ name: 'John' }); // OK
 * partialUser.parse({ age: 25 }); // OK
 * ```
 */
export function partialZodSchema<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
  return schema.partial();
}

/**
 * Create a Zod schema that extends the base Document type
 *
 * @example
 * ```typescript
 * const userZod = documentSchema({
 *   name: z.string(),
 *   email: z.string().email(),
 * });
 *
 * // Automatically includes _id and _rev fields
 * type User = z.infer<typeof userZod>;
 * ```
 */
export function documentSchema<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<T & { _id: z.ZodString; _rev: z.ZodOptional<z.ZodString> }> {
  return z.object({
    _id: z.string(),
    _rev: z.string().optional(),
    ...shape,
  }) as z.ZodObject<T & { _id: z.ZodString; _rev: z.ZodOptional<z.ZodString> }>;
}

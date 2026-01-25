/**
 * Bi-directional Schema Converter
 *
 * Converts between Zod schemas and Pocket schemas.
 *
 * @module @pocket/zod
 */

import type { FieldDefinition, FieldType, SchemaDefinition } from '@pocket/core';
import { type Schema } from '@pocket/core';
import { z } from 'zod';

/**
 * Convert a Pocket schema field definition to a Zod type
 */
function fieldDefinitionToZod(field: FieldDefinition): z.ZodTypeAny {
  let zodType: z.ZodTypeAny;

  // Handle union types
  const types = Array.isArray(field.type) ? field.type : [field.type];
  const primaryType = types[0];

  switch (primaryType) {
    case 'string':
      zodType = z.string();
      break;
    case 'number':
      zodType = z.number();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'date':
      zodType = z.date();
      break;
    case 'null':
      zodType = z.null();
      break;
    case 'array':
      if (field.items) {
        zodType = z.array(fieldDefinitionToZod(field.items));
      } else {
        zodType = z.array(z.unknown());
      }
      break;
    case 'object':
      if (field.properties) {
        const shape: z.ZodRawShape = {};
        for (const [key, prop] of Object.entries(field.properties)) {
          shape[key] = fieldDefinitionToZod(prop);
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.unknown());
      }
      break;
    case 'any':
    default:
      zodType = z.unknown();
  }

  // Handle nullable types (union with null)
  if (types.includes('null') && primaryType !== 'null') {
    zodType = zodType.nullable();
  }

  // Handle optional fields
  if (!field.required) {
    zodType = zodType.optional();
  }

  // Handle default values
  if (field.default !== undefined) {
    zodType = zodType.default(field.default);
  }

  return zodType;
}

/**
 * Convert a Pocket schema to a Zod schema
 *
 * @example
 * ```typescript
 * import { Schema } from '@pocket/core';
 * import { pocketToZod } from '@pocket/zod';
 *
 * const pocketSchema = new Schema({
 *   properties: {
 *     name: { type: 'string', required: true },
 *     age: { type: 'number' },
 *   },
 * });
 *
 * const zodSchema = pocketToZod(pocketSchema);
 * zodSchema.parse({ name: 'John' }); // OK
 * ```
 */
export function pocketToZod(schema: Schema): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const [key, field] of Object.entries(schema.definition.properties)) {
    shape[key] = fieldDefinitionToZod(field);
  }

  return z.object(shape);
}

/**
 * Convert a Zod schema to a Pocket SchemaDefinition
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodToPocket } from '@pocket/zod';
 * import { Schema } from '@pocket/core';
 *
 * const zodSchema = z.object({
 *   name: z.string(),
 *   age: z.number().optional(),
 * });
 *
 * const definition = zodToPocket(zodSchema);
 * const pocketSchema = new Schema(definition);
 * ```
 */
export function zodToPocket<T extends z.ZodRawShape>(
  zodSchema: z.ZodObject<T>,
  version = 1
): SchemaDefinition {
  const shape = zodSchema.shape;
  const properties: Record<string, FieldDefinition> = {};

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodFieldToPocket(value);
  }

  return {
    version,
    properties,
  };
}

/**
 * Convert a single Zod field to a Pocket schema field definition
 */
function zodFieldToPocket(zodType: z.ZodTypeAny): FieldDefinition {
  const typeName = zodType._def.typeName;

  // Handle wrappers first
  if (typeName === 'ZodOptional') {
    const inner = zodFieldToPocket(zodType._def.innerType);
    return { ...inner, required: false };
  }

  if (typeName === 'ZodNullable') {
    const inner = zodFieldToPocket(zodType._def.innerType);
    const innerType = Array.isArray(inner.type) ? inner.type : [inner.type];
    return { ...inner, type: [...innerType, 'null'] as FieldType[] };
  }

  if (typeName === 'ZodDefault') {
    const inner = zodFieldToPocket(zodType._def.innerType);
    return { ...inner, default: zodType._def.defaultValue() };
  }

  // Handle base types
  let type: FieldType;
  let properties: Record<string, FieldDefinition> | undefined;
  let items: FieldDefinition | undefined;

  switch (typeName) {
    case 'ZodString':
      type = 'string';
      break;
    case 'ZodNumber':
      type = 'number';
      break;
    case 'ZodBoolean':
      type = 'boolean';
      break;
    case 'ZodDate':
      type = 'date';
      break;
    case 'ZodNull':
      type = 'null';
      break;
    case 'ZodArray':
      type = 'array';
      items = zodFieldToPocket(zodType._def.type);
      break;
    case 'ZodObject':
      type = 'object';
      properties = {};
      for (const [key, value] of Object.entries((zodType as z.ZodObject<z.ZodRawShape>).shape)) {
        properties[key] = zodFieldToPocket(value);
      }
      break;
    case 'ZodEnum':
      type = 'string';
      break;
    case 'ZodLiteral': {
      const value = zodType._def.value;
      if (typeof value === 'string') type = 'string';
      else if (typeof value === 'number') type = 'number';
      else if (typeof value === 'boolean') type = 'boolean';
      else type = 'any';
      break;
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      // For unions, use the first option's type
      const options = zodType._def.options;
      if (options && options.length > 0) {
        return zodFieldToPocket(options[0]);
      }
      type = 'any';
      break;
    }
    default:
      type = 'any';
  }

  const field: FieldDefinition = { type, required: true };
  if (properties) field.properties = properties;
  if (items) field.items = items;

  return field;
}

/**
 * Merge multiple Zod object schemas into one
 *
 * @example
 * ```typescript
 * const baseSchema = z.object({ _id: z.string() });
 * const timestampSchema = z.object({
 *   createdAt: z.date(),
 *   updatedAt: z.date(),
 * });
 * const userSchema = z.object({ name: z.string() });
 *
 * const merged = mergeZodSchemas(baseSchema, timestampSchema, userSchema);
 * // Has all fields from all schemas
 * ```
 */
export function mergeZodSchemas<T1 extends z.ZodRawShape, T2 extends z.ZodRawShape>(
  schema1: z.ZodObject<T1>,
  schema2: z.ZodObject<T2>
): z.ZodObject<z.ZodRawShape> {
  return schema1.merge(schema2) as z.ZodObject<z.ZodRawShape>;
}

/**
 * Create a Zod schema with strict mode (fails on unknown keys)
 */
export function strictZodSchema<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, 'strict'> {
  return z.object(shape).strict();
}

/**
 * Create a Zod schema with passthrough mode (preserves unknown keys)
 */
export function passthroughZodSchema<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<T, 'passthrough'> {
  return z.object(shape).passthrough();
}

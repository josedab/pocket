/**
 * Schema Parser - Converts Zod schemas to form configurations
 */

import { z } from 'zod';
import type { FieldConfig, FieldOption, FieldType, FormConfig, SchemaMetadata } from './types.js';

/**
 * Get form metadata from a Zod schema
 */
function getMetadata(schema: z.ZodTypeAny): SchemaMetadata | undefined {
  return (schema as unknown as { _formMeta?: SchemaMetadata })._formMeta;
}

/**
 * Infer field type from Zod schema
 */
function inferFieldType(schema: z.ZodTypeAny): FieldType {
  // Check metadata override first
  const meta = getMetadata(schema);
  if (meta?.fieldType) {
    return meta.fieldType;
  }

  // Unwrap optional/nullable/default
  let innerSchema = schema;
  while (
    innerSchema instanceof z.ZodOptional ||
    innerSchema instanceof z.ZodNullable ||
    innerSchema instanceof z.ZodDefault
  ) {
    innerSchema = (innerSchema as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }

  // Infer from schema type
  if (innerSchema instanceof z.ZodString) {
    const checks =
      (innerSchema as unknown as { _def: { checks: { kind: string }[] } })._def.checks || [];
    for (const check of checks) {
      if (check.kind === 'email') return 'email';
      if (check.kind === 'url') return 'text';
      if (check.kind === 'uuid') return 'text';
    }
    return 'text';
  }

  if (innerSchema instanceof z.ZodNumber) {
    return 'number';
  }

  if (innerSchema instanceof z.ZodBoolean) {
    return 'checkbox';
  }

  if (innerSchema instanceof z.ZodDate) {
    return 'date';
  }

  if (innerSchema instanceof z.ZodEnum) {
    return 'select';
  }

  if (innerSchema instanceof z.ZodNativeEnum) {
    return 'select';
  }

  if (innerSchema instanceof z.ZodArray) {
    return 'array';
  }

  if (innerSchema instanceof z.ZodObject) {
    return 'object';
  }

  if (innerSchema instanceof z.ZodUnion) {
    return 'select';
  }

  return 'text';
}

/**
 * Extract options from enum schema
 */
function extractEnumOptions(schema: z.ZodTypeAny): FieldOption[] | undefined {
  // Unwrap optional/nullable/default
  let innerSchema = schema;
  while (
    innerSchema instanceof z.ZodOptional ||
    innerSchema instanceof z.ZodNullable ||
    innerSchema instanceof z.ZodDefault
  ) {
    innerSchema = (innerSchema as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }

  if (innerSchema instanceof z.ZodEnum) {
    const values = (innerSchema as unknown as { _def: { values: string[] } })._def.values;
    return values.map((v) => ({
      value: v,
      label: formatLabel(v),
    }));
  }

  if (innerSchema instanceof z.ZodNativeEnum) {
    const enumObj = (
      innerSchema as unknown as { _def: { values: Record<string, string | number> } }
    )._def.values;
    return Object.entries(enumObj)
      .filter(([, v]) => typeof v !== 'number')
      .map(([k, v]) => ({
        value: v,
        label: formatLabel(k),
      }));
  }

  if (innerSchema instanceof z.ZodUnion) {
    const options = (innerSchema as unknown as { _def: { options: z.ZodTypeAny[] } })._def.options;
    return options
      .filter((o) => o instanceof z.ZodLiteral)
      .map((o) => {
        const value = (o as unknown as { _def: { value: unknown } })._def.value;
        return {
          value: value as string | number,
          label: formatLabel(String(value)),
        };
      });
  }

  return undefined;
}

/**
 * Extract validation constraints from schema
 */
function extractConstraints(schema: z.ZodTypeAny): Partial<FieldConfig> {
  const constraints: Partial<FieldConfig> = {};

  // Unwrap optional/nullable/default
  let innerSchema = schema;
  let isOptional = false;

  while (
    innerSchema instanceof z.ZodOptional ||
    innerSchema instanceof z.ZodNullable ||
    innerSchema instanceof z.ZodDefault
  ) {
    if (innerSchema instanceof z.ZodOptional || innerSchema instanceof z.ZodNullable) {
      isOptional = true;
    }
    innerSchema = (innerSchema as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }

  constraints.required = !isOptional;

  // String constraints
  if (innerSchema instanceof z.ZodString) {
    const checks =
      (
        innerSchema as unknown as {
          _def: { checks: { kind: string; value?: number; regex?: RegExp }[] };
        }
      )._def.checks || [];
    for (const check of checks) {
      if (check.kind === 'min' && typeof check.value === 'number') {
        constraints.minLength = check.value;
      }
      if (check.kind === 'max' && typeof check.value === 'number') {
        constraints.maxLength = check.value;
      }
      if (check.kind === 'regex' && check.regex) {
        constraints.pattern = check.regex.source;
      }
    }
  }

  // Number constraints
  if (innerSchema instanceof z.ZodNumber) {
    const checks =
      (innerSchema as unknown as { _def: { checks: { kind: string; value?: number }[] } })._def
        .checks || [];
    for (const check of checks) {
      if (check.kind === 'min' && typeof check.value === 'number') {
        constraints.min = check.value;
      }
      if (check.kind === 'max' && typeof check.value === 'number') {
        constraints.max = check.value;
      }
    }
  }

  return constraints;
}

/**
 * Format a field name as a label
 */
function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\s/, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse a Zod schema field into a field config
 */
function parseField(name: string, schema: z.ZodTypeAny, order: number): FieldConfig {
  const meta = getMetadata(schema) ?? {};
  const fieldType = inferFieldType(schema);
  const options = meta.options ?? extractEnumOptions(schema);
  const constraints = extractConstraints(schema);

  // Get default value
  let defaultValue: unknown = undefined;
  if (schema instanceof z.ZodDefault) {
    defaultValue = (
      schema as unknown as { _def: { defaultValue: () => unknown } }
    )._def.defaultValue();
  }

  const config: FieldConfig = {
    name,
    type: fieldType,
    label: meta.label ?? formatLabel(name),
    placeholder: meta.placeholder,
    helpText: meta.helpText,
    defaultValue,
    options,
    group: meta.group,
    order: meta.order ?? order,
    hidden: meta.hidden,
    component: meta.component,
    componentProps: meta.props,
    relation: meta.relation,
    ...constraints,
  };

  // Handle nested objects
  if (fieldType === 'object' && schema instanceof z.ZodObject) {
    config.fields = parseSchemaFields(schema as z.ZodObject<z.ZodRawShape>);
  }

  // Handle arrays
  if (fieldType === 'array' && schema instanceof z.ZodArray) {
    const elementType = (schema as unknown as { _def: { type: z.ZodTypeAny } })._def.type;
    if (elementType instanceof z.ZodObject) {
      config.fields = parseSchemaFields(elementType);
    }
  }

  return config;
}

/**
 * Parse all fields from a Zod object schema
 */
function parseSchemaFields(schema: z.ZodObject<z.ZodRawShape>): FieldConfig[] {
  const shape = schema.shape;
  const fields: FieldConfig[] = [];
  let order = 0;

  for (const [name, fieldSchema] of Object.entries(shape)) {
    // Skip internal fields
    if (name.startsWith('_')) continue;

    fields.push(parseField(name, fieldSchema, order++));
  }

  // Sort by order
  fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return fields;
}

/**
 * Parse a Zod schema into a complete form config
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function parseSchema<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options: {
    title?: string;
    description?: string;
    submitText?: string;
    groups?: FormConfig['groups'];
    layout?: FormConfig['layout'];
  } = {}
): FormConfig {
  const fields = parseSchemaFields(schema);

  // Auto-detect groups from field configs
  const groupsFromFields = new Set<string>();
  for (const field of fields) {
    if (field.group) {
      groupsFromFields.add(field.group);
    }
  }

  // Create groups if specified in fields but not in options
  const groups =
    options.groups ??
    (groupsFromFields.size > 0
      ? Array.from(groupsFromFields).map((id) => ({
          id,
          label: formatLabel(id),
          fields: fields.filter((f) => f.group === id).map((f) => f.name),
        }))
      : undefined);

  return {
    title: options.title,
    description: options.description,
    fields,
    groups,
    layout: options.layout,
    submitText: options.submitText,
  };
}

/**
 * Add form metadata to a Zod schema
 */
export function withFormMeta<T extends z.ZodTypeAny>(schema: T, meta: SchemaMetadata): T {
  const cloned = schema as unknown as { _formMeta?: SchemaMetadata };
  cloned._formMeta = { ...getMetadata(schema), ...meta };
  return schema;
}

/**
 * Create a form field schema with metadata
 */
export const field = {
  text: (meta?: SchemaMetadata) => withFormMeta(z.string(), { fieldType: 'text', ...meta }),

  email: (meta?: SchemaMetadata) =>
    withFormMeta(z.string().email(), { fieldType: 'email', ...meta }),

  password: (meta?: SchemaMetadata) => withFormMeta(z.string(), { fieldType: 'password', ...meta }),

  number: (meta?: SchemaMetadata) => withFormMeta(z.number(), { fieldType: 'number', ...meta }),

  date: (meta?: SchemaMetadata) => withFormMeta(z.date(), { fieldType: 'date', ...meta }),

  textarea: (meta?: SchemaMetadata) => withFormMeta(z.string(), { fieldType: 'textarea', ...meta }),

  checkbox: (meta?: SchemaMetadata) =>
    withFormMeta(z.boolean(), { fieldType: 'checkbox', ...meta }),

  toggle: (meta?: SchemaMetadata) => withFormMeta(z.boolean(), { fieldType: 'toggle', ...meta }),

  select: <T extends [string, ...string[]]>(values: T, meta?: SchemaMetadata) =>
    withFormMeta(z.enum(values), { fieldType: 'select', ...meta }),

  multiselect: <T extends [string, ...string[]]>(values: T, meta?: SchemaMetadata) =>
    withFormMeta(z.array(z.enum(values)), { fieldType: 'multiselect', ...meta }),

  radio: <T extends [string, ...string[]]>(values: T, meta?: SchemaMetadata) =>
    withFormMeta(z.enum(values), { fieldType: 'radio', ...meta }),

  hidden: (meta?: SchemaMetadata) => withFormMeta(z.string(), { hidden: true, ...meta }),

  relation: (collection: string, displayField: string, meta?: SchemaMetadata) =>
    withFormMeta(z.string(), {
      fieldType: 'relation',
      relation: { collection, displayField },
      ...meta,
    }),
};

/**
 * Schema parser class for more complex parsing needs
 */
export class SchemaParser {
  /**
   * Parse a Zod schema into form config
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  parse<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    options?: Parameters<typeof parseSchema>[1]
  ): FormConfig {
    return parseSchema(schema, options);
  }

  /**
   * Parse and validate data against schema
   */
  validate<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    data: unknown
  ): { success: boolean; data?: z.infer<T>; errors?: Record<string, string[]> } {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      errors[path] ??= [];
      errors[path].push(issue.message);
    }

    return { success: false, errors };
  }

  /**
   * Get default values from schema
   */
  getDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T): Partial<z.infer<T>> {
    const defaults: Record<string, unknown> = {};
    const shape = schema.shape;

    for (const [name, fieldSchema] of Object.entries(shape)) {
      if (fieldSchema instanceof z.ZodDefault) {
        defaults[name] = (
          fieldSchema as unknown as { _def: { defaultValue: () => unknown } }
        )._def.defaultValue();
      }
    }

    return defaults as Partial<z.infer<T>>;
  }
}

/**
 * Create a schema parser
 */
export function createFormSchemaParser(): SchemaParser {
  return new SchemaParser();
}

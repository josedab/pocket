/**
 * Code generators that produce TypeScript interfaces, Zod schemas,
 * JSON Schema, and Pocket schema definitions from inferred schemas.
 *
 * @module
 */

import type { GeneratedSchema, InferredField, InferredSchema, OutputFormat } from './types.js';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fieldTypeToTS(field: InferredField): string {
  switch (field.type) {
    case 'string':
    case 'date':
      if (field.enumValues && field.enumValues.length > 0) {
        return field.enumValues.map(v => `'${v}'`).join(' | ');
      }
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array': {
      if (field.items && field.items.fields.size > 0) {
        const itemField = field.items.fields.values().next().value;
        if (itemField) {
          return `${fieldTypeToTS(itemField)}[]`;
        }
      }
      return 'unknown[]';
    }
    case 'object': {
      if (field.properties && field.properties.size > 0) {
        const props: string[] = [];
        for (const [name, prop] of field.properties) {
          const optional = prop.required ? '' : '?';
          const nullSuffix = prop.nullable ? ' | null' : '';
          props.push(`  ${name}${optional}: ${fieldTypeToTS(prop)}${nullSuffix};`);
        }
        return `{\n${props.join('\n')}\n}`;
      }
      return 'Record<string, unknown>';
    }
    case 'null':
      return 'null';
    default:
      return 'unknown';
  }
}

function generateTypeScript(schema: InferredSchema, name: string): string {
  const lines: string[] = [];
  lines.push(`/** Auto-generated from ${schema.totalDocumentsAnalyzed} documents */`);
  lines.push(`export interface ${capitalize(name)} {`);

  for (const [fieldName, field] of schema.fields) {
    const optional = field.required ? '' : '?';
    const nullSuffix = field.nullable ? ' | null' : '';
    const type = fieldTypeToTS(field);
    if (field.semanticType !== 'none') {
      lines.push(`  /** Detected: ${field.semanticType} */`);
    }
    lines.push(`  ${fieldName}${optional}: ${type}${nullSuffix};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function fieldTypeToZod(field: InferredField): string {
  let base: string;
  switch (field.type) {
    case 'string':
    case 'date':
      if (field.enumValues && field.enumValues.length > 0) {
        base = `z.enum([${field.enumValues.map(v => `'${v}'`).join(', ')}])`;
      } else if (field.semanticType === 'email') {
        base = 'z.string().email()';
      } else if (field.semanticType === 'url') {
        base = 'z.string().url()';
      } else if (field.semanticType === 'uuid') {
        base = 'z.string().uuid()';
      } else if (field.type === 'date') {
        base = 'z.string().datetime()';
      } else {
        base = 'z.string()';
      }
      break;
    case 'number':
      base = 'z.number()';
      break;
    case 'boolean':
      base = 'z.boolean()';
      break;
    case 'array': {
      if (field.items && field.items.fields.size > 0) {
        const itemField = field.items.fields.values().next().value;
        base = itemField ? `z.array(${fieldTypeToZod(itemField)})` : 'z.array(z.unknown())';
      } else {
        base = 'z.array(z.unknown())';
      }
      break;
    }
    case 'object': {
      if (field.properties && field.properties.size > 0) {
        const props: string[] = [];
        for (const [name, prop] of field.properties) {
          let zodType = fieldTypeToZod(prop);
          if (prop.nullable) zodType += '.nullable()';
          if (!prop.required) zodType += '.optional()';
          props.push(`  ${name}: ${zodType},`);
        }
        base = `z.object({\n${props.join('\n')}\n})`;
      } else {
        base = 'z.record(z.unknown())';
      }
      break;
    }
    case 'null':
      base = 'z.null()';
      break;
    default:
      base = 'z.unknown()';
  }
  return base;
}

function generateZod(schema: InferredSchema, name: string): string {
  const lines: string[] = [];
  lines.push(`import { z } from 'zod';`);
  lines.push('');
  lines.push(`/** Auto-generated from ${schema.totalDocumentsAnalyzed} documents */`);
  lines.push(`export const ${capitalize(name)}Schema = z.object({`);

  for (const [fieldName, field] of schema.fields) {
    let zodType = fieldTypeToZod(field);
    if (field.nullable) zodType += '.nullable()';
    if (!field.required) zodType += '.optional()';
    lines.push(`  ${fieldName}: ${zodType},`);
  }

  lines.push('});');
  lines.push('');
  lines.push(`export type ${capitalize(name)} = z.infer<typeof ${capitalize(name)}Schema>;`);
  return lines.join('\n');
}

function generateJsonSchema(schema: InferredSchema, name: string): string {
  function fieldToJsonSchema(field: InferredField): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    switch (field.type) {
      case 'string':
      case 'date':
        result['type'] = 'string';
        if (field.semanticType === 'email') result['format'] = 'email';
        if (field.semanticType === 'url') result['format'] = 'uri';
        if (field.semanticType === 'uuid') result['format'] = 'uuid';
        if (field.type === 'date') result['format'] = 'date-time';
        if (field.enumValues) result['enum'] = field.enumValues;
        if (field.pattern) result['pattern'] = field.pattern;
        break;
      case 'number':
        result['type'] = 'number';
        break;
      case 'boolean':
        result['type'] = 'boolean';
        break;
      case 'array':
        result['type'] = 'array';
        if (field.items && field.items.fields.size > 0) {
          const itemField = field.items.fields.values().next().value;
          if (itemField) result['items'] = fieldToJsonSchema(itemField);
        }
        break;
      case 'object':
        result['type'] = 'object';
        if (field.properties && field.properties.size > 0) {
          const props: Record<string, unknown> = {};
          const required: string[] = [];
          for (const [n, p] of field.properties) {
            props[n] = fieldToJsonSchema(p);
            if (p.required) required.push(n);
          }
          result['properties'] = props;
          if (required.length > 0) result['required'] = required;
        }
        break;
      case 'null':
        result['type'] = 'null';
        break;
      default:
        break;
    }
    return result;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of schema.fields) {
    properties[fieldName] = fieldToJsonSchema(field);
    if (field.required) required.push(fieldName);
  }

  const jsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: capitalize(name),
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  return JSON.stringify(jsonSchema, null, 2);
}

function generatePocketSchema(schema: InferredSchema, name: string): string {
  function fieldToPocket(field: InferredField): string {
    const parts: string[] = [];
    parts.push(`type: '${field.type}'`);
    parts.push(`required: ${field.required}`);
    if (field.enumValues) {
      parts.push(`enum: [${field.enumValues.map(v => `'${v}'`).join(', ')}]`);
    }
    if (field.pattern) {
      parts.push(`pattern: '${field.pattern}'`);
    }
    return `{ ${parts.join(', ')} }`;
  }

  const lines: string[] = [];
  lines.push(`/** Auto-generated Pocket schema from ${schema.totalDocumentsAnalyzed} documents */`);
  lines.push(`export const ${name}Schema = {`);
  lines.push(`  version: 1,`);
  lines.push(`  properties: {`);

  for (const [fieldName, field] of schema.fields) {
    lines.push(`    ${fieldName}: ${fieldToPocket(field)},`);
  }

  lines.push('  },');

  const requiredFields = [...schema.fields.entries()]
    .filter(([, f]) => f.required)
    .map(([n]) => `'${n}'`);

  if (requiredFields.length > 0) {
    lines.push(`  required: [${requiredFields.join(', ')}],`);
  }

  lines.push('};');
  return lines.join('\n');
}

/**
 * Generate schema code in the specified format.
 */
export function generateSchema(
  schema: InferredSchema,
  name: string,
  format: OutputFormat,
): GeneratedSchema {
  let code: string;

  switch (format) {
    case 'typescript':
      code = generateTypeScript(schema, name);
      break;
    case 'zod':
      code = generateZod(schema, name);
      break;
    case 'json-schema':
      code = generateJsonSchema(schema, name);
      break;
    case 'pocket-schema':
      code = generatePocketSchema(schema, name);
      break;
  }

  return { format, code, inferredSchema: schema };
}

/**
 * Generate schemas in all supported formats.
 */
export function generateAllFormats(
  schema: InferredSchema,
  name: string,
): readonly GeneratedSchema[] {
  const formats: OutputFormat[] = ['typescript', 'zod', 'json-schema', 'pocket-schema'];
  return formats.map(format => generateSchema(schema, name, format));
}

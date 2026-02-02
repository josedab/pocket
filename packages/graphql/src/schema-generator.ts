/**
 * GraphQL Schema Generator — auto-generates GraphQL SDL from
 * Pocket collection definitions.
 */

import type {
  CollectionDefinition,
  FieldDefinition,
  GraphQLFieldType,
  SchemaGeneratorConfig,
} from './types.js';

function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

function mapFieldType(field: FieldDefinition): GraphQLFieldType {
  switch (field.type) {
    case 'string':
      return 'String';
    case 'number':
      return Number.isInteger(field) ? 'Int' : 'Float';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'DateTime';
    case 'reference':
      return 'ID';
    case 'array':
      return 'JSON';
    case 'object':
      return 'JSON';
    default:
      return 'String';
  }
}

function graphqlType(field: FieldDefinition): string {
  const base = field.type === 'array'
    ? `[${field.items ? mapFieldType(field.items) : 'JSON'}]`
    : mapFieldType(field);
  return field.required ? `${base}!` : base;
}

/**
 * Generate a complete GraphQL schema string from collection definitions.
 */
export function generateSchema(config: SchemaGeneratorConfig): string {
  const {
    collections,
    includeSubscriptions = true,
    includeMutations = true,
  } = config;

  const parts: string[] = [];

  // Scalar definitions
  parts.push('scalar DateTime');
  parts.push('scalar JSON');
  parts.push('');

  // Type definitions
  for (const collection of collections) {
    parts.push(generateType(collection));
    parts.push(generateInputTypes(collection));
  }

  // Query type
  parts.push(generateQueryType(collections));

  // Mutation type
  if (includeMutations) {
    parts.push(generateMutationType(collections));
  }

  // Subscription type
  if (includeSubscriptions) {
    parts.push(generateSubscriptionType(collections));
  }

  return parts.join('\n');
}

function generateType(collection: CollectionDefinition): string {
  const typeName = toPascalCase(collection.name);
  const desc = collection.description ? `""" ${collection.description} """\n` : '';
  const fields = Object.entries(collection.fields)
    .map(([name, field]) => {
      const desc = field.description ? `  """ ${field.description} """\n` : '';
      return `${desc}  ${name}: ${graphqlType(field)}`;
    })
    .join('\n');

  return `${desc}type ${typeName} {
  _id: ID!
${fields}
  _createdAt: DateTime
  _updatedAt: DateTime
}
`;
}

function generateInputTypes(collection: CollectionDefinition): string {
  const typeName = toPascalCase(collection.name);

  const createFields = Object.entries(collection.fields)
    .map(([name, field]) => `  ${name}: ${graphqlType(field)}`)
    .join('\n');

  const updateFields = Object.entries(collection.fields)
    .map(([name, field]) => {
      const base = field.type === 'array'
        ? `[${field.items ? mapFieldType(field.items) : 'JSON'}]`
        : mapFieldType(field);
      return `  ${name}: ${base}`;
    })
    .join('\n');

  return `input Create${typeName}Input {
${createFields}
}

input Update${typeName}Input {
${updateFields}
}

input ${typeName}Filter {
${Object.entries(collection.fields)
  .filter(([, f]) => ['string', 'number', 'boolean', 'date', 'reference'].includes(f.type))
  .map(([name, field]) => `  ${name}: ${mapFieldType(field)}`)
  .join('\n')}
  _limit: Int
  _skip: Int
}
`;
}

function generateQueryType(collections: CollectionDefinition[]): string {
  const queries = collections
    .map((c) => {
      const type = toPascalCase(c.name);
      return `  ${c.name}(filter: ${type}Filter): [${type}!]!
  ${toPascalCase(c.name).toLowerCase()}ById(id: ID!): ${type}`;
    })
    .join('\n');

  return `type Query {
${queries}
}
`;
}

function generateMutationType(collections: CollectionDefinition[]): string {
  const mutations = collections
    .map((c) => {
      const type = toPascalCase(c.name);
      return `  create${type}(input: Create${type}Input!): ${type}!
  update${type}(id: ID!, input: Update${type}Input!): ${type}!
  delete${type}(id: ID!): Boolean!`;
    })
    .join('\n');

  return `type Mutation {
${mutations}
}
`;
}

function generateSubscriptionType(collections: CollectionDefinition[]): string {
  const subscriptions = collections
    .map((c) => {
      const type = toPascalCase(c.name);
      return `  ${c.name}Changed: ${type}!`;
    })
    .join('\n');

  return `type Subscription {
${subscriptions}
}
`;
}

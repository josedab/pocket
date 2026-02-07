# @pocket/schema-inference

[![npm](https://img.shields.io/npm/v/@pocket/schema-inference.svg)](https://www.npmjs.com/package/@pocket/schema-inference)
⚠️ **Experimental**

Automatic schema detection for Pocket — analyze documents, infer types, generate TypeScript and Zod schemas, and detect relationships.

## Installation

```bash
npm install @pocket/schema-inference @pocket/core
```

## Quick Start

```typescript
import { createInferenceEngine, generateSchema } from '@pocket/schema-inference';
import { Database } from '@pocket/core';

const db = await Database.create({ name: 'my-app', storage });

// Infer schema from existing documents
const engine = createInferenceEngine({ database: db });
const schema = await engine.infer('todos');

console.log(schema.fields);
// [{ name: 'title', type: 'string', required: true },
//  { name: 'completed', type: 'boolean', required: true }, ...]

// Generate TypeScript types or Zod schemas
const tsCode = generateSchema(schema, 'typescript');
const zodCode = generateSchema(schema, 'zod');
```

### Pattern Detection

```typescript
import { detectSemanticType } from '@pocket/schema-inference';

detectSemanticType('user@example.com'); // 'email'
detectSemanticType('2024-01-15');       // 'date'
detectSemanticType('192.168.1.1');      // 'ip-address'
```

### Relationship Detection

```typescript
import { createRelationshipDetector } from '@pocket/schema-inference';

const detector = createRelationshipDetector({ database: db });
const relationships = await detector.detect();
// [{ from: 'orders', to: 'users', field: 'userId', type: 'many-to-one' }]
```

### Migration Generation

```typescript
import { createMigrationGenerator } from '@pocket/schema-inference';

const generator = createMigrationGenerator({ database: db });
const migration = await generator.generate(oldSchema, newSchema);
```

## API

| Export | Description |
|--------|-------------|
| `createInferenceEngine(config)` | Analyze documents and infer schemas |
| `generateSchema(schema, format)` | Generate TypeScript, Zod, or JSON Schema |
| `generateAllFormats(schema)` | Generate all output formats at once |
| `detectSemanticType(value)` | Detect semantic type of a value |
| `createRelationshipDetector(config)` | Detect collection relationships |
| `createMigrationGenerator(config)` | Generate schema migrations |
| `createValidationSuggester(config)` | Suggest validation rules |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/schema-inference)

## License

MIT

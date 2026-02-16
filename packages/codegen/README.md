# @pocket/codegen

[![npm version](https://img.shields.io/npm/v/@pocket/codegen.svg)](https://www.npmjs.com/package/@pocket/codegen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Schema-driven code generation for Pocket - generate types, hooks, and validators from schema definitions

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/codegen
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createSchemaParser, TypeGenerator } from '@pocket/codegen';

const parser = createSchemaParser();
const schema = parser.parse(`
  collection todos {
    title: string
    completed: boolean
    createdAt: datetime
  }
`);

const typeGen = new TypeGenerator();
const code = typeGen.generate(schema);
```

## API

| Export | Description |
|--------|-------------|
| `createSchemaParser()` | Parse schema definitions into AST |
| `TypeGenerator` | Generate TypeScript type definitions |
| `HookGenerator` | Generate React hooks from schema |
| `MigrationGenerator` | Generate migration scripts from schema changes |
| `ValidationGenerator` | Generate runtime validators |
| `CRUDGenerator` | Generate CRUD operations |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/codegen

# Test
npx vitest run --project unit packages/codegen/src/__tests__/

# Watch mode
npx vitest --project unit packages/codegen/src/__tests__/
```

## License

MIT

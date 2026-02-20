# @pocket/codegen-fullstack

Schema-driven full-stack code generation for Pocket.

## Installation

```bash
pnpm add @pocket/codegen-fullstack
```

## Features

- Parse Pocket schemas into generator-friendly AST
- Generate TypeScript types from schemas
- Generate React hooks for data access
- Generate API route handlers
- Generate database migration files
- Unified code generator combining all outputs

## Usage

```typescript
import { createCodeGenerator, createSchemaParser } from '@pocket/codegen-fullstack';

const schema = createSchemaParser().parse(schemaFile);
const generator = createCodeGenerator({ outputDir: './generated' });
await generator.generate(schema);
```

## API Reference

- `createSchemaParser` — Parse schema definitions
- `createTypeGenerator` — Generate TypeScript types
- `createHooksGenerator` — Generate React hooks
- `createApiGenerator` — Generate API endpoints
- `createMigrationGenerator` — Generate migration files
- `createCodeGenerator` — Unified generator orchestrator

## License

MIT

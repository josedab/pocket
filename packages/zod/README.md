# @pocket/zod

Zod schema integration for Pocket database.

## Installation

```bash
pnpm add @pocket/zod
```

## Features

- Define Pocket schemas using Zod for runtime validation
- Convert between Pocket schemas and Zod schemas
- Partial, strict, and passthrough schema variants
- Document schema helper with built-in Pocket fields
- Merge multiple Zod schemas together

## Usage

```typescript
import { zodSchema, pocketToZod, zodToPocket } from '@pocket/zod';
import { z } from 'zod';

const userSchema = zodSchema(
  z.object({ name: z.string(), email: z.string().email() })
);

// Convert between formats
const zodVersion = pocketToZod(pocketSchema);
const pocketVersion = zodToPocket(zodObject);
```

## API Reference

- `zodSchema` — Create a Pocket schema from a Zod object
- `partialZodSchema` — Create a partial (all-optional) Pocket schema
- `documentSchema` — Zod schema with Pocket document fields included
- `pocketToZod` — Convert a Pocket schema to Zod
- `zodToPocket` — Convert a Zod schema to Pocket
- `mergeZodSchemas` — Merge two Zod schemas
- `strictZodSchema` — Strict-mode Zod schema
- `passthroughZodSchema` — Passthrough-mode Zod schema

## License

MIT

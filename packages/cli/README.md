# @pocket/cli

[![npm](https://img.shields.io/npm/v/@pocket/cli.svg)](https://www.npmjs.com/package/@pocket/cli)

Command-line interface for Pocket — manage databases, run migrations, generate types, and deploy.

## Installation

```bash
npm install -g @pocket/cli
```

## Quick Start

```bash
# Initialize a new Pocket project
pocket init

# Generate TypeScript types from your schema
pocket generate-types

# Run migrations
pocket migrate up

# Launch the visual Studio UI
pocket studio

# Export data
pocket export --format json
```

## Programmatic Usage

```typescript
import { defineConfig, init, generateTypes, migrate, exportData } from '@pocket/cli';

// Define project configuration
const config = defineConfig({
  database: { name: 'my-app' },
  collections: [{ name: 'todos' }]
});

// Run commands programmatically
await init({ name: 'my-app' });
await generateTypes({ output: './types' });
await migrate.up();
await exportData({ format: 'json', output: './backup' });
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new Pocket project |
| `generate-types` | Generate TypeScript types from schema |
| `migrate up / down / status` | Run or inspect migrations |
| `studio` | Launch the visual database Studio |
| `export` / `import` | Export or import data |
| `deploy` | Deploy to a hosting provider |

## Configuration

Create a `pocket.config.ts` in your project root:

```typescript
import { defineConfig } from '@pocket/cli';

export default defineConfig({
  database: { name: 'my-app' },
  studio: { port: 4000 }
});
```

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/cli)

## License

MIT

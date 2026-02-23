# @pocket/playground

Interactive browser-based sandbox for trying Pocket database APIs with live code execution.

## Installation

```bash
pnpm add @pocket/playground
```

## Features

- Browser-based code sandbox with live execution
- Preconfigured example templates
- Embeddable playground configuration
- Sandboxed execution environment

## Usage

```typescript
import { createPlaygroundSandbox, createExampleTemplates } from '@pocket/playground';

const sandbox = createPlaygroundSandbox();
const result = await sandbox.execute(`
  const db = createDatabase();
  db.collection('todos').insert({ title: 'Hello' });
`);

const templates = createExampleTemplates();
```

## API Reference

- `createPlaygroundSandbox` — Create an isolated execution sandbox
- `createCodeExecutor` — Execute code snippets
- `createPlaygroundConfig` — Configure playground settings
- `createExampleTemplates` — Built-in example templates
- `getTemplateByName` — Retrieve a template by name

## License

MIT

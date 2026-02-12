# Debugging

This guide covers debugging techniques and solutions to common issues when developing in the Pocket monorepo. It is extracted from the main [Development Guide](/DEVELOPMENT.md) for focused reference.

## Debug Logging

```typescript
// Enable debug output
DEBUG=pocket:* pnpm test

// Specific namespaces
DEBUG=pocket:sync,pocket:storage pnpm dev

// In code
import { debug } from './logger';
const log = debug('pocket:sync');
log('Syncing %d documents', docs.length);
```

## VS Code Debugging

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "--reporter=verbose", "${relativeFile}"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Package Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "--reporter=verbose"],
      "cwd": "${fileDirname}/../..",
      "console": "integratedTerminal"
    }
  ]
}
```

## Browser Debugging

```typescript
// DevTools integration
import { initDevTools } from '@pocket/devtools';

const db = await createDatabase({ ... });
initDevTools(db);

// Now available via the DevTools bridge inspector
```

## Common Issues

**Out of memory when running tests at root:**
```bash
# The monorepo has 44 packages — running vitest directly at root may OOM.
# Use turbo (pnpm test) or increase heap size:
NODE_OPTIONS="--max-old-space-size=8192" pnpm test:coverage
```

**Tests hang or timeout:**
```bash
# Check for unresolved promises
pnpm test -- --no-threads

# Increase timeout
pnpm test -- --test-timeout=30000
```

**IndexedDB errors in tests:**
```typescript
// Ensure fake-indexeddb is imported before any IndexedDB usage
import 'fake-indexeddb/auto';
```

**RxJS subscription leaks:**
```typescript
// Always unsubscribe in afterEach
let subscription: Subscription;

beforeEach(() => {
  subscription = observable.subscribe(...);
});

afterEach(() => {
  subscription?.unsubscribe();
});
```

## See Also

- [Development Guide](/DEVELOPMENT.md) — Main development overview
- [Testing Strategies](/docs/guide/testing.md)
- [Contributing Guidelines](/CONTRIBUTING.md)

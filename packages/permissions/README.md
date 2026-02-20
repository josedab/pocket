# @pocket/permissions

Permissions and row-level security for Pocket — fine-grained access control.

## Installation

```bash
pnpm add @pocket/permissions
```

## Features

- Role-based access control (RBAC)
- Row-level security policies
- Permission evaluation engine
- Centralized permission management

## Usage

```typescript
import { createPermissionManager, createPermissionEvaluator } from '@pocket/permissions';

const manager = createPermissionManager();
manager.addPolicy({ role: 'editor', collection: 'posts', actions: ['read', 'write'] });

const evaluator = createPermissionEvaluator(manager);
const allowed = evaluator.check({ user, action: 'write', collection: 'posts' });
```

## API Reference

- `createPermissionManager` / `PermissionManager` — Define and manage permission policies
- `createPermissionEvaluator` / `PermissionEvaluator` — Evaluate permissions against policies

## License

MIT

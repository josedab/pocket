# Package Development

This guide covers creating and working on packages within the Pocket monorepo. It is extracted from the main [Development Guide](/DEVELOPMENT.md) for focused reference.

## Monorepo Structure

```
pocket/
├── packages/           # All publishable packages
│   ├── core/          # @pocket/core
│   ├── react/         # @pocket/react
│   ├── sync/          # @pocket/sync
│   └── ...
├── examples/          # Example applications
├── test/              # Integration tests
├── docs/              # VitePress API docs (auto-generated)
├── website/           # Docusaurus documentation site (canonical)
└── benchmarks/        # Performance benchmarks
```

## Working on a Single Package

```bash
# Watch mode for a specific package
pnpm --filter @pocket/core dev

# Run tests for a specific package
pnpm --filter @pocket/core test

# Type check a specific package
pnpm --filter @pocket/core typecheck

# Build a specific package
pnpm --filter @pocket/core build
```

## Package Dependencies

```bash
# View dependency graph
pnpm why <package-name>

# Add a dependency to a package
pnpm --filter @pocket/sync add lodash

# Add a dev dependency
pnpm --filter @pocket/core add -D @types/node

# Add a workspace dependency
pnpm --filter @pocket/react add @pocket/core@workspace:*
```

## Creating a New Package

### Using the Scaffolding Script (Recommended)

The fastest way to create a new package is with the `create-package.mjs` scaffolding script:

```bash
# Basic usage
node scripts/create-package.mjs my-feature

# With description and category
node scripts/create-package.mjs my-feature --description "My feature package" --category extension

# With additional dependencies
node scripts/create-package.mjs my-feature --deps @pocket/sync

# See all options
node scripts/create-package.mjs --help
```

Available categories: `core`, `framework`, `storage`, `extension`, `tooling`, `platform`, `cloud`.

The script generates:
- `package.json` with standard fields and scripts
- `tsconfig.json` extending the base config
- `tsup.config.ts` for building
- `src/index.ts`, `src/types.ts`, and main implementation file
- `src/__tests__/*.test.ts` starter test

After creating a package:
```bash
pnpm install                                          # Update workspace
npx turbo run build --filter=@pocket/<name>           # Build
npx vitest run --project unit packages/<name>/        # Test
```

### Manual Setup

If you prefer to set up manually:

```bash
# 1. Create the package directory
mkdir packages/my-feature

# 2. Initialize with standard structure
cd packages/my-feature
pnpm init

# 3. Add required configuration files
```

Standard package structure:

```
packages/my-feature/
├── src/
│   ├── index.ts         # Public exports
│   └── *.ts             # Implementation
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

Minimal `package.json`:

```json
{
  "name": "@pocket/my-feature",
  "version": "0.1.0",
  "description": "Description of my feature",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pocket/core": "workspace:*"
  }
}
```

## See Also

- [Development Guide](/DEVELOPMENT.md) — Main development overview
- [Testing Strategies](/docs/guide/testing.md)
- [Contributing Guidelines](/CONTRIBUTING.md)

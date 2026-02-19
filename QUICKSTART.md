# Quick Start Guide

Make your first contribution to Pocket in under 5 minutes.

## 1. Set Up the Repository

```bash
git clone https://github.com/pocket-db/pocket.git
cd pocket
pnpm install
pnpm build
```

**System requirements:** Node.js ≥ 18 (recommended: 20, see `.nvmrc`), pnpm ≥ 8.12.0, 8 GB RAM minimum (16 GB recommended for full test suite).

> Using [nvm](https://github.com/nvm-sh/nvm)? Run `nvm use` to switch to the recommended Node version automatically.

## 2. Pick a Package to Work On

Not sure where to start? Here are the recommended entry points by experience level:

| Goal | Package | Why |
|------|---------|-----|
| **Understand the core** | [`@pocket/core`](./packages/core) | The database engine — small, well-tested, well-documented |
| **Add a React feature** | [`@pocket/react`](./packages/react) | React hooks — familiar patterns, great test examples |
| **Fix a storage bug** | [`@pocket/storage-memory`](./packages/storage-memory) | Simplest storage adapter — no browser APIs needed |
| **Improve tooling** | [`@pocket/cli`](./packages/cli) | CLI tool — self-contained, easy to test |

Browse all packages with `pnpm status` or check the [Package Status Matrix](./README.md#packages) in the README.

## 3. Build and Test a Single Package

You don't need to build or test the entire monorepo. Focus on one package:

```bash
# Build one package (and its dependencies)
npx turbo run build --filter=@pocket/core

# Run tests for one package
npx vitest run --project unit packages/core/src/__tests__/

# Watch mode for rapid iteration
npx vitest --project unit packages/core/src/__tests__/
```

## 4. Make a Change

Here's a minimal example — adding a utility function to `@pocket/core`:

```bash
# 1. Create a branch
git checkout -b fix/my-improvement

# 2. Edit source files under packages/core/src/

# 3. Add or update tests under packages/core/src/__tests__/

# 4. Verify your change builds and passes tests
npx turbo run build --filter=@pocket/core
npx vitest run --project unit packages/core/src/__tests__/
```

## 5. Validate Before Committing

```bash
# Run lint + typecheck on your changed package
pnpm lint
npx turbo run typecheck --filter=@pocket/core

# Or run the full CI suite locally
pnpm validate
```

> **Memory tip:** If you hit out-of-memory errors running the full suite, set:
> ```bash
> NODE_OPTIONS="--max-old-space-size=8192" pnpm validate
> ```

## 6. Create a Changeset and Submit

```bash
# Describe your change for the changelog
pnpm changeset

# Commit and push
git add .
git commit -m "fix(core): improve query performance"
git push origin fix/my-improvement
```

Then open a pull request against `main`. CI will run automatically.

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests (via Turbo, memory-safe) |
| `pnpm lint` | Lint all packages |
| `pnpm validate` | Full CI check: build → lint → typecheck → test |
| `pnpm status` | Show package maturity tiers and health |
| `pnpm health` | Detailed health dashboard (README, tests, exports) |
| `pnpm create-package my-feature` | Scaffold a new package |

## Creating a New Package

```bash
node scripts/create-package.mjs my-feature \
  --description "My awesome feature" \
  --category extension
```

This generates the full package structure including `package.json`, TypeScript config, source files, tests, and a README. See [DEVELOPMENT.md](./DEVELOPMENT.md) for details.

## Next Steps

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for full contribution guidelines
- Read [DEVELOPMENT.md](./DEVELOPMENT.md) for advanced topics (debugging, profiling, releases)
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the package dependency graph
- Browse [good first issues](https://github.com/pocket-db/pocket/labels/good%20first%20issue) for beginner-friendly tasks

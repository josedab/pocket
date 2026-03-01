---
sidebar_position: 99
title: Development Troubleshooting
description: Solutions for common contributor and development issues
---

# Development Troubleshooting

Solutions to common issues when contributing to or developing with the Pocket monorepo.

For end-user troubleshooting (installation, queries, sync, React), see the [general Troubleshooting page](/docs/troubleshooting).

---

## Out of Memory (OOM) Errors

### Symptom

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

### Cause

The monorepo has 70+ packages. Running `vitest run` at the root loads all tests into a single Node.js process, easily exceeding the default ~4 GB heap limit.

### Solution

**Option A — Use the Turbo-based runner (recommended):**

```bash
pnpm test
```

This runs tests per-package in isolated processes via Turbo.

**Option B — Increase the Node.js heap size:**

```bash
export NODE_OPTIONS="--max-old-space-size=8192"
```

Add this to your shell profile (`.bashrc`, `.zshrc`) for persistence. The `.env.example` file also documents this variable.

**Option C — Run tests for a single package:**

```bash
pnpm test:package @pocket/core
```

---

## Build Order Issues

### Symptom

```
Cannot find module '@pocket/core' or its corresponding type declarations
```

### Cause

Packages depend on each other. If you run `tsc` or `vitest` without building first, downstream packages cannot resolve their dependencies.

### Solution

Always build before testing or type-checking:

```bash
pnpm build    # Builds all packages in dependency order via Turbo
pnpm test     # Safe to run after build
```

To build and test a single package with its dependencies:

```bash
npx turbo run build --filter=@pocket/sync...
npx turbo run test --filter=@pocket/sync
```

The `...` suffix tells Turbo to include upstream dependencies.

---

## pnpm Version Mismatch

### Symptom

```
ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm version)
```

Or lockfile conflicts after `pnpm install`.

### Cause

The project pins `pnpm@8.12.0` via the `packageManager` field in `package.json`. Using a different version may cause lockfile format mismatches.

### Solution

```bash
# Install the exact version
corepack enable
corepack prepare pnpm@8.12.0 --activate

# Verify
pnpm --version
# Expected: 8.12.0
```

If you use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), ensure `corepack` is enabled for your Node.js installation:

```bash
nvm use 20
corepack enable
```

---

## Environment Variables

### Symptom

Missing API keys or configuration when running tests or cloud features.

### Solution

Copy the example file — the `pnpm quickstart` script does this automatically:

```bash
cp -n .env.example .env.local
```

All variables are optional; Pocket works without any configuration. See `.env.example` for available options.

---

## Full Validation Failing

### Symptom

`pnpm validate` fails but individual commands succeed.

### Cause

`pnpm validate` runs build, lint, typecheck, and test in sequence. Earlier steps may consume memory, causing later steps to OOM.

### Solution

```bash
# Run steps individually
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Or increase the heap size:

```bash
export NODE_OPTIONS="--max-old-space-size=8192"
pnpm validate
```

---

## Getting Help

If the issue isn't listed here:

1. **Search existing issues**: [GitHub Issues](https://github.com/nicepocket/pocket/issues)
2. **Ask the community**: [GitHub Discussions](https://github.com/nicepocket/pocket/discussions)
3. **Check the general troubleshooting page**: [Troubleshooting](/docs/troubleshooting)

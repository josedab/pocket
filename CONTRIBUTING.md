# Contributing to Pocket

Thank you for your interest in contributing to Pocket! This document provides guidelines and instructions for contributing.

Please note that this project is released with a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Prerequisites

- **Node.js** 18.0.0 or later
- **pnpm** 8.12.0 or later

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/pocket.git
   cd pocket
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Build all packages**

   ```bash
   pnpm build
   ```

4. **Run tests**

   ```bash
   pnpm test
   ```

## Project Structure

```
pocket/
├── packages/
│   ├── core/              # Core database engine
│   ├── react/             # React hooks and components
│   ├── sync/              # Sync engine
│   ├── server/            # Server-side sync endpoint
│   ├── storage-indexeddb/ # IndexedDB storage adapter
│   ├── storage-memory/    # In-memory storage adapter
│   ├── storage-opfs/      # OPFS storage adapter
│   └── pocket/            # All-in-one package
├── examples/
│   ├── todo-app/          # Todo example app
│   └── notes-app/         # Notes example app
└── test/                  # Integration tests
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-fix-name
```

### 2. Make Your Changes

- Write code following the existing style
- Add tests for new functionality
- Update documentation as needed

### 3. Run Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Type checking
pnpm typecheck
```

### 4. Lint and Format

```bash
# Lint code
pnpm lint

# Fix lint issues
pnpm lint:fix

# Check formatting
pnpm format:check

# Fix formatting
pnpm format
```

### 5. Create a Changeset

If your change affects any published packages, create a changeset:

```bash
pnpm changeset
```

Follow the prompts to describe your changes. This helps generate changelogs and version bumps.

### 6. Submit a Pull Request

1. Push your branch to your fork
2. Open a pull request against the `main` branch
3. Fill out the PR template
4. Wait for CI to pass
5. Request a review

## Code Guidelines

### TypeScript

- Use strict TypeScript (all strict checks are enabled)
- Avoid `any` when possible; use `unknown` and type narrowing
- Export types that consumers need
- Use JSDoc comments for public APIs

### Testing

- Write tests for new functionality
- Aim for high coverage on critical paths
- Use descriptive test names
- Test edge cases and error conditions

### Commits

- Use clear, descriptive commit messages
- Keep commits focused and atomic
- Reference issues when relevant (e.g., "Fix #123")

## Package Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages |
| `pnpm dev` | Build in watch mode |
| `pnpm test` | Run tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm typecheck` | Type checking |
| `pnpm lint` | Lint code |
| `pnpm lint:fix` | Fix lint issues |
| `pnpm format` | Format code |
| `pnpm format:check` | Check formatting |
| `pnpm changeset` | Create a changeset |
| `pnpm clean` | Clean build artifacts |

## Finding Issues to Work On

### Good First Issues

New to Pocket? Look for issues labeled [`good first issue`](https://github.com/pocket-db/pocket/labels/good%20first%20issue). These are specifically chosen to be approachable for newcomers.

### Help Wanted

Issues labeled [`help wanted`](https://github.com/pocket-db/pocket/labels/help%20wanted) are ready for community contributions and could use extra attention.

### Issue Labels

We use labels to categorize issues:

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Documentation improvements |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `area:core` | Related to @pocket/core |
| `area:react` | Related to @pocket/react |
| `area:sync` | Related to @pocket/sync |
| `area:storage` | Related to storage adapters |
| `priority:critical` | Must be fixed ASAP |
| `priority:high` | High priority |

## Getting Help

- **Questions**: Use [GitHub Discussions](https://github.com/pocket-db/pocket/discussions) for Q&A
- **Bugs**: Open an [issue](https://github.com/pocket-db/pocket/issues/new?template=bug_report.yml)
- **Features**: Open a [feature request](https://github.com/pocket-db/pocket/issues/new?template=feature_request.yml)
- Check existing issues before creating new ones

## License

By contributing to Pocket, you agree that your contributions will be licensed under the MIT License.

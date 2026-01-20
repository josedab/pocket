# ADR-005: Monorepo Structure

## Status

Accepted

## Context

Pocket consists of multiple related packages:
- Core database engine
- Storage adapters (IndexedDB, OPFS, Memory)
- React integration
- Sync engine
- Server utilities

These packages need to:
- Share common code and types
- Be versioned together (or linked)
- Be tested together
- Be developed efficiently

Two main approaches exist:
1. **Monorepo**: All packages in one repository
2. **Polyrepo**: Each package in its own repository

## Decision

Use a monorepo structure with pnpm workspaces and Turborepo.

### Structure

```
pocket/
├── packages/
│   ├── core/           # @pocket/core
│   ├── react/          # @pocket/react
│   ├── sync/           # @pocket/sync
│   ├── server/         # @pocket/server
│   ├── storage-indexeddb/
│   ├── storage-opfs/
│   ├── storage-memory/
│   └── pocket/         # pocket (umbrella package)
├── examples/
│   ├── todo-app/
│   └── notes-app/
├── docs/
├── benchmarks/
├── package.json        # Root workspace config
├── pnpm-workspace.yaml
└── turbo.json
```

### Tools

- **pnpm**: Package manager with workspace support
- **Turborepo**: Build orchestration and caching
- **Changesets**: Version management and changelogs
- **TypeScript**: Shared configuration
- **Vitest**: Testing framework

## Consequences

### Positive

- **Atomic changes**: Cross-package changes in single PR
- **Shared tooling**: One ESLint, TypeScript, test config
- **Linked development**: Changes to core immediately available to react
- **Easier refactoring**: Move code between packages easily
- **Single CI**: One pipeline for all packages
- **Consistent versioning**: Changesets manages linked versions

### Negative

- **Repository size**: All code in one repo
- **CI complexity**: Need to build/test affected packages only
- **Learning curve**: pnpm workspaces, Turborepo concepts
- **Merge conflicts**: More likely with multiple contributors

### Mitigations

1. **Turborepo caching**: Only rebuild changed packages
2. **Clear package boundaries**: Well-defined interfaces
3. **CODEOWNERS**: Route PRs to appropriate reviewers

## Package Relationships

```
                    ┌─────────────────┐
                    │     pocket      │
                    │  (umbrella pkg) │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  @pocket/core │◄───│ @pocket/react │    │  @pocket/sync │
└───────┬───────┘    └───────────────┘    └───────┬───────┘
        │                                         │
        │                                         │
        ▼                                         ▼
┌───────────────┐                         ┌───────────────┐
│ storage-*     │                         │ @pocket/server│
└───────────────┘                         └───────────────┘
```

## Version Strategy

Using Changesets with linked packages:

```json
// .changeset/config.json
{
  "linked": [
    ["@pocket/core", "@pocket/react", "@pocket/sync", "@pocket/storage-*"]
  ]
}
```

This means:
- Major bump to core = major bump to all
- Can release patch fixes independently
- Coordinated releases when needed

## Alternatives Considered

### 1. Polyrepo

Each package in its own repository.

Rejected because:
- Cross-package changes require multiple PRs
- Version coordination is manual
- Duplicated tooling configuration
- Harder to maintain consistency

### 2. Monorepo with npm/yarn workspaces

Use npm or yarn instead of pnpm.

Rejected because:
- pnpm is faster and more efficient
- Better handling of peer dependencies
- Stricter by default (prevents phantom dependencies)

### 3. Single Package

All code in one package.

```bash
npm install pocket
```

Rejected because:
- Users must install everything even if they only need core
- Harder to tree-shake unused code
- Storage adapters have different browser requirements

### 4. Nx

Use Nx instead of Turborepo.

Rejected because:
- More complex setup
- Turborepo is simpler and sufficient for our needs
- pnpm workspaces handle most requirements

## Development Workflow

### Local Development

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Build specific package
pnpm --filter @pocket/core build
```

### Adding Dependencies

```bash
# Add to specific package
pnpm --filter @pocket/react add react

# Add dev dependency to root
pnpm add -D -w typescript
```

### Creating a Changeset

```bash
pnpm changeset
# Select packages, bump type, description
```

## References

- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Changesets](https://github.com/changesets/changesets)
- [Monorepo.tools](https://monorepo.tools/)

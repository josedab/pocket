# Release Process

This guide covers the versioning and release workflow for Pocket packages. It is extracted from the main [Development Guide](/DEVELOPMENT.md) for focused reference.

## Versioning with Changesets

```bash
# 1. Create a changeset for your changes
pnpm changeset

# 2. Select affected packages and version bump type
# - patch: Bug fixes
# - minor: New features (backwards compatible)
# - major: Breaking changes

# 3. Write a summary for the changelog
```

## Release Workflow

```bash
# 1. Ensure main is up to date
git checkout main
git pull

# 2. Version packages (maintainers only)
pnpm changeset version

# 3. Review generated CHANGELOG.md entries

# 4. Commit version bumps
git add .
git commit -m "chore: version packages"

# 5. Publish to npm (maintainers only)
pnpm release

# 6. Push tags
git push --follow-tags
```

## Pre-release Versions

```bash
# Enter pre-release mode
pnpm changeset pre enter alpha

# Create changesets and version as normal
pnpm changeset
pnpm changeset version

# Exit pre-release mode
pnpm changeset pre exit
```

## See Also

- [Development Guide](/DEVELOPMENT.md) — Main development overview
- [Changelog](/CHANGELOG.md)
- [Contributing Guidelines](/CONTRIBUTING.md)

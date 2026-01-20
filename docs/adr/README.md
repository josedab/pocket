# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Pocket project.

## What are ADRs?

ADRs are documents that capture important architectural decisions made during the development of a project. They provide context, rationale, and consequences of these decisions.

## ADR Template

Each ADR follows this structure:

```markdown
# ADR-XXX: Title

## Status
Proposed | Accepted | Deprecated | Superseded by [ADR-YYY](./adr-yyy.md)

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](./adr-001-local-first-architecture.md) | Local-First Architecture | Accepted |
| [ADR-002](./adr-002-rxjs-for-reactivity.md) | RxJS for Reactivity | Accepted |
| [ADR-003](./adr-003-pluggable-storage-adapters.md) | Pluggable Storage Adapters | Accepted |
| [ADR-004](./adr-004-vector-clocks-for-sync.md) | Vector Clocks for Sync | Accepted |
| [ADR-005](./adr-005-monorepo-structure.md) | Monorepo Structure | Accepted |

## Creating a New ADR

1. Copy the template above
2. Create a new file: `adr-XXX-short-title.md`
3. Fill in all sections
4. Add to the index above
5. Submit for review

## References

- [Michael Nygard's ADR article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR GitHub organization](https://adr.github.io/)

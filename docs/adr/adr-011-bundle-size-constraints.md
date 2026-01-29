# ADR-011: Strict Bundle Size Constraints

## Status

Accepted

## Context

Web application bundle size directly impacts:
- **Initial load time**: Larger bundles = slower first paint
- **Parse time**: JavaScript must be parsed before execution
- **Memory usage**: More code = more memory consumption
- **Mobile performance**: Critical on slower devices/networks
- **SEO**: Core Web Vitals affect search rankings

Many database libraries are large:
- Firebase: ~100KB+ (with Firestore)
- PouchDB: ~45KB
- RxDB: ~35KB
- Dexie: ~20KB

Pocket aims to be competitive with the smallest while offering more features.

## Decision

Enforce strict bundle size limits for each package, monitored in CI.

### Size Budgets

| Package | Budget (gzip) | Rationale |
|---------|---------------|-----------|
| `@pocket/core` | 25KB | Core functionality only |
| `@pocket/react` | 8KB | Hooks are lightweight |
| `@pocket/sync` | 12KB | Sync protocol + transports |
| `@pocket/storage-indexeddb` | 5KB | Thin wrapper |
| `@pocket/storage-opfs` | 6KB | Worker communication |
| `@pocket/storage-sqlite` | 8KB | SQL generation |
| `pocket` (umbrella) | 45KB | Full stack |

### Measurement & Enforcement

```yaml
# .github/workflows/size-check.yml
- name: Check bundle sizes
  run: |
    pnpm build
    pnpm size-limit

# size-limit.config.js
module.exports = [
  {
    path: 'packages/core/dist/index.js',
    limit: '25 KB',
    gzip: true
  },
  {
    path: 'packages/react/dist/index.js',
    limit: '8 KB',
    gzip: true
  },
  // ... other packages
];
```

### Strategies for Staying Under Budget

#### 1. Tree-Shaking Support

All packages use ES modules with proper `sideEffects` marking:

```json
{
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

#### 2. Minimal Dependencies

```typescript
// BAD: Import entire lodash
import _ from 'lodash';
_.debounce(fn, 100);

// GOOD: Import only what's needed, or implement inline
import debounce from 'lodash/debounce';
// OR
function debounce(fn, ms) { /* 10 lines */ }
```

Dependency rules:
- No dependencies over 5KB (gzip) without review
- Prefer implementing small utilities inline
- RxJS is allowed (it's tree-shakable and essential)

#### 3. Code Splitting

Optional features loaded on demand:

```typescript
// Heavy features not in main bundle
const { createDevTools } = await import('@pocket/devtools');

// Storage adapters loaded separately
const { createSQLiteStorage } = await import('@pocket/storage-sqlite');
```

#### 4. No Dead Code

```typescript
// BAD: Export unused utilities
export function maybeUsefulSomeday() { }

// GOOD: Only export what's documented and tested
export function actuallyUsed() { }
```

### Size Comparison

| Library | Size (gzip) | Features |
|---------|-------------|----------|
| Pocket Core | 25KB | Reactive, typed, plugins |
| Dexie | 20KB | IndexedDB wrapper |
| RxDB | 35KB | Reactive, sync |
| PouchDB | 45KB | Sync, CouchDB compat |
| Firebase | 100KB+ | Full BaaS |

### Monitoring Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│                  Bundle Size Trends                          │
│                                                              │
│  @pocket/core                                                │
│  ████████████████████░░░░░ 20.1KB / 25KB (80%)              │
│                                                              │
│  @pocket/react                                               │
│  ██████████████░░░░░░░░░░░ 5.8KB / 8KB (72%)                │
│                                                              │
│  @pocket/sync                                                │
│  ████████████████████████░ 11.2KB / 12KB (93%) ⚠️           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive

- **Fast loading**: Users get functional app quickly
- **Mobile-friendly**: Works well on 3G networks
- **Developer trust**: Size limits prevent bloat creep
- **Competitive**: Matches or beats alternatives
- **Maintainability**: Forces careful dependency choices

### Negative

- **Development friction**: Must consider size impact of changes
- **Feature constraints**: Some features may not fit budget
- **Tooling overhead**: CI checks add complexity
- **Possible rejections**: PRs may be rejected for size

### Mitigations

1. **Clear guidelines**: Document what adds size and alternatives
2. **Optional packages**: Heavy features in separate packages
3. **Bundler configs**: Provide example configs for optimal tree-shaking
4. **Size analysis**: Tools to analyze what's contributing to size

## Alternatives Considered

### 1. No Size Limits

Let packages grow as needed.

Rejected because:
- Leads to gradual bloat
- Users surprised by size over time
- Competitive disadvantage

### 2. Single Package Size Limit

Only limit total umbrella package.

Rejected because:
- Doesn't help users who import individual packages
- Doesn't identify which package is growing

### 3. Runtime-Only Limits

Only measure runtime code, not types.

This is already the case—TypeScript types are stripped and don't count toward limits.

### 4. Larger Budgets

Set more generous limits (e.g., 50KB per package).

Rejected because:
- Removes pressure to optimize
- Generous limits become targets, not limits
- Better to start strict and relax if truly needed

## Implementation

### Size Limit Configuration

```javascript
// size-limit.config.js
module.exports = [
  {
    name: '@pocket/core',
    path: 'packages/core/dist/index.js',
    limit: '25 KB',
    gzip: true,
    running: false  // Don't execute, just measure
  },
  {
    name: '@pocket/core (tree-shaken)',
    path: 'packages/core/dist/index.js',
    import: '{ Database }',  // Test tree-shaking
    limit: '15 KB',
    gzip: true
  }
];
```

### PR Check

```yaml
# When PR changes package code
- name: Compare sizes
  run: |
    # Get base branch sizes
    git checkout ${{ github.base_ref }}
    pnpm build && pnpm size-limit --json > base-sizes.json

    # Get PR sizes
    git checkout ${{ github.head_ref }}
    pnpm build && pnpm size-limit --json > pr-sizes.json

    # Compare and comment
    node scripts/compare-sizes.js
```

## References

- [Size Limit](https://github.com/ai/size-limit)
- [Bundlephobia](https://bundlephobia.com/)
- [Web.dev - Reduce JavaScript Payloads](https://web.dev/reduce-javascript-payloads-with-tree-shaking/)
- [Google Performance Budgets](https://web.dev/performance-budgets-101/)

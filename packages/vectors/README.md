# @pocket/vectors

[![npm version](https://img.shields.io/npm/v/@pocket/vectors.svg)](https://www.npmjs.com/package/@pocket/vectors)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-ready vector store for Pocket database with semantic search

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/vectors
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createVectorStore, createHNSWIndex } from '@pocket/vectors';

const store = createVectorStore({
  database: db,
  dimensions: 384,
  index: createHNSWIndex({ efConstruction: 200 }),
});

// Add vectors
await store.add('doc-1', embedding, { title: 'My Document' });

// Semantic search
const results = await store.search(queryEmbedding, { topK: 10 });
```

## API

| Export | Description |
|--------|-------------|
| `createVectorStore(config)` | Create a vector store for embeddings |
| `createHNSWIndex(config)` | HNSW index for approximate nearest neighbor |
| `createFlatIndex(config)` | Flat (exact) nearest neighbor index |
| `cosineSimilarity(a, b)` | Cosine similarity distance function |
| `euclideanDistance(a, b)` | Euclidean distance function |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/vectors

# Test
npx vitest run --project unit packages/vectors/src/__tests__/

# Watch mode
npx vitest --project unit packages/vectors/src/__tests__/
```

## License

MIT

# @pocket/ai

[![npm version](https://img.shields.io/npm/v/@pocket/ai.svg)](https://www.npmjs.com/package/@pocket/ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Offline AI assistant for Pocket with local LLM inference and RAG

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/ai
```

**Peer dependencies:** `@pocket/core`, `@pocket/vectors`

## Usage

```typescript
import { createAIAssistant, createRAGPipeline } from '@pocket/ai';

const assistant = createAIAssistant({
  database: db,
  provider: 'openai',
});

// RAG pipeline for context-aware queries
const rag = createRAGPipeline({ database: db });
const answer = await rag.query('What tasks are due this week?');
```

## API

| Export | Description |
|--------|-------------|
| `createAIAssistant(config)` | Create an AI assistant with local LLM inference |
| `createRAGPipeline(config)` | Build a retrieval-augmented generation pipeline |
| `createSmartQuery(config)` | Natural language to database query conversion |
| `createSemanticSearch(config)` | Semantic similarity search over documents |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/ai

# Test
npx vitest run --project unit packages/ai/src/__tests__/

# Watch mode
npx vitest --project unit packages/ai/src/__tests__/
```

## License

MIT

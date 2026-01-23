---
sidebar_position: 11
title: Vectors & AI Integration
description: Add semantic search and AI capabilities with vector embeddings
---

# Vectors & AI Integration

Pocket provides built-in support for vector embeddings and AI integration, enabling semantic search and RAG (Retrieval-Augmented Generation) in your local-first applications.

## Overview

The `@pocket/vectors` and `@pocket/ai` packages provide:
- **Vector storage** with multiple index types (flat, HNSW)
- **Embedding providers** for OpenAI, Cohere, Ollama
- **Semantic search** with similarity scoring
- **RAG pipeline** for context-aware AI responses
- **AI assistants** with conversation history

## Installation

```bash
npm install @pocket/core @pocket/vectors @pocket/ai
```

## Vector Storage

### Creating a Vector Store

```typescript
import { createVectorStore, createOpenAIEmbedding } from '@pocket/vectors';

// Create embedding function
const embeddings = createOpenAIEmbedding({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
});

// Create vector store
const vectorStore = createVectorStore({
  name: 'documents',
  dimensions: 1536, // Must match embedding model
  embeddingFunction: embeddings,
  indexType: 'flat', // or 'hnsw' for large datasets
  metric: 'cosine',
});
```

### Configuration Options

```typescript
interface VectorStoreConfig {
  // Required
  name: string;
  dimensions: number;

  // Optional
  metric?: 'cosine' | 'euclidean' | 'dotProduct'; // Default: 'cosine'
  embeddingFunction?: EmbeddingFunction;
  indexType?: 'flat' | 'hnsw'; // Default: 'flat'
  hnswParams?: HNSWParams;
  cacheEmbeddings?: boolean; // Default: true
  maxCacheSize?: number; // Default: 10000
}
```

### Adding Vectors

```typescript
// Add with text (auto-embed)
await vectorStore.upsert('doc-1', 'This is the document content', {
  title: 'My Document',
  category: 'notes',
});

// Add with pre-computed vector
await vectorStore.upsert('doc-2', [0.1, 0.2, ...], {
  title: 'Another Document',
});

// Batch upsert
await vectorStore.upsertBatch([
  { id: 'doc-3', text: 'First document text', metadata: { type: 'article' } },
  { id: 'doc-4', text: 'Second document text', metadata: { type: 'note' } },
]);
```

### Semantic Search

```typescript
// Search by text query
const results = await vectorStore.search({
  text: 'machine learning concepts',
  limit: 10,
  minScore: 0.7,
});

for (const result of results) {
  console.log(`${result.id}: ${result.score.toFixed(3)}`);
  console.log(`  Text: ${result.text}`);
  console.log(`  Metadata:`, result.metadata);
}

// Search by vector
const results = await vectorStore.search({
  vector: queryVector,
  limit: 5,
  includeVectors: true,
});

// Search with metadata filter
const results = await vectorStore.search({
  text: 'project updates',
  filter: { category: 'work' },
  limit: 10,
});
```

### Finding Similar Items

```typescript
// Find documents similar to a given document
const similar = await vectorStore.findSimilar('doc-1', {
  limit: 5,
  minScore: 0.8,
});
```

## Embedding Providers

### OpenAI

```typescript
import { createOpenAIEmbedding } from '@pocket/vectors';

const embeddings = createOpenAIEmbedding({
  apiKey: 'your-api-key',
  model: 'text-embedding-3-small', // or 'text-embedding-3-large'
});

// Dimensions by model:
// - text-embedding-3-small: 1536
// - text-embedding-3-large: 3072
// - text-embedding-ada-002: 1536
```

### Cohere

```typescript
import { createCohereEmbedding } from '@pocket/vectors';

const embeddings = createCohereEmbedding({
  apiKey: 'your-api-key',
  model: 'embed-english-v3.0',
});

// Dimensions by model:
// - embed-english-v3.0: 1024
// - embed-multilingual-v3.0: 1024
// - embed-english-light-v3.0: 384
```

### Ollama (Local)

```typescript
import { createOllamaEmbedding } from '@pocket/vectors';

const embeddings = createOllamaEmbedding({
  model: 'nomic-embed-text',
  baseUrl: 'http://localhost:11434',
  dimensions: 768,
});
```

### Custom Embedding Function

```typescript
import { createCustomEmbedding } from '@pocket/vectors';

const embeddings = createCustomEmbedding(
  async (text: string) => {
    // Your embedding logic
    return myEmbeddingModel.embed(text);
  },
  384, // dimensions
  'my-model',
  // Optional batch function
  async (texts: string[]) => {
    return myEmbeddingModel.embedBatch(texts);
  }
);
```

## Vector Collection Integration

Wrap a Pocket collection with vector search capabilities:

```typescript
import { Database } from '@pocket/core';
import { createVectorCollection, createOpenAIEmbedding } from '@pocket/vectors';

interface Article {
  _id: string;
  title: string;
  content: string;
  tags: string[];
}

const db = await Database.create({ name: 'my-app', storage });
const articles = db.collection<Article>('articles');

// Create vector-enabled collection
const vectorArticles = createVectorCollection(articles, {
  embeddingFunction: createOpenAIEmbedding({ apiKey: process.env.OPENAI_API_KEY }),
  textFields: ['title', 'content'], // Fields to embed
  autoIndex: true, // Auto-index new documents
  indexType: 'hnsw',
});

// Index existing documents
await vectorArticles.indexAll();
```

### Custom Text Extraction

```typescript
const vectorArticles = createVectorCollection(articles, {
  embeddingFunction: embeddings,
  textFields: ['title', 'content'],
  textExtractor: (doc) => {
    // Custom logic to extract text for embedding
    return `${doc.title}\n\n${doc.content}\n\nTags: ${doc.tags.join(', ')}`;
  },
});
```

### Semantic Search on Collection

```typescript
// Search returns documents with similarity scores
const results = await vectorArticles.search('machine learning tutorials', {
  limit: 10,
  minScore: 0.6,
});

for (const result of results) {
  console.log(`Score: ${result.score.toFixed(3)}`);
  console.log(`Title: ${result.document?.title}`);
}

// Find similar documents
const similar = await vectorArticles.findSimilar('article-123', {
  limit: 5,
});
```

### Index State Monitoring

```typescript
// Get current indexing state
const state = vectorArticles.getState();
console.log(`Indexed: ${state.indexedCount}`);
console.log(`Pending: ${state.pendingCount}`);
console.log(`Is indexing: ${state.isIndexing}`);

// Subscribe to state changes
vectorArticles.state().subscribe((state) => {
  console.log(`Index updated: ${state.indexedCount} documents`);
});
```

## AI Assistant with RAG

Create an AI assistant that uses your local data as context:

```typescript
import { createAIAssistant } from '@pocket/ai';
import { createVectorCollection, createOpenAIEmbedding } from '@pocket/vectors';

// Setup vector collection
const vectorNotes = createVectorCollection(notes, {
  embeddingFunction: createOpenAIEmbedding({ apiKey: process.env.OPENAI_API_KEY }),
  textFields: ['title', 'content'],
});

// Create AI assistant
const assistant = createAIAssistant(vectorNotes, {
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7,
    maxTokens: 1000,
  },
  rag: {
    topK: 5,
    minScore: 0.5,
    maxContextLength: 8000,
  },
  systemPrompt: 'You are a helpful assistant with access to the user\'s notes.',
});
```

### Querying the Assistant

```typescript
// Query with RAG context
const result = await assistant.query('What did I write about React hooks?');

console.log('Response:', result.response);
console.log('Processing time:', result.processingTime, 'ms');
console.log('Context documents:');
for (const ctx of result.context) {
  console.log(`  - ${ctx.document.title} (score: ${ctx.score.toFixed(3)})`);
}
```

### Streaming Responses

```typescript
// Stream the response
assistant.stream('Summarize my project notes').subscribe({
  next: (chunk) => {
    if (chunk.context) {
      console.log('Context retrieved:', chunk.context.length, 'documents');
    }
    process.stdout.write(chunk.text);
  },
  complete: () => console.log('\n--- Done ---'),
  error: (err) => console.error('Error:', err),
});
```

### Conversation History

```typescript
// Multi-turn conversation
await assistant.query('What are my todos for this week?');
await assistant.query('Which ones are most urgent?'); // Uses conversation context

// Get history
const history = assistant.getHistory();

// Clear history for new conversation
assistant.clearHistory();
```

### Direct Chat (Without RAG)

```typescript
// Simple chat without document retrieval
const response = await assistant.chat('Hello, how are you?');
```

## LLM Providers

### OpenAI

```typescript
import { createOpenAIAssistant } from '@pocket/ai';

const assistant = createOpenAIAssistant(
  vectorCollection,
  process.env.OPENAI_API_KEY,
  'gpt-4o-mini' // or 'gpt-4o', 'gpt-4-turbo'
);
```

### Anthropic

```typescript
import { createAnthropicAssistant } from '@pocket/ai';

const assistant = createAnthropicAssistant(
  vectorCollection,
  process.env.ANTHROPIC_API_KEY,
  'claude-3-haiku-20240307' // or 'claude-3-sonnet', 'claude-3-opus'
);
```

### Ollama (Local)

```typescript
import { createOllamaAssistant } from '@pocket/ai';

const assistant = createOllamaAssistant(
  vectorCollection,
  'llama3.2',
  'http://localhost:11434'
);
```

## RAG Pipeline

For more control over the retrieval and generation process:

```typescript
import { createRAGPipeline } from '@pocket/ai';

const ragPipeline = createRAGPipeline(vectorCollection, {
  topK: 5,
  minScore: 0.5,
  maxContextLength: 8000,
  includeMetadata: true,
  promptTemplate: `You are a helpful assistant.

Context from documents:
{context}

User question: {query}

Please answer based on the context provided.`,
});

// Retrieve documents
const documents = await ragPipeline.retrieve('search query');

// Build context string
const context = ragPipeline.buildContext(documents);

// Build full prompt
const prompt = ragPipeline.buildPrompt('user question', documents, {
  additionalContext: 'Extra context here',
});
```

## Distance Metrics

Pocket supports multiple distance metrics for similarity calculations:

```typescript
import {
  cosineSimilarity,
  cosineDistance,
  euclideanDistance,
  dotProduct,
} from '@pocket/vectors';

// Cosine similarity (returns -1 to 1)
const similarity = cosineSimilarity(vectorA, vectorB);

// Cosine distance (returns 0 to 2)
const distance = cosineDistance(vectorA, vectorB);

// Euclidean distance
const euclidean = euclideanDistance(vectorA, vectorB);

// Dot product
const dot = dotProduct(vectorA, vectorB);
```

### Choosing a Metric

| Metric | Best For | Range |
|--------|----------|-------|
| `cosine` | Text similarity, normalized vectors | 0-2 (distance), -1 to 1 (similarity) |
| `euclidean` | Spatial relationships, raw vectors | 0 to infinity |
| `dotProduct` | When magnitude matters | -infinity to infinity |

## Index Types

### Flat Index

Best for small datasets (< 10,000 vectors):

```typescript
const vectorStore = createVectorStore({
  name: 'small-collection',
  dimensions: 1536,
  indexType: 'flat',
});
```

- Exact nearest neighbor search
- O(n) search time
- Low memory overhead

### HNSW Index

Best for large datasets (> 10,000 vectors):

```typescript
const vectorStore = createVectorStore({
  name: 'large-collection',
  dimensions: 1536,
  indexType: 'hnsw',
  hnswParams: {
    efConstruction: 200, // Build quality (higher = better, slower)
    efSearch: 100,       // Search quality
    m: 16,               // Links per node
    m0: 32,              // Links in layer 0
  },
});
```

- Approximate nearest neighbor search
- O(log n) search time
- Higher memory usage

## React Integration

### useVectorSearch Hook

```tsx
import { useState, useEffect } from 'react';
import type { VectorCollection, VectorSearchResult } from '@pocket/vectors';

function useVectorSearch<T>(
  vectorCollection: VectorCollection<T>,
  query: string,
  options?: { limit?: number; minScore?: number }
) {
  const [results, setResults] = useState<VectorSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    vectorCollection
      .search(query, options)
      .then(setResults)
      .catch(setError)
      .finally(() => setIsSearching(false));
  }, [query, vectorCollection, options?.limit, options?.minScore]);

  return { results, isSearching, error };
}

// Usage
function SearchComponent() {
  const [query, setQuery] = useState('');
  const { results, isSearching } = useVectorSearch(vectorNotes, query, {
    limit: 10,
    minScore: 0.5,
  });

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Semantic search..."
      />
      {isSearching && <p>Searching...</p>}
      {results.map((result) => (
        <div key={result.id}>
          <strong>{result.document?.title}</strong>
          <span>Score: {(result.score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
```

### useAIAssistant Hook

```tsx
import { useState, useCallback } from 'react';
import type { AIAssistant, AIQueryResult } from '@pocket/ai';

function useAIAssistant<T>(assistant: AIAssistant<T>) {
  const [response, setResponse] = useState<string>('');
  const [context, setContext] = useState<ContextDocument<T>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const query = useCallback(async (question: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await assistant.query(question);
      setResponse(result.response);
      setContext(result.context);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Query failed'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [assistant]);

  const streamQuery = useCallback((question: string) => {
    setIsLoading(true);
    setError(null);
    setResponse('');

    return assistant.stream(question).subscribe({
      next: (chunk) => {
        if (chunk.context) {
          setContext(chunk.context);
        }
        setResponse(chunk.accumulated);
      },
      error: (err) => {
        setError(err);
        setIsLoading(false);
      },
      complete: () => setIsLoading(false),
    });
  }, [assistant]);

  return {
    response,
    context,
    isLoading,
    error,
    query,
    streamQuery,
    clearHistory: assistant.clearHistory.bind(assistant),
  };
}

// Usage
function ChatInterface() {
  const { response, context, isLoading, query, streamQuery } = useAIAssistant(assistant);
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    streamQuery(input);
    setInput('');
  };

  return (
    <div>
      <div className="context">
        {context.map((doc, i) => (
          <span key={i} title={doc.text}>
            Source: {doc.document?.title} ({(doc.score * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
      <div className="response">{response}</div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
        disabled={isLoading}
      />
      <button onClick={handleSubmit} disabled={isLoading}>
        {isLoading ? 'Thinking...' : 'Ask'}
      </button>
    </div>
  );
}
```

## Best Practices

### 1. Choose the Right Embedding Model

- **text-embedding-3-small** (1536d): Good balance of quality and cost
- **text-embedding-3-large** (3072d): Best quality, higher cost
- **Ollama/local models**: Free, runs locally, varies by model

### 2. Optimize Batch Operations

```typescript
// Good: Batch embedding
await vectorStore.upsertBatch(items);

// Avoid: Individual inserts in a loop
for (const item of items) {
  await vectorStore.upsert(item.id, item.text);
}
```

### 3. Cache Embeddings

```typescript
const vectorStore = createVectorStore({
  name: 'docs',
  dimensions: 1536,
  embeddingFunction: embeddings,
  cacheEmbeddings: true,
  maxCacheSize: 10000,
});

// Check cache stats
const stats = vectorStore.getStats();
console.log('Cache hit rate:', stats.cacheHitRate);
```

### 4. Use HNSW for Large Datasets

```typescript
// For > 10k vectors, use HNSW
const vectorStore = createVectorStore({
  name: 'large-docs',
  dimensions: 1536,
  indexType: 'hnsw',
  hnswParams: {
    efConstruction: 200,
    efSearch: 100,
  },
});
```

### 5. Set Appropriate minScore

```typescript
// Filter low-quality results
const results = await vectorStore.search({
  text: query,
  minScore: 0.6, // Only return results > 60% similarity
  limit: 10,
});
```

### 6. Monitor Index State

```typescript
vectorCollection.state().subscribe((state) => {
  if (state.pendingCount > 0) {
    console.log(`Indexing: ${state.pendingCount} documents pending`);
  }
});
```

## Complete Example

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createVectorCollection, createOpenAIEmbedding } from '@pocket/vectors';
import { createAIAssistant } from '@pocket/ai';

interface Note {
  _id: string;
  title: string;
  content: string;
  createdAt: number;
}

// Initialize database
const db = await Database.create({
  name: 'notes-app',
  storage: createIndexedDBStorage(),
});

const notes = db.collection<Note>('notes');

// Create embedding function
const embeddings = createOpenAIEmbedding({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create vector collection
const vectorNotes = createVectorCollection(notes, {
  embeddingFunction: embeddings,
  textFields: ['title', 'content'],
  autoIndex: true,
});

// Index existing notes
console.log('Indexing notes...');
const { indexed, failed } = await vectorNotes.indexAll();
console.log(`Indexed ${indexed} notes, ${failed} failed`);

// Create AI assistant
const assistant = createAIAssistant(vectorNotes, {
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
  },
  rag: {
    topK: 5,
    minScore: 0.5,
  },
  systemPrompt: 'You are a helpful assistant for a note-taking app. Answer questions based on the user\'s notes.',
});

// Semantic search
const searchResults = await vectorNotes.search('project deadlines', {
  limit: 5,
});

// AI query with RAG
const aiResult = await assistant.query('What are my upcoming deadlines?');
console.log(aiResult.response);
console.log('Based on:', aiResult.context.map(c => c.document?.title).join(', '));
```

## See Also

- [Full-Text Search](/docs/guides/full-text-search) - Keyword-based search
- [Plugin System](/docs/guides/plugins) - Extend with custom hooks
- [React Integration](/docs/guides/react-integration) - React hooks

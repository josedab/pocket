---
sidebar_position: 8
title: Full-Text Search
description: Implement full-text search with Pocket's built-in search index
---

# Full-Text Search

Pocket includes a full-text search engine that runs entirely in the browser. Search your documents with relevance scoring, stemming, fuzzy matching, and highlighting.

## Overview

The search index uses:
- **BM25 scoring** for relevance ranking
- **Porter stemming** for word normalization (searching "running" finds "run")
- **Stop word filtering** to ignore common words
- **Fuzzy matching** to handle typos
- **Field weighting** to prioritize certain fields

## Creating a Search Index

```typescript
import { createSearchIndex } from '@pocket/core';

interface Article {
  _id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
}

const searchIndex = createSearchIndex<Article>({
  fields: ['title', 'content', 'author'],
  weights: {
    title: 3,    // Title matches are 3x more important
    content: 1,
    author: 2,
  },
});
```

## Configuration Options

```typescript
const searchIndex = createSearchIndex<Article>({
  // Required: fields to index
  fields: ['title', 'content', 'summary'],

  // Optional: field importance weights (default: 1)
  weights: {
    title: 3,
    summary: 2,
    content: 1,
  },

  // Optional: language for stemming (default: 'en')
  language: 'en',

  // Optional: minimum word length to index (default: 2)
  minWordLength: 2,

  // Optional: maximum word length to index (default: 50)
  maxWordLength: 50,

  // Optional: additional stop words to ignore
  stopWords: ['custom', 'words', 'to', 'ignore'],

  // Optional: enable fuzzy matching by default (default: false)
  fuzzy: true,

  // Optional: fuzzy match distance 1-3 (default: 1)
  fuzzyDistance: 1,
});
```

## Indexing Documents

### Add Single Document

```typescript
const article = {
  _id: 'article-1',
  title: 'Getting Started with TypeScript',
  content: 'TypeScript is a typed superset of JavaScript...',
  author: 'Jane Doe',
  tags: ['typescript', 'javascript'],
};

searchIndex.add(article);
```

### Add Multiple Documents

```typescript
const articles = await db.collection<Article>('articles').find().exec();
searchIndex.addMany(articles);
```

### Update Document

```typescript
// Updates or inserts the document
searchIndex.update(updatedArticle);
```

### Remove Document

```typescript
searchIndex.remove('article-1');
```

## Searching

### Basic Search

```typescript
const results = searchIndex.search('typescript tutorial');

console.log(`Found ${results.total} results in ${results.executionTimeMs}ms`);

for (const result of results.results) {
  console.log(`${result.document.title} (score: ${result.score})`);
}
```

### Search with Options

```typescript
const results = searchIndex.search('typescript', {
  // Pagination
  limit: 10,
  offset: 0,

  // Minimum relevance score (0-1)
  minScore: 0.1,

  // Search only specific fields
  fields: ['title', 'content'],

  // Enable highlighting
  highlight: true,
  highlightPrefix: '<mark>',
  highlightSuffix: '</mark>',

  // Enable fuzzy matching for this query
  fuzzy: true,

  // Boost specific fields for this query
  boosts: {
    title: 5,
  },
});
```

### Search Results Structure

```typescript
interface SearchResults<T> {
  // Matched documents with metadata
  results: Array<{
    document: T;           // The original document
    score: number;         // Relevance score (0-1)
    matches: SearchMatch[];// Match details
    highlights?: Record<string, string>; // Highlighted text
  }>;

  // Total matches before pagination
  total: number;

  // Query execution time
  executionTimeMs: number;

  // Terms that were searched (after stemming)
  searchedTerms: string[];
}
```

## Highlighting

Enable highlighting to show matched terms in context:

```typescript
const results = searchIndex.search('typescript', {
  highlight: true,
  highlightPrefix: '<strong>',
  highlightSuffix: '</strong>',
});

for (const result of results.results) {
  if (result.highlights) {
    console.log('Title:', result.highlights.title);
    // "Getting Started with <strong>TypeScript</strong>"

    console.log('Content:', result.highlights.content);
    // "<strong>TypeScript</strong> is a typed superset..."
  }
}
```

### Custom Highlighting

```tsx
// React component with search highlighting
function SearchResult({ result }: { result: SearchResult<Article> }) {
  return (
    <div>
      <h3
        dangerouslySetInnerHTML={{
          __html: result.highlights?.title ?? result.document.title,
        }}
      />
      <p
        dangerouslySetInnerHTML={{
          __html: result.highlights?.content ?? result.document.content,
        }}
      />
      <span>Score: {(result.score * 100).toFixed(0)}%</span>
    </div>
  );
}
```

## Fuzzy Matching

Fuzzy matching finds results even with typos:

```typescript
const searchIndex = createSearchIndex<Article>({
  fields: ['title', 'content'],
  fuzzy: true,       // Enable by default
  fuzzyDistance: 1,  // Allow 1 character difference
});

// Finds "typescript" even with typo
const results = searchIndex.search('typscript');
```

### Per-Query Fuzzy

```typescript
// Enable fuzzy just for this query
const results = searchIndex.search('javscript', { fuzzy: true });
```

### Fuzzy Distance

- `1`: Matches with 1 edit (deletion, insertion, substitution, or transposition)
- `2`: Matches with up to 2 edits
- `3`: Matches with up to 3 edits (slower, broader)

## Auto-Complete Suggestions

Get term suggestions for partial queries:

```typescript
const suggestions = searchIndex.suggest('type', 10);
// ['typescript', 'typed', 'typeset', ...]
```

### Implementing Auto-Complete

```tsx
function SearchBox() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (query.length >= 2) {
      setSuggestions(searchIndex.suggest(query, 5));
    } else {
      setSuggestions([]);
    }
  }, [query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      {suggestions.length > 0 && (
        <ul>
          {suggestions.map((suggestion) => (
            <li
              key={suggestion}
              onClick={() => setQuery(suggestion)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Integration with Pocket Database

### Keeping Index in Sync

Use plugins to automatically update the search index when documents change:

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSearchIndex } from '@pocket/core';
import type { PluginDefinition } from '@pocket/core';

interface Article {
  _id: string;
  title: string;
  content: string;
}

// Create search index
const searchIndex = createSearchIndex<Article>({
  fields: ['title', 'content'],
  weights: { title: 3, content: 1 },
});

// Create plugin to sync with search index
const searchPlugin: PluginDefinition<Article> = {
  name: 'search-sync',

  afterInsert: async (document) => {
    searchIndex.add(document);
  },

  afterUpdate: async (document) => {
    searchIndex.update(document);
  },

  afterDelete: async (context) => {
    searchIndex.remove(context.documentId);
  },
};

// Create database with plugin
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

db.plugins.registerForCollections(searchPlugin, ['articles']);

// Initial population
const articles = await db.collection<Article>('articles').find().exec();
searchIndex.addMany(articles);
```

### React Hook for Search

```tsx
import { useState, useMemo, useCallback } from 'react';

function useSearch<T extends Document>(
  index: SearchIndex<T>,
  options?: SearchOptions
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults<T> | null>(null);

  const search = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      if (searchQuery.trim().length >= 2) {
        setResults(index.search(searchQuery, options));
      } else {
        setResults(null);
      }
    },
    [index, options]
  );

  return { query, results, search };
}

// Usage
function ArticleSearch() {
  const { query, results, search } = useSearch(searchIndex, {
    limit: 20,
    highlight: true,
  });

  return (
    <div>
      <input
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search articles..."
      />
      {results && (
        <div>
          <p>{results.total} results ({results.executionTimeMs.toFixed(1)}ms)</p>
          {results.results.map((result) => (
            <ArticleCard key={result.document._id} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}
```

## Index Statistics

Monitor index health and size:

```typescript
const stats = searchIndex.getStats();

console.log('Documents:', stats.documentCount);
console.log('Unique terms:', stats.termCount);
console.log('Avg doc length:', stats.avgDocumentLength);
console.log('Total tokens:', stats.totalTokens);
console.log('Size estimate:', stats.sizeEstimate, 'bytes');
```

## Nested Fields

Index nested object properties using dot notation:

```typescript
interface Product {
  _id: string;
  name: string;
  description: string;
  metadata: {
    brand: string;
    category: string;
  };
}

const searchIndex = createSearchIndex<Product>({
  fields: ['name', 'description', 'metadata.brand', 'metadata.category'],
  weights: {
    name: 3,
    'metadata.brand': 2,
    description: 1,
    'metadata.category': 1,
  },
});
```

## Performance Tips

### 1. Index Only Searchable Fields

Only index fields users will actually search:

```typescript
// Good: Index searchable text fields
const index = createSearchIndex<Article>({
  fields: ['title', 'content', 'summary'],
});

// Avoid: Don't index IDs, dates, or numeric fields
const index = createSearchIndex<Article>({
  fields: ['title', '_id', 'createdAt', 'viewCount'], // Bad
});
```

### 2. Limit Result Count

Use pagination for large result sets:

```typescript
const results = searchIndex.search(query, {
  limit: 20,
  offset: page * 20,
});
```

### 3. Set Minimum Score

Filter out low-relevance results:

```typescript
const results = searchIndex.search(query, {
  minScore: 0.1, // Only return results with >10% relevance
});
```

### 4. Debounce Search Input

Don't search on every keystroke:

```typescript
import { useDebouncedCallback } from 'use-debounce';

function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setResults(searchIndex.search(value));
  }, 300);

  return (
    <input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        debouncedSearch(e.target.value);
      }}
    />
  );
}
```

### 5. Clear Unused Indexes

Free memory when search is not needed:

```typescript
// Clear all indexed data
searchIndex.clear();
```

## Stop Words

Stop words (common words like "the", "is", "at") are excluded from indexing. The default English stop words include:

- Articles: a, an, the
- Prepositions: at, by, for, from, in, of, on, to, with
- Conjunctions: and, but, or
- Common verbs: is, are, was, were, be, have, has, had
- Pronouns: he, it, they, this, that, which, who

### Custom Stop Words

```typescript
const searchIndex = createSearchIndex<Article>({
  fields: ['title', 'content'],
  stopWords: ['specific', 'domain', 'terms', 'to', 'ignore'],
});
```

## Example: Full Search Implementation

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSearchIndex } from '@pocket/core';

interface Note {
  _id: string;
  title: string;
  content: string;
  createdAt: number;
}

// Setup
const db = await Database.create({
  name: 'notes-app',
  storage: createIndexedDBStorage(),
});

const notes = db.collection<Note>('notes');

const searchIndex = createSearchIndex<Note>({
  fields: ['title', 'content'],
  weights: { title: 3, content: 1 },
  fuzzy: true,
});

// Sync plugin
const searchSyncPlugin = {
  name: 'search-sync',
  afterInsert: async (doc: Note) => searchIndex.add(doc),
  afterUpdate: async (doc: Note) => searchIndex.update(doc),
  afterDelete: async (ctx: { documentId: string }) => searchIndex.remove(ctx.documentId),
};

db.plugins.registerForCollections(searchSyncPlugin, ['notes']);

// Initial load
const allNotes = await notes.find().exec();
searchIndex.addMany(allNotes);

// Search function
function searchNotes(query: string) {
  if (!query.trim()) return [];

  const results = searchIndex.search(query, {
    limit: 50,
    minScore: 0.05,
    highlight: true,
  });

  return results.results;
}

// Usage
const matches = searchNotes('meeting notes');
for (const match of matches) {
  console.log(`${match.document.title} - ${(match.score * 100).toFixed(0)}%`);
}
```

## See Also

- [Indexing](/docs/guides/indexing) - Database field indexes
- [Plugin System](/docs/guides/plugins) - Extend Pocket functionality
- [React Integration](/docs/guides/react-integration) - React hooks and patterns

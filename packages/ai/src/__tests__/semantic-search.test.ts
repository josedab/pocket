import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SemanticSearchEngine,
  SmartAutocomplete,
  createSemanticSearch,
  createSmartAutocomplete,
} from '../semantic-search.js';
import type { EmbeddingProvider } from '../types.js';

// Mock embedding provider: uses simple character frequency as "embeddings"
function createMockEmbeddingProvider(dims = 8): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const vec = new Array(dims).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[text.charCodeAt(i) % dims] += 1;
        }
        // Normalize
        const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
        return norm > 0 ? vec.map((v: number) => v / norm) : vec;
      });
    },
    getDimensions: () => dims,
    isAvailable: () => true,
  };
}

describe('SemanticSearchEngine', () => {
  let engine: SemanticSearchEngine;

  beforeEach(() => {
    engine = createSemanticSearch({
      embeddings: createMockEmbeddingProvider(),
      topK: 5,
      minScore: 0.1,
    });
  });

  it('should index documents', async () => {
    const count = await engine.indexDocuments([
      { _id: '1', title: 'Learn TypeScript', body: 'TypeScript is great' },
      { _id: '2', title: 'Learn JavaScript', body: 'JavaScript is everywhere' },
    ]);
    expect(count).toBe(2);
    expect(engine.size).toBe(2);
  });

  it('should search indexed documents', async () => {
    await engine.indexDocuments([
      { _id: '1', title: 'TypeScript Guide', body: 'Types and interfaces' },
      { _id: '2', title: 'CSS Styling', body: 'Colors and layouts' },
    ]);

    const results = await engine.search('TypeScript types');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('should return results sorted by score', async () => {
    await engine.indexDocuments([
      { _id: '1', title: 'alpha', body: 'aaaa' },
      { _id: '2', title: 'beta', body: 'bbbb' },
      { _id: '3', title: 'gamma', body: 'cccc' },
    ]);

    const results = await engine.search('alpha');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('should respect topK limit', async () => {
    engine = createSemanticSearch({
      embeddings: createMockEmbeddingProvider(),
      topK: 2,
      minScore: 0,
    });

    await engine.indexDocuments([
      { _id: '1', title: 'a' },
      { _id: '2', title: 'b' },
      { _id: '3', title: 'c' },
    ]);

    const results = await engine.search('test');
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should remove documents from index', async () => {
    await engine.indexDocuments([{ _id: '1', title: 'Test' }]);
    expect(engine.size).toBe(1);
    engine.removeDocument('1');
    expect(engine.size).toBe(0);
  });

  it('should clear the index', async () => {
    await engine.indexDocuments([
      { _id: '1', title: 'a' },
      { _id: '2', title: 'b' },
    ]);
    engine.clear();
    expect(engine.size).toBe(0);
  });

  it('should use specified textFields', async () => {
    engine = createSemanticSearch({
      embeddings: createMockEmbeddingProvider(),
      topK: 5,
      minScore: 0,
      textFields: ['title'],
    });

    await engine.indexDocuments([
      { _id: '1', title: 'Important', body: 'This should be ignored' },
    ]);

    const results = await engine.search('Important');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('SmartAutocomplete', () => {
  let autocomplete: SmartAutocomplete;

  beforeEach(() => {
    autocomplete = createSmartAutocomplete({ maxSuggestions: 3 });
  });

  it('should learn from documents', () => {
    autocomplete.learnFromDocuments([
      { status: 'active', name: 'Alice' },
      { status: 'inactive', name: 'Bob' },
    ]);
    expect(autocomplete.trackedFields).toBe(2);
  });

  it('should suggest matching values', () => {
    autocomplete.learnFromDocuments([
      { status: 'active' },
      { status: 'active' },
      { status: 'archived' },
      { status: 'inactive' },
    ]);

    const suggestions = autocomplete.suggest('status', 'ac');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.value).toBe('active');
    expect(suggestions[0]!.confidence).toBe(1); // most frequent
  });

  it('should respect maxSuggestions limit', () => {
    autocomplete.learnFromDocuments([
      { tag: 'a' },
      { tag: 'b' },
      { tag: 'c' },
      { tag: 'd' },
      { tag: 'e' },
    ]);

    const suggestions = autocomplete.suggest('tag', '');
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('should return top values by frequency', () => {
    autocomplete.learnFromDocuments([
      { color: 'red' },
      { color: 'red' },
      { color: 'blue' },
      { color: 'red' },
      { color: 'green' },
    ]);

    const top = autocomplete.topValues('color', 2);
    expect(top[0]!.value).toBe('red');
    expect(top.length).toBe(2);
  });

  it('should clear field data', () => {
    autocomplete.learnFromDocuments([{ a: 'x' }, { b: 'y' }]);
    autocomplete.clear('a');
    expect(autocomplete.trackedFields).toBe(1);
  });

  it('should clear all data', () => {
    autocomplete.learnFromDocuments([{ a: 'x' }, { b: 'y' }]);
    autocomplete.clear();
    expect(autocomplete.trackedFields).toBe(0);
  });

  it('should return empty for unknown fields', () => {
    expect(autocomplete.suggest('unknown', 'abc')).toEqual([]);
    expect(autocomplete.topValues('unknown')).toEqual([]);
  });
});

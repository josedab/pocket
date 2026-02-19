import { describe, expect, it } from 'vitest';
import { createGenerationPipeline, GenerationPipeline } from '../generation-pipeline.js';
import type { PipelineConfig, PipelineOutput } from '../generation-pipeline.js';
import type { CollectionSchema, PocketSchema } from '../types.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const todoCollection: CollectionSchema = {
  name: 'todos',
  fields: {
    title: { type: 'string', required: true },
    completed: { type: 'boolean', default: false },
  },
  timestamps: true,
};

const userCollection: CollectionSchema = {
  name: 'users',
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
  },
};

const validSchema: PocketSchema = {
  version: '1.0.0',
  collections: [todoCollection, userCollection],
};

const singleCollectionSchema: PocketSchema = {
  version: '1.0.0',
  collections: [todoCollection],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GenerationPipeline', () => {
  describe('pipeline creation', () => {
    it('should create a pipeline via factory function', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      expect(pipeline).toBeInstanceOf(GenerationPipeline);
    });

    it('should create a pipeline with constructor', () => {
      const config: PipelineConfig = { targets: ['types', 'validation'] };
      const pipeline = new GenerationPipeline(config);
      expect(pipeline).toBeInstanceOf(GenerationPipeline);
    });
  });

  describe('single-target generation (types only)', () => {
    it('should generate only type files when target is types', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const output = pipeline.generate(validSchema);

      expect(output.targets).toEqual(['types']);
      expect(output.fileCount).toBeGreaterThan(0);
      expect(output.files.length).toBe(output.fileCount);
      for (const file of output.files) {
        // TypeGenerator may emit an 'index' barrel file alongside 'types' files
        expect(['types', 'index']).toContain(file.type);
      }
    });

    it('should generate type files for a single collection', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const output = pipeline.generateForCollection(validSchema, 'todos');

      expect(output.fileCount).toBeGreaterThan(0);
      expect(output.targets).toEqual(['types']);
    });
  });

  describe('multi-target generation', () => {
    it('should generate types and validation', () => {
      const pipeline = createGenerationPipeline({ targets: ['types', 'validation'] });
      const output = pipeline.generate(singleCollectionSchema);

      expect(output.targets).toEqual(['types', 'validation']);
      expect(output.fileCount).toBeGreaterThan(0);

      const typeFiles = output.files.filter((f) => f.type === 'types');
      const validationFiles = output.files.filter((f) => f.type === 'validation');
      expect(typeFiles.length).toBeGreaterThan(0);
      expect(validationFiles.length).toBeGreaterThan(0);
    });

    it('should generate all targets when "all" is specified', () => {
      const pipeline = createGenerationPipeline({ targets: ['all'] });
      const output = pipeline.generate(singleCollectionSchema);

      expect(output.targets).toEqual(['types', 'validation', 'hooks', 'forms', 'api', 'crud', 'graphql']);
      expect(output.fileCount).toBeGreaterThan(0);
    });

    it('should preserve pipeline order regardless of config order', () => {
      const pipeline = createGenerationPipeline({ targets: ['crud', 'types', 'hooks'] });
      const output = pipeline.generate(singleCollectionSchema);

      expect(output.targets).toEqual(['types', 'hooks', 'crud']);
    });
  });

  describe('schema validation errors', () => {
    it('should throw on missing version', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const bad = { collections: [todoCollection] } as unknown as PocketSchema;

      expect(() => pipeline.generate(bad)).toThrow('Invalid schema');
    });

    it('should throw on missing collections', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const bad = { version: '1.0.0' } as unknown as PocketSchema;

      expect(() => pipeline.generate(bad)).toThrow('Invalid schema');
    });

    it('should throw when collection not found in generateForCollection', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });

      expect(() => pipeline.generateForCollection(validSchema, 'nonexistent')).toThrow(
        'Collection "nonexistent" not found in schema',
      );
    });
  });

  describe('output format correctness', () => {
    it('should return a PipelineOutput with correct shape', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const output: PipelineOutput = pipeline.generate(validSchema);

      expect(output).toHaveProperty('files');
      expect(output).toHaveProperty('targets');
      expect(output).toHaveProperty('fileCount');
      expect(Array.isArray(output.files)).toBe(true);
      expect(Array.isArray(output.targets)).toBe(true);
      expect(typeof output.fileCount).toBe('number');
    });

    it('should have valid GeneratedFile entries', () => {
      const pipeline = createGenerationPipeline({ targets: ['types'] });
      const output = pipeline.generate(validSchema);

      for (const file of output.files) {
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('content');
        expect(file).toHaveProperty('type');
        expect(typeof file.path).toBe('string');
        expect(typeof file.content).toBe('string');
        expect(file.path.length).toBeGreaterThan(0);
        expect(file.content.length).toBeGreaterThan(0);
      }
    });

    it('should return zero files when no targets match', () => {
      const pipeline = createGenerationPipeline({ targets: [] });
      const output = pipeline.generate(validSchema);

      expect(output.fileCount).toBe(0);
      expect(output.files).toEqual([]);
      expect(output.targets).toEqual([]);
    });
  });
});

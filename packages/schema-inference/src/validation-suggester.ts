/**
 * Validation rule suggester that analyzes field data and produces
 * actionable validation suggestions with confidence scores.
 *
 * @module
 */

import type { InferredSchema, InferredField, ConfidenceScore } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Type of validation rule being suggested */
export type ValidationRuleType =
  | 'min'
  | 'max'
  | 'min-length'
  | 'max-length'
  | 'pattern'
  | 'enum'
  | 'required'
  | 'optional'
  | 'nullable'
  | 'integer'
  | 'positive'
  | 'non-negative'
  | 'email'
  | 'url'
  | 'uuid';

/** A single validation rule suggestion */
export interface ValidationSuggestion {
  readonly fieldPath: string;
  readonly rule: ValidationRuleType;
  readonly value: unknown;
  readonly confidence: ConfidenceScore;
  readonly description: string;
}

/** All suggestions for a schema */
export interface ValidationSuggestionResult {
  readonly suggestions: readonly ValidationSuggestion[];
  readonly zodCode: string;
}

/** Configuration for the validation suggester */
export interface ValidationSuggesterConfig {
  /** Minimum confidence to include a suggestion (default: 0.5) */
  readonly minConfidence: number;
  /** Minimum ratio of non-null values to suggest required (default: 0.95) */
  readonly requiredThreshold: number;
  /** Maximum distinct values to suggest enum (default: 15) */
  readonly enumMaxValues: number;
  /** Minimum documents to analyze for numeric ranges (default: 5) */
  readonly minSamplesForRange: number;
}

const DEFAULT_SUGGESTER_CONFIG: ValidationSuggesterConfig = {
  minConfidence: 0.5,
  requiredThreshold: 0.95,
  enumMaxValues: 15,
  minSamplesForRange: 5,
};

// ─── Data Analysis Utilities ─────────────────────────────────────────────────

interface FieldDataStats {
  totalCount: number;
  nullCount: number;
  values: unknown[];
  numericValues: number[];
  stringValues: string[];
  distinctValues: Set<string>;
  allIntegers: boolean;
  allPositive: boolean;
  allNonNegative: boolean;
}

/** Analyze raw values for a single field */
function analyzeFieldData(
  documents: readonly Record<string, unknown>[],
  fieldPath: string,
): FieldDataStats {
  const stats: FieldDataStats = {
    totalCount: documents.length,
    nullCount: 0,
    values: [],
    numericValues: [],
    stringValues: [],
    distinctValues: new Set(),
    allIntegers: true,
    allPositive: true,
    allNonNegative: true,
  };

  for (const doc of documents) {
    const value = getNestedValue(doc, fieldPath);

    if (value === null || value === undefined) {
      stats.nullCount++;
      continue;
    }

    stats.values.push(value);

    if (stats.distinctValues.size <= 100) {
      stats.distinctValues.add(String(value));
    }

    if (typeof value === 'number') {
      stats.numericValues.push(value);
      if (!Number.isInteger(value)) stats.allIntegers = false;
      if (value <= 0) stats.allPositive = false;
      if (value < 0) stats.allNonNegative = false;
    }

    if (typeof value === 'string') {
      stats.stringValues.push(value);
    }
  }

  return stats;
}

/** Get a value from a nested field path (e.g. "address.city") */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Suggestion Generation ──────────────────────────────────────────────────

/** Generate suggestions for a numeric field */
function suggestNumericRules(
  fieldPath: string,
  stats: FieldDataStats,
  config: ValidationSuggesterConfig,
): ValidationSuggestion[] {
  const suggestions: ValidationSuggestion[] = [];
  const count = stats.numericValues.length;
  if (count < config.minSamplesForRange) return suggestions;

  const confidence: ConfidenceScore = {
    value: Math.min(count / Math.max(stats.totalCount, 1), 1),
    sampleCount: count,
  };

  const min = Math.min(...stats.numericValues);
  const max = Math.max(...stats.numericValues);

  suggestions.push({
    fieldPath,
    rule: 'min',
    value: min,
    confidence,
    description: `Minimum observed value is ${min}`,
  });

  suggestions.push({
    fieldPath,
    rule: 'max',
    value: max,
    confidence,
    description: `Maximum observed value is ${max}`,
  });

  if (stats.allIntegers && count >= config.minSamplesForRange) {
    suggestions.push({
      fieldPath,
      rule: 'integer',
      value: true,
      confidence,
      description: `All ${count} observed values are integers`,
    });
  }

  if (stats.allPositive && count >= config.minSamplesForRange) {
    suggestions.push({
      fieldPath,
      rule: 'positive',
      value: true,
      confidence,
      description: `All ${count} observed values are positive`,
    });
  } else if (stats.allNonNegative && count >= config.minSamplesForRange) {
    suggestions.push({
      fieldPath,
      rule: 'non-negative',
      value: true,
      confidence,
      description: `All ${count} observed values are non-negative`,
    });
  }

  return suggestions;
}

/** Generate suggestions for a string field */
function suggestStringRules(
  fieldPath: string,
  stats: FieldDataStats,
  _config: ValidationSuggesterConfig,
): ValidationSuggestion[] {
  const suggestions: ValidationSuggestion[] = [];
  const count = stats.stringValues.length;
  if (count === 0) return suggestions;

  const confidence: ConfidenceScore = {
    value: Math.min(count / Math.max(stats.totalCount, 1), 1),
    sampleCount: count,
  };

  const lengths = stats.stringValues.map(s => s.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);

  if (minLen > 0) {
    suggestions.push({
      fieldPath,
      rule: 'min-length',
      value: minLen,
      confidence,
      description: `Minimum observed string length is ${minLen}`,
    });
  }

  suggestions.push({
    fieldPath,
    rule: 'max-length',
    value: maxLen,
    confidence,
    description: `Maximum observed string length is ${maxLen}`,
  });

  return suggestions;
}

/** Generate suggestions for enum fields */
function suggestEnumRules(
  fieldPath: string,
  stats: FieldDataStats,
  config: ValidationSuggesterConfig,
): ValidationSuggestion[] {
  const suggestions: ValidationSuggestion[] = [];
  const distinctCount = stats.distinctValues.size;
  const nonNullCount = stats.values.length;

  if (distinctCount >= 2 && distinctCount <= config.enumMaxValues && nonNullCount >= 3) {
    const confidence: ConfidenceScore = {
      value: Math.min(nonNullCount / Math.max(stats.totalCount, 1), 1),
      sampleCount: nonNullCount,
    };

    suggestions.push({
      fieldPath,
      rule: 'enum',
      value: [...stats.distinctValues].sort(),
      confidence,
      description: `Only ${distinctCount} distinct values observed: ${[...stats.distinctValues].sort().join(', ')}`,
    });
  }

  return suggestions;
}

/** Generate required/optional suggestions */
function suggestPresenceRules(
  fieldPath: string,
  stats: FieldDataStats,
  config: ValidationSuggesterConfig,
): ValidationSuggestion[] {
  const suggestions: ValidationSuggestion[] = [];
  const presenceRatio = (stats.totalCount - stats.nullCount) / Math.max(stats.totalCount, 1);

  const confidence: ConfidenceScore = {
    value: presenceRatio,
    sampleCount: stats.totalCount,
  };

  if (presenceRatio >= config.requiredThreshold) {
    suggestions.push({
      fieldPath,
      rule: 'required',
      value: true,
      confidence,
      description: `Present in ${(presenceRatio * 100).toFixed(1)}% of documents`,
    });
  } else {
    suggestions.push({
      fieldPath,
      rule: 'optional',
      value: true,
      confidence: { value: 1 - presenceRatio, sampleCount: stats.totalCount },
      description: `Missing in ${((1 - presenceRatio) * 100).toFixed(1)}% of documents`,
    });
  }

  if (stats.nullCount > 0) {
    suggestions.push({
      fieldPath,
      rule: 'nullable',
      value: true,
      confidence: {
        value: stats.nullCount / Math.max(stats.totalCount, 1),
        sampleCount: stats.totalCount,
      },
      description: `${stats.nullCount} null values observed`,
    });
  }

  return suggestions;
}

/** Generate suggestions from semantic type */
function suggestSemanticRules(
  fieldPath: string,
  field: InferredField,
): ValidationSuggestion[] {
  const suggestions: ValidationSuggestion[] = [];

  const ruleMap: Record<string, ValidationRuleType> = {
    email: 'email',
    url: 'url',
    uuid: 'uuid',
  };

  const rule = ruleMap[field.semanticType];
  if (rule) {
    suggestions.push({
      fieldPath,
      rule,
      value: true,
      confidence: field.confidence,
      description: `Detected as ${field.semanticType} via pattern matching`,
    });
  }

  if (field.pattern && !rule) {
    suggestions.push({
      fieldPath,
      rule: 'pattern',
      value: field.pattern,
      confidence: field.confidence,
      description: `Matches pattern: ${field.pattern}`,
    });
  }

  return suggestions;
}

// ─── Zod Code Generation ────────────────────────────────────────────────────

/** Generate Zod validation code from suggestions */
function generateZodFromSuggestions(
  schema: InferredSchema,
  suggestions: readonly ValidationSuggestion[],
): string {
  const lines: string[] = [];
  lines.push(`import { z } from 'zod';`);
  lines.push('');
  lines.push('/** Auto-generated validation schema from data analysis */');
  lines.push('export const schema = z.object({');

  // Group suggestions by field
  const byField = new Map<string, ValidationSuggestion[]>();
  for (const suggestion of suggestions) {
    const existing = byField.get(suggestion.fieldPath) ?? [];
    existing.push(suggestion);
    byField.set(suggestion.fieldPath, existing);
  }

  for (const [fieldPath, field] of schema.fields) {
    const fieldSuggestions = byField.get(fieldPath) ?? [];
    const zodParts = buildZodField(field, fieldSuggestions);
    lines.push(`  ${fieldPath}: ${zodParts},`);
  }

  lines.push('});');
  return lines.join('\n');
}

function buildZodField(
  field: InferredField,
  suggestions: readonly ValidationSuggestion[],
): string {
  const rules = new Map<ValidationRuleType, unknown>();
  for (const s of suggestions) {
    rules.set(s.rule, s.value);
  }

  // Check for enum first
  if (rules.has('enum')) {
    const values = rules.get('enum') as string[];
    let chain = `z.enum([${values.map(v => `'${v}'`).join(', ')}])`;
    if (rules.has('nullable')) chain += '.nullable()';
    if (rules.has('optional')) chain += '.optional()';
    return chain;
  }

  let chain: string;

  switch (field.type) {
    case 'string':
    case 'date': {
      if (rules.has('email')) chain = 'z.string().email()';
      else if (rules.has('url')) chain = 'z.string().url()';
      else if (rules.has('uuid')) chain = 'z.string().uuid()';
      else chain = 'z.string()';

      if (rules.has('min-length')) chain += `.min(${rules.get('min-length')})`;
      if (rules.has('max-length')) chain += `.max(${rules.get('max-length')})`;
      if (rules.has('pattern')) chain += `.regex(/${String(rules.get('pattern'))}/)`;
      break;
    }
    case 'number': {
      chain = 'z.number()';
      if (rules.has('integer')) chain += '.int()';
      if (rules.has('positive')) chain += '.positive()';
      else if (rules.has('non-negative')) chain += '.nonnegative()';
      if (rules.has('min')) chain += `.gte(${rules.get('min')})`;
      if (rules.has('max')) chain += `.lte(${rules.get('max')})`;
      break;
    }
    case 'boolean':
      chain = 'z.boolean()';
      break;
    case 'array':
      chain = 'z.array(z.unknown())';
      break;
    case 'object':
      chain = 'z.record(z.unknown())';
      break;
    default:
      chain = 'z.unknown()';
  }

  if (rules.has('nullable')) chain += '.nullable()';
  if (rules.has('optional')) chain += '.optional()';

  return chain;
}

// ─── Validation Suggester ────────────────────────────────────────────────────

/**
 * Analyzes document data and schema to suggest validation rules
 * with confidence scoring. Generates Zod validation code from suggestions.
 *
 * @example
 * ```typescript
 * const suggester = createValidationSuggester();
 * const result = suggester.suggest(schema, [
 *   { name: 'Alice', age: 30, email: 'alice@example.com' },
 *   { name: 'Bob', age: 25, email: 'bob@test.com' },
 * ]);
 *
 * for (const suggestion of result.suggestions) {
 *   console.log(`${suggestion.fieldPath}: ${suggestion.rule} = ${suggestion.value}`);
 * }
 *
 * console.log(result.zodCode); // Generated Zod schema
 * ```
 */
export class ValidationSuggester {
  private readonly config: ValidationSuggesterConfig;

  constructor(config: Partial<ValidationSuggesterConfig> = {}) {
    this.config = { ...DEFAULT_SUGGESTER_CONFIG, ...config };
  }

  /**
   * Analyze schema and documents to suggest validation rules.
   */
  suggest(
    schema: InferredSchema,
    documents: readonly Record<string, unknown>[],
  ): ValidationSuggestionResult {
    const allSuggestions: ValidationSuggestion[] = [];

    for (const [fieldPath, field] of schema.fields) {
      const stats = analyzeFieldData(documents, fieldPath);
      const fieldSuggestions = this.suggestForField(fieldPath, field, stats);
      allSuggestions.push(...fieldSuggestions);
    }

    // Filter by confidence
    const filtered = allSuggestions.filter(
      s => s.confidence.value >= this.config.minConfidence,
    );

    const zodCode = generateZodFromSuggestions(schema, filtered);

    return { suggestions: filtered, zodCode };
  }

  /**
   * Suggest validation rules for a single field using schema info only (no data).
   */
  suggestFromSchema(schema: InferredSchema): readonly ValidationSuggestion[] {
    const suggestions: ValidationSuggestion[] = [];

    for (const [fieldPath, field] of schema.fields) {
      // Semantic type suggestions
      suggestions.push(...suggestSemanticRules(fieldPath, field));

      // Required/optional from schema
      if (field.required) {
        suggestions.push({
          fieldPath,
          rule: 'required',
          value: true,
          confidence: field.confidence,
          description: `Field is required based on schema inference`,
        });
      }

      if (field.nullable) {
        suggestions.push({
          fieldPath,
          rule: 'nullable',
          value: true,
          confidence: field.confidence,
          description: `Field is nullable based on schema inference`,
        });
      }

      // Enum from schema
      if (field.enumValues && field.enumValues.length >= 2) {
        suggestions.push({
          fieldPath,
          rule: 'enum',
          value: [...field.enumValues],
          confidence: field.confidence,
          description: `${field.enumValues.length} enum values detected in schema`,
        });
      }
    }

    return suggestions.filter(s => s.confidence.value >= this.config.minConfidence);
  }

  private suggestForField(
    fieldPath: string,
    field: InferredField,
    stats: FieldDataStats,
  ): ValidationSuggestion[] {
    const suggestions: ValidationSuggestion[] = [];

    // Presence rules (required/optional/nullable)
    suggestions.push(...suggestPresenceRules(fieldPath, stats, this.config));

    // Semantic type rules
    suggestions.push(...suggestSemanticRules(fieldPath, field));

    // Type-specific rules
    if (field.type === 'number') {
      suggestions.push(...suggestNumericRules(fieldPath, stats, this.config));
    }

    if (field.type === 'string' || field.type === 'date') {
      suggestions.push(...suggestStringRules(fieldPath, stats, this.config));
    }

    // Enum detection
    if (field.type === 'string' || field.type === 'number') {
      suggestions.push(...suggestEnumRules(fieldPath, stats, this.config));
    }

    return suggestions;
  }
}

/** Factory function to create a ValidationSuggester. */
export function createValidationSuggester(
  config?: Partial<ValidationSuggesterConfig>,
): ValidationSuggester {
  return new ValidationSuggester(config);
}

/**
 * Pattern detectors for semantic type inference.
 *
 * @module
 */

import type { SemanticType } from './types.js';

const PATTERNS: readonly { type: SemanticType; regex: RegExp }[] = [
  { type: 'email', regex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/ },
  { type: 'uuid', regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { type: 'iso-date', regex: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/ },
  { type: 'url', regex: /^https?:\/\/[^\s/$.?#].[^\s]*$/i },
  { type: 'ip-address', regex: /^(\d{1,3}\.){3}\d{1,3}$/ },
  { type: 'hex-color', regex: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/ },
  { type: 'phone', regex: /^\+?[1-9]\d{1,14}$/ },
];

/**
 * Detect the semantic type of a string value by matching against known patterns.
 */
export function detectSemanticType(value: string): SemanticType {
  for (const { type, regex } of PATTERNS) {
    if (regex.test(value)) {
      return type;
    }
  }

  // Check if it's a JSON string
  if ((value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      JSON.parse(value);
      return 'json-string';
    } catch {
      // not valid JSON
    }
  }

  return 'none';
}

/**
 * Get the regex pattern string for a semantic type.
 */
export function getPatternForSemanticType(type: SemanticType): string | undefined {
  const entry = PATTERNS.find(p => p.type === type);
  return entry ? entry.regex.source : undefined;
}

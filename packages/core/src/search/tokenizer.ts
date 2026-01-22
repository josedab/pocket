import type { Token } from './types.js';

/**
 * Default English stop words
 */
export const DEFAULT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'the',
  'this',
  'but',
  'they',
  'have',
  'had',
  'what',
  'when',
  'where',
  'who',
  'which',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'just',
  'should',
  'now',
]);

/**
 * Tokenizer options
 */
export interface TokenizerOptions {
  /** Stop words to exclude */
  stopWords?: Set<string>;
  /** Minimum word length */
  minWordLength?: number;
  /** Maximum word length */
  maxWordLength?: number;
  /** Whether to apply stemming */
  stemming?: boolean;
  /** Language for stemming */
  language?: string;
}

/**
 * Simple Porter stemmer implementation for English
 */
export function stem(word: string): string {
  if (word.length < 3) return word;

  let result = word.toLowerCase();

  // Step 1a: plurals and past participles
  if (result.endsWith('sses')) {
    result = result.slice(0, -2);
  } else if (result.endsWith('ies')) {
    result = result.slice(0, -2);
  } else if (result.endsWith('ss')) {
    // do nothing
  } else if (result.endsWith('s')) {
    result = result.slice(0, -1);
  }

  // Step 1b: -ed, -ing
  if (result.endsWith('eed')) {
    if (result.length > 4) {
      result = result.slice(0, -1);
    }
  } else if (result.endsWith('ed')) {
    const base = result.slice(0, -2);
    if (hasVowel(base)) {
      result = base;
      result = fixSuffix(result);
    }
  } else if (result.endsWith('ing')) {
    const base = result.slice(0, -3);
    if (hasVowel(base)) {
      result = base;
      result = fixSuffix(result);
    }
  }

  // Step 1c: y -> i
  if (result.endsWith('y') && result.length > 2 && !isVowel(result[result.length - 2]!)) {
    result = result.slice(0, -1) + 'i';
  }

  // Step 2: common suffixes
  const step2Suffixes: [string, string][] = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['isation', 'ize'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
  ];

  for (const [suffix, replacement] of step2Suffixes) {
    if (result.endsWith(suffix)) {
      const base = result.slice(0, -suffix.length);
      if (getMeasure(base) > 0) {
        result = base + replacement;
      }
      break;
    }
  }

  // Step 3: more suffixes
  const step3Suffixes: [string, string][] = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ];

  for (const [suffix, replacement] of step3Suffixes) {
    if (result.endsWith(suffix)) {
      const base = result.slice(0, -suffix.length);
      if (getMeasure(base) > 0) {
        result = base + replacement;
      }
      break;
    }
  }

  // Step 4: remove suffixes
  const step4Suffixes = [
    'al',
    'ance',
    'ence',
    'er',
    'ic',
    'able',
    'ible',
    'ant',
    'ement',
    'ment',
    'ent',
    'ion',
    'ou',
    'ism',
    'ate',
    'iti',
    'ous',
    'ive',
    'ize',
  ];

  for (const suffix of step4Suffixes) {
    if (result.endsWith(suffix)) {
      const base = result.slice(0, -suffix.length);
      if (getMeasure(base) > 1) {
        if (suffix === 'ion' && base.length > 0) {
          const lastChar = base[base.length - 1];
          if (lastChar === 's' || lastChar === 't') {
            result = base;
          }
        } else {
          result = base;
        }
      }
      break;
    }
  }

  // Step 5: final cleanup
  if (result.endsWith('e')) {
    const base = result.slice(0, -1);
    if (getMeasure(base) > 1 || (getMeasure(base) === 1 && !endsWithCVC(base))) {
      result = base;
    }
  }

  if (result.endsWith('ll') && getMeasure(result.slice(0, -1)) > 1) {
    result = result.slice(0, -1);
  }

  return result;
}

function isVowel(char: string): boolean {
  return 'aeiou'.includes(char.toLowerCase());
}

function hasVowel(word: string): boolean {
  for (const char of word) {
    if (isVowel(char)) return true;
  }
  return false;
}

function isConsonant(word: string, index: number): boolean {
  const char = word[index]!;
  if (isVowel(char)) return false;
  if (char === 'y') {
    return index === 0 || !isConsonant(word, index - 1);
  }
  return true;
}

function getMeasure(word: string): number {
  let measure = 0;
  let inVowelSequence = false;

  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) {
      inVowelSequence = true;
    } else if (inVowelSequence) {
      measure++;
      inVowelSequence = false;
    }
  }

  return measure;
}

function endsWithCVC(word: string): boolean {
  if (word.length < 3) return false;
  const len = word.length;
  return (
    isConsonant(word, len - 3) &&
    !isConsonant(word, len - 2) &&
    isConsonant(word, len - 1) &&
    !['w', 'x', 'y'].includes(word[len - 1]!)
  );
}

function fixSuffix(word: string): string {
  if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
    return word + 'e';
  }
  if (word.length >= 2) {
    const last = word[word.length - 1];
    const secondLast = word[word.length - 2];
    if (last === secondLast && !['l', 's', 'z'].includes(last!)) {
      return word.slice(0, -1);
    }
  }
  if (getMeasure(word) === 1 && endsWithCVC(word)) {
    return word + 'e';
  }
  return word;
}

/**
 * Tokenize text into normalized tokens
 */
export function tokenize(text: string, field: string, options: TokenizerOptions = {}): Token[] {
  const {
    stopWords = DEFAULT_STOP_WORDS,
    minWordLength = 2,
    maxWordLength = 50,
    stemming = true,
  } = options;

  const tokens: Token[] = [];

  // Split on non-word characters
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);

  let position = 0;
  for (const word of words) {
    if (!word) continue;

    // Skip if too short or too long
    if (word.length < minWordLength || word.length > maxWordLength) {
      continue;
    }

    // Skip stop words
    if (stopWords.has(word)) {
      continue;
    }

    // Apply stemming
    const normalized = stemming ? stem(word) : word;

    tokens.push({
      original: word,
      normalized,
      position,
      field,
    });

    position++;
  }

  return tokens;
}

/**
 * Tokenize a query string
 */
export function tokenizeQuery(query: string, options: TokenizerOptions = {}): string[] {
  const tokens = tokenize(query, '', options);
  return tokens.map((t) => t.normalized);
}

/**
 * Generate fuzzy variants of a term
 */
export function generateFuzzyVariants(term: string, distance = 1): string[] {
  if (distance < 1 || term.length < 3) {
    return [term];
  }

  const variants = new Set<string>([term]);
  const chars = 'abcdefghijklmnopqrstuvwxyz';

  // Deletions
  for (let i = 0; i < term.length; i++) {
    variants.add(term.slice(0, i) + term.slice(i + 1));
  }

  // Substitutions
  for (let i = 0; i < term.length; i++) {
    for (const char of chars) {
      if (char !== term[i]) {
        variants.add(term.slice(0, i) + char + term.slice(i + 1));
      }
    }
  }

  // Insertions
  for (let i = 0; i <= term.length; i++) {
    for (const char of chars) {
      variants.add(term.slice(0, i) + char + term.slice(i));
    }
  }

  // Transpositions
  for (let i = 0; i < term.length - 1; i++) {
    const charA = term[i] ?? '';
    const charB = term[i + 1] ?? '';
    variants.add(term.slice(0, i) + charB + charA + term.slice(i + 2));
  }

  if (distance > 1) {
    // Recursively generate variants for distance > 1
    const currentVariants = [...variants];
    for (const variant of currentVariants) {
      if (variant !== term) {
        const deeperVariants = generateFuzzyVariants(variant, distance - 1);
        for (const dv of deeperVariants) {
          variants.add(dv);
        }
      }
    }
  }

  return [...variants];
}

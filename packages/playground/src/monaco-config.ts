/**
 * Monaco Editor Configuration for Pocket Playground.
 *
 * Provides editor configuration, theme, autocompletion definitions,
 * and TypeScript type hints for the Pocket API surface.
 */

/** Monaco editor configuration for the playground. */
export interface MonacoEditorConfig {
  readonly language: 'typescript' | 'javascript';
  readonly theme: 'pocket-light' | 'pocket-dark';
  readonly fontSize: number;
  readonly minimap: boolean;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  readonly tabSize: number;
  readonly automaticLayout: boolean;
}

/** Default Monaco editor configuration. */
export function getDefaultEditorConfig(
  overrides?: Partial<MonacoEditorConfig>
): MonacoEditorConfig {
  return {
    language: overrides?.language ?? 'typescript',
    theme: overrides?.theme ?? 'pocket-dark',
    fontSize: overrides?.fontSize ?? 14,
    minimap: overrides?.minimap ?? false,
    lineNumbers: overrides?.lineNumbers ?? true,
    wordWrap: overrides?.wordWrap ?? true,
    tabSize: overrides?.tabSize ?? 2,
    automaticLayout: overrides?.automaticLayout ?? true,
  };
}

/** Light theme definition for Monaco. */
export const pocketLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'd73a49' },
    { token: 'string', foreground: '032f62' },
    { token: 'number', foreground: '005cc5' },
    { token: 'type', foreground: '6f42c1' },
    { token: 'function', foreground: '6f42c1' },
    { token: 'variable', foreground: '24292e' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#24292e',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editorLineNumber.foreground': '#959da5',
    'editor.selectionBackground': '#c8e1ff',
  },
};

/** Dark theme definition for Monaco. */
export const pocketDarkTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'd2a8ff' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'variable', foreground: 'c9d1d9' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editor.lineHighlightBackground': '#161b22',
    'editorLineNumber.foreground': '#484f58',
    'editor.selectionBackground': '#264f78',
  },
};

/**
 * TypeScript type definitions for Pocket API.
 * These are injected into the Monaco editor for autocompletion.
 */
export const pocketTypeDefinitions = `
declare const db: {
  [collection: string]: Map<string, Record<string, unknown>>;
};
declare function find(collection: string, predicate?: (doc: Record<string, unknown>) => boolean): Record<string, unknown>[];
declare function findById(collection: string, id: string): Record<string, unknown> | null;
declare function count(collection: string): number;
declare function collections(): string[];
declare const datasetName: string;
declare const _: unknown;
`;

/**
 * Keyboard shortcuts for the REPL editor.
 */
export const replKeyboardShortcuts = [
  { key: 'Shift+Enter', description: 'Execute code' },
  { key: 'ArrowUp', description: 'Previous command (when input is empty)' },
  { key: 'ArrowDown', description: 'Next command (when input is empty)' },
  { key: 'Ctrl+L', description: 'Clear output' },
  { key: 'Ctrl+Space', description: 'Trigger autocomplete' },
  { key: 'Escape', description: 'Close autocomplete' },
] as const;

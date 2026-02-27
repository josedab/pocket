export {
  SchemaSymbolTable,
  createSchemaSymbolTable,
  type CompletionContext,
  type CompletionItem,
  type Diagnostic,
  type HoverResult,
  type ParsedCollection,
  type ParsedField,
  type ParsedPocketConfig,
} from './lsp-server.js';

export {
  PocketExtension,
  createPocketExtension,
  getExtensionManifest,
  type ExtensionManifest,
  type ExtensionSettings,
} from './vscode-extension.js';

/**
 * VS Code Extension Activation — wires the LSP server into VS Code.
 *
 * This module provides the activation/deactivation hooks and the
 * extension manifest configuration for the Pocket LSP extension.
 */

import type {
  CompletionItem,
  Diagnostic,
  ParsedPocketConfig,
  SchemaSymbolTable,
} from './lsp-server.js';
import { createSchemaSymbolTable } from './lsp-server.js';

/** VS Code extension manifest definition. */
export interface ExtensionManifest {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly publisher: string;
  readonly engines: { readonly vscode: string };
  readonly categories: readonly string[];
  readonly activationEvents: readonly string[];
  readonly main: string;
  readonly contributes: {
    readonly languages: readonly {
      readonly id: string;
      readonly extensions: readonly string[];
      readonly configuration?: string;
    }[];
    readonly configuration?: {
      readonly title: string;
      readonly properties: Record<
        string,
        {
          readonly type: string;
          readonly default: unknown;
          readonly description: string;
        }
      >;
    };
  };
}

/** Generate the extension's package.json manifest. */
export function getExtensionManifest(): ExtensionManifest {
  return {
    name: 'pocket-vscode',
    displayName: 'Pocket Database',
    description:
      'Schema-aware completions, diagnostics, and hover docs for Pocket database projects',
    version: '0.1.0',
    publisher: 'pocket-db',
    engines: { vscode: '^1.85.0' },
    categories: ['Programming Languages', 'Linters', 'Other'],
    activationEvents: ['workspaceContains:pocket.config.ts', 'workspaceContains:pocket.config.js'],
    main: './dist/extension.js',
    contributes: {
      languages: [
        {
          id: 'pocket-config',
          extensions: ['.pocket.ts', '.pocket.js'],
        },
      ],
      configuration: {
        title: 'Pocket',
        properties: {
          'pocket.configPath': {
            type: 'string',
            default: 'pocket.config.ts',
            description: 'Path to the Pocket configuration file',
          },
          'pocket.enableDiagnostics': {
            type: 'boolean',
            default: true,
            description: 'Enable real-time schema diagnostics',
          },
          'pocket.enableCompletions': {
            type: 'boolean',
            default: true,
            description: 'Enable schema-aware code completions',
          },
        },
      },
    },
  };
}

/** Extension settings. */
export interface ExtensionSettings {
  readonly configPath: string;
  readonly enableDiagnostics: boolean;
  readonly enableCompletions: boolean;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  configPath: 'pocket.config.ts',
  enableDiagnostics: true,
  enableCompletions: true,
};

/**
 * Extension activation context — manages the lifecycle of the
 * LSP connection and file watchers.
 */
export class PocketExtension {
  private symbolTable: SchemaSymbolTable;
  private settings: ExtensionSettings;
  private configLoaded = false;

  constructor(settings?: Partial<ExtensionSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.symbolTable = createSchemaSymbolTable();
  }

  /** Activate the extension (called by VS Code on startup). */
  activate(): { capabilities: string[] } {
    return {
      capabilities: ['completionProvider', 'hoverProvider', 'diagnosticProvider'],
    };
  }

  /** Load a Pocket config into the symbol table. */
  loadConfig(config: ParsedPocketConfig): void {
    this.symbolTable.load(config);
    this.configLoaded = true;
  }

  /** Whether the config has been loaded. */
  get isConfigLoaded(): boolean {
    return this.configLoaded;
  }

  /** Get completions at the current cursor context. */
  getCompletions(
    context: 'collection-name' | 'field-name' | 'operator' | 'method' | 'field-type',
    collection?: string
  ): readonly CompletionItem[] {
    if (!this.settings.enableCompletions) return [];
    return this.symbolTable.getCompletions({ type: context, collection });
  }

  /** Get hover documentation for a symbol. */
  getHover(symbol: string): string | null {
    const result = this.symbolTable.getHover(symbol);
    return result?.content ?? null;
  }

  /** Validate the current config and return diagnostics. */
  getDiagnostics(config: ParsedPocketConfig): readonly Diagnostic[] {
    if (!this.settings.enableDiagnostics) return [];
    return this.symbolTable.validate(config);
  }

  /** Update settings. */
  updateSettings(settings: Partial<ExtensionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /** Deactivate the extension. */
  deactivate(): void {
    this.configLoaded = false;
  }
}

export function createPocketExtension(settings?: Partial<ExtensionSettings>): PocketExtension {
  return new PocketExtension(settings);
}

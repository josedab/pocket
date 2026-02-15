/**
 * @module tool-registry
 *
 * Registry for managing and discovering agent tools.
 */

import type { Tool, ToolSchema } from './types.js';

/**
 * A registry for managing available tools.
 */
export interface ToolRegistry {
  /** Register a new tool */
  register(tool: Tool): void;
  /** Unregister a tool by name */
  unregister(name: string): void;
  /** Get a tool by name */
  get(name: string): Tool | undefined;
  /** Get all registered tools */
  getAll(): readonly Tool[];
  /** Generate LLM-compatible schemas for all tools */
  getSchemas(): readonly ToolSchema[];
  /** Check if a tool is registered */
  has(name: string): boolean;
}

function toToolSchema(tool: Tool): ToolSchema {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: 'object', properties, required },
  };
}

/**
 * Creates a tool registry for managing agent tools.
 *
 * @param initialTools - Optional array of tools to register initially
 * @returns A ToolRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createToolRegistry([queryTool, insertTool]);
 * registry.register(customTool);
 * const schemas = registry.getSchemas();
 * ```
 */
export function createToolRegistry(initialTools: readonly Tool[] = []): ToolRegistry {
  const tools = new Map<string, Tool>();

  for (const tool of initialTools) {
    tools.set(tool.name, tool);
  }

  return {
    register(tool: Tool) {
      tools.set(tool.name, tool);
    },
    unregister(name: string) {
      tools.delete(name);
    },
    get(name: string) {
      return tools.get(name);
    },
    getAll() {
      return [...tools.values()];
    },
    getSchemas() {
      return [...tools.values()].map(toToolSchema);
    },
    has(name: string) {
      return tools.has(name);
    },
  };
}

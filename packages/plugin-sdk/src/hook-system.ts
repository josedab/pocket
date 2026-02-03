/**
 * Plugin Hook System — register and execute plugin hooks with priority ordering.
 *
 * @module @pocket/plugin-sdk/hook-system
 */

export type HookName =
  | 'beforeInsert' | 'afterInsert'
  | 'beforeUpdate' | 'afterUpdate'
  | 'beforeDelete' | 'afterDelete'
  | 'beforeQuery' | 'afterQuery'
  | 'onSync' | 'onConflict'
  | 'onConnect' | 'onDisconnect'
  | 'onError';

export type HookPriority = 'low' | 'normal' | 'high' | 'critical';

export interface HookRegistration {
  id: string;
  pluginId: string;
  hook: HookName;
  handler: HookHandler;
  priority: HookPriority;
  enabled: boolean;
}

export type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult;

export interface HookContext {
  hookName: HookName;
  collection?: string;
  document?: Record<string, unknown>;
  query?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface HookResult {
  proceed: boolean;
  modified?: Record<string, unknown>;
  error?: string;
}

const PRIORITY_ORDER: Record<HookPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

let nextId = 0;

function generateId(): string {
  return `hook_${++nextId}_${Date.now()}`;
}

/**
 * Plugin hook registration and execution system.
 *
 * Hooks are executed in priority order (critical → high → normal → low).
 * If any handler returns `proceed: false`, the chain stops immediately.
 * Modified documents are passed down the chain to subsequent handlers.
 */
export class HookSystem {
  private readonly registrations = new Map<string, HookRegistration>();

  /**
   * Register a hook handler for a plugin.
   * @returns The registration ID.
   */
  register(
    pluginId: string,
    hook: HookName,
    handler: HookHandler,
    priority: HookPriority = 'normal',
  ): string {
    const id = generateId();
    this.registrations.set(id, {
      id,
      pluginId,
      hook,
      handler,
      priority,
      enabled: true,
    });
    return id;
  }

  /**
   * Unregister a hook by registration ID.
   */
  unregister(registrationId: string): boolean {
    return this.registrations.delete(registrationId);
  }

  /**
   * Remove all hooks for a given plugin.
   * @returns The number of hooks removed.
   */
  unregisterPlugin(pluginId: string): number {
    let count = 0;
    for (const [id, reg] of this.registrations) {
      if (reg.pluginId === pluginId) {
        this.registrations.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Execute all registered handlers for a hook in priority order.
   *
   * If any handler returns `proceed: false`, the chain stops and that result is returned.
   * Modified documents are passed to the next handler in the chain.
   */
  async execute(
    hook: HookName,
    context: Omit<HookContext, 'hookName' | 'timestamp'>,
  ): Promise<HookResult> {
    const handlers = this.getRegistrations(hook)
      .filter((r) => r.enabled)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    let currentDocument = context.document;

    for (const registration of handlers) {
      const hookContext: HookContext = {
        ...context,
        hookName: hook,
        timestamp: Date.now(),
        document: currentDocument,
      };

      const result = await registration.handler(hookContext);

      if (!result.proceed) {
        return result;
      }

      if (result.modified) {
        currentDocument = result.modified;
      }
    }

    return { proceed: true, modified: currentDocument };
  }

  /**
   * Get all registrations, optionally filtered by hook name.
   */
  getRegistrations(hook?: HookName): HookRegistration[] {
    const all = Array.from(this.registrations.values());
    if (hook) {
      return all.filter((r) => r.hook === hook);
    }
    return all;
  }

  /**
   * Enable a hook registration.
   */
  enable(registrationId: string): void {
    const reg = this.registrations.get(registrationId);
    if (reg) {
      reg.enabled = true;
    }
  }

  /**
   * Disable a hook registration.
   */
  disable(registrationId: string): void {
    const reg = this.registrations.get(registrationId);
    if (reg) {
      reg.enabled = false;
    }
  }

  /**
   * Remove all hook registrations.
   */
  clear(): void {
    this.registrations.clear();
  }
}

/**
 * Create a new HookSystem instance.
 */
export function createHookSystem(): HookSystem {
  return new HookSystem();
}

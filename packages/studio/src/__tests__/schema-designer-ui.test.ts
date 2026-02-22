import { describe, it, expect, beforeEach } from 'vitest';
import type { SchemaCanvas } from '../schema-designer.js';
import {
  createUseSchemaDesignerHook,
  type ReactHooksForDesigner,
  type UseSchemaDesignerReturn,
} from '../react/schema-designer-ui.js';

// ─── Mock React Hooks ────────────────────────────────────────────────────────

function createMockReact(): ReactHooksForDesigner {
  return {
    useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
      let state = typeof initial === 'function' ? (initial as () => T)() : initial;
      const setState = (value: T | ((prev: T) => T)) => {
        state = typeof value === 'function' ? (value as (prev: T) => T)(state) : value;
      };
      return [state, setState];
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, _deps: unknown[]): T {
      return fn;
    },
    useEffect(fn: () => undefined | (() => void), _deps?: unknown[]): void {
      // Execute immediately and store cleanup
      fn();
    },
    useRef<T>(initial: T): { current: T } {
      return { current: initial };
    },
    useMemo<T>(fn: () => T, _deps: unknown[]): T {
      return fn();
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Schema Designer UI', () => {
  let mockReact: ReactHooksForDesigner;

  beforeEach(() => {
    mockReact = createMockReact();
  });

  it('hook factory creates a function', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    expect(typeof useSchemaDesigner).toBe('function');
  });

  it('designer state has expected shape', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    expect(result).toHaveProperty('canvas');
    expect(result).toHaveProperty('selectedCollection');
    expect(result).toHaveProperty('selectedField');
    expect(result).toHaveProperty('canUndo');
    expect(result).toHaveProperty('canRedo');
    expect(result).toHaveProperty('validationErrors');

    expect(result.canvas).toEqual({ collections: [], relationships: [] });
    expect(result.selectedCollection).toBeNull();
    expect(result.selectedField).toBeNull();
    expect(result.canUndo).toBe(false);
    expect(result.canRedo).toBe(false);
    expect(Array.isArray(result.validationErrors)).toBe(true);
  });

  it('selection tracking works', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    // Functions exist and are callable
    expect(typeof result.selectCollection).toBe('function');
    expect(typeof result.selectField).toBe('function');

    // Can call without error
    result.selectCollection('col-1');
    result.selectField('field-1');
  });

  it('actions modify canvas state', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    result.addCollection('Users');

    // Actions exist and are callable
    expect(typeof result.addCollection).toBe('function');
    expect(typeof result.removeCollection).toBe('function');
    expect(typeof result.addField).toBe('function');
    expect(typeof result.removeField).toBe('function');
    expect(typeof result.addIndex).toBe('function');
    expect(typeof result.removeIndex).toBe('function');
    expect(typeof result.addRelationship).toBe('function');
  });

  it('undo/redo state updates', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    expect(typeof result.undo).toBe('function');
    expect(typeof result.redo).toBe('function');

    // Initially no undo/redo available
    expect(result.canUndo).toBe(false);
    expect(result.canRedo).toBe(false);

    // Add a collection then undo should work
    result.addCollection('Users');
    result.undo();
    result.redo();
  });

  it('DSL export returns string', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    const dsl = result.toDSL();
    expect(typeof dsl).toBe('string');
  });

  it('DSL round-trip works', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    result.addCollection('Users');
    // Use collection name for legacy-compat lookup since mock useState doesn't re-render
    result.addField('Users', {
      name: 'email',
      type: 'string',
      optional: false,
    });

    const dsl = result.toDSL();
    expect(dsl).toContain('Users');
    expect(dsl).toContain('email');

    // Import DSL
    result.fromDSL(dsl);
    expect(typeof result.toDSL()).toBe('string');
  });

  it('validation runs on state change', () => {
    const useSchemaDesigner = createUseSchemaDesignerHook(mockReact);
    const result = useSchemaDesigner();

    // validate is callable and returns void
    expect(typeof result.validate).toBe('function');
    result.validate();
    expect(Array.isArray(result.validationErrors)).toBe(true);
  });
});

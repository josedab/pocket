/**
 * React hook factories and component prop types for the visual schema designer.
 *
 * Uses dependency injection for React hooks so that @pocket/studio
 * doesn't need a direct React dependency.
 */

import type {
  CanvasCollection,
  CanvasField,
  CanvasRelationship,
  SchemaCanvas,
  SchemaDesignerConfig,
} from '../schema-designer.js';
import { SchemaDesigner, createSchemaDesigner } from '../schema-designer.js';

// ─── React DI Interface ──────────────────────────────────────────────────────

/** Subset of React hooks needed by the schema designer hook */
export interface ReactHooksForDesigner {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useRef<T>(initial: T): { current: T };
  useMemo<T>(fn: () => T, deps: unknown[]): T;
}

// ─── Hook State & Action Types ───────────────────────────────────────────────

export interface UseSchemaDesignerState {
  canvas: SchemaCanvas;
  selectedCollection: string | null;
  selectedField: string | null;
  canUndo: boolean;
  canRedo: boolean;
  validationErrors: string[];
}

export interface UseSchemaDesignerActions {
  addCollection(name: string): void;
  removeCollection(id: string): void;
  selectCollection(id: string | null): void;
  addField(collectionId: string, field: Omit<CanvasField, 'id'>): void;
  removeField(collectionId: string, fieldId: string): void;
  selectField(fieldId: string | null): void;
  addIndex(collectionId: string, fields: string[], unique?: boolean): void;
  removeIndex(collectionId: string, indexId: string): void;
  addRelationship(rel: Omit<CanvasRelationship, 'id'>): void;
  undo(): void;
  redo(): void;
  toDSL(): string;
  fromDSL(dsl: string): void;
  validate(): void;
}

export type UseSchemaDesignerReturn = UseSchemaDesignerState & UseSchemaDesignerActions;

// ─── Component Prop Types ────────────────────────────────────────────────────

export interface CollectionCardProps {
  collection: CanvasCollection;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onAddField: () => void;
  onRename: (name: string) => void;
}

export interface FieldRowProps {
  field: CanvasField;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onChangeType: (type: string) => void;
}

export interface DesignerToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportDSL: () => void;
  onImportDSL: (dsl: string) => void;
  onValidate: () => void;
  validationErrors: string[];
}

// ─── Hook Factory ────────────────────────────────────────────────────────────

/**
 * Factory that creates the `useSchemaDesigner` hook.
 *
 * @example
 * ```ts
 * import * as React from 'react';
 * import { createUseSchemaDesignerHook } from '@pocket/studio';
 *
 * const useSchemaDesigner = createUseSchemaDesignerHook(React);
 * ```
 */
export function createUseSchemaDesignerHook(React: ReactHooksForDesigner) {
  return function useSchemaDesigner(
    config?: SchemaDesignerConfig,
  ): UseSchemaDesignerReturn {
    const designerRef = React.useRef<SchemaDesigner | null>(null);
    if (designerRef.current === null) {
      designerRef.current = createSchemaDesigner(config);
    }
    const designer = designerRef.current;

    const [canvas, setCanvas] = React.useState<SchemaCanvas>(designer.getCanvas());
    const [selectedCollection, setSelectedCollection] = React.useState<string | null>(null);
    const [selectedField, setSelectedField] = React.useState<string | null>(null);
    const [canUndo, setCanUndo] = React.useState(false);
    const [canRedo, setCanRedo] = React.useState(false);
    const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

    // Subscribe to canvas$ observable
    React.useEffect(() => {
      const subscription = designer.canvas$.subscribe((next) => {
        setCanvas(next);
        setCanUndo(designer.canUndo());
        setCanRedo(designer.canRedo());
        const result = designer.validate();
        setValidationErrors(result.errors);
      });
      return () => subscription.unsubscribe();
    }, [designer]);

    const addCollection = React.useCallback(
      (name: string) => { designer.addCollection(name); },
      [designer],
    ) as (name: string) => void;

    const removeCollection = React.useCallback(
      (id: string) => { designer.removeCollection(id); },
      [designer],
    ) as (id: string) => void;

    const selectCollection = React.useCallback(
      (id: string | null) => { setSelectedCollection(id); },
      [],
    ) as (id: string | null) => void;

    const addField = React.useCallback(
      (collectionId: string, field: Omit<CanvasField, 'id'>) => {
        designer.addField(collectionId, field);
      },
      [designer],
    ) as (collectionId: string, field: Omit<CanvasField, 'id'>) => void;

    const removeField = React.useCallback(
      (collectionId: string, fieldId: string) => {
        designer.removeField(collectionId, fieldId);
      },
      [designer],
    ) as (collectionId: string, fieldId: string) => void;

    const selectField = React.useCallback(
      (fieldId: string | null) => { setSelectedField(fieldId); },
      [],
    ) as (fieldId: string | null) => void;

    const addIndex = React.useCallback(
      (collectionId: string, fields: string[], unique?: boolean) => {
        designer.addIndex(collectionId, fields, unique);
      },
      [designer],
    ) as (collectionId: string, fields: string[], unique?: boolean) => void;

    const removeIndex = React.useCallback(
      (collectionId: string, indexId: string) => {
        designer.removeIndex(collectionId, indexId);
      },
      [designer],
    ) as (collectionId: string, indexId: string) => void;

    const addRelationship = React.useCallback(
      (rel: Omit<CanvasRelationship, 'id'>) => {
        designer.addRelationship(rel);
      },
      [designer],
    ) as (rel: Omit<CanvasRelationship, 'id'>) => void;

    const undo = React.useCallback(() => { designer.undo(); }, [designer]) as () => void;
    const redo = React.useCallback(() => { designer.redo(); }, [designer]) as () => void;

    const toDSL = React.useCallback(() => designer.toDSL(), [designer]) as () => string;

    const fromDSL = React.useCallback(
      (dsl: string) => { designer.fromDSL(dsl); },
      [designer],
    ) as (dsl: string) => void;

    const validate = React.useCallback(() => {
      const result = designer.validate();
      setValidationErrors(result.errors);
    }, [designer]) as () => void;

    return {
      canvas,
      selectedCollection,
      selectedField,
      canUndo,
      canRedo,
      validationErrors,
      addCollection,
      removeCollection,
      selectCollection,
      addField,
      removeField,
      selectField,
      addIndex,
      removeIndex,
      addRelationship,
      undo,
      redo,
      toDSL,
      fromDSL,
      validate,
    };
  };
}

/**
 * Conflict Analyzer - Analyzes and compares document versions
 */

import type { Document } from '@pocket/core';
import type {
  Conflict,
  ConflictAnalysis,
  FieldChange,
  MergeResult,
  ResolutionStrategy,
} from './types.js';

/**
 * Analyzes conflicts and suggests resolutions
 */
export class ConflictAnalyzer {
  /**
   * Analyze a conflict in detail
   */
  analyze<T extends Document>(conflict: Conflict<T>): ConflictAnalysis<T> {
    const fieldChanges = this.computeFieldChanges(conflict);
    const localOnlyChanges = fieldChanges
      .filter((f) => f.localValue !== f.baseValue && f.remoteValue === f.baseValue)
      .map((f) => f.path);
    const remoteOnlyChanges = fieldChanges
      .filter((f) => f.remoteValue !== f.baseValue && f.localValue === f.baseValue)
      .map((f) => f.path);
    const conflictingFields = fieldChanges.filter((f) => f.hasConflict).map((f) => f.path);

    const canAutoMerge = conflictingFields.length === 0 && conflict.type === 'update_update';
    const suggestedStrategy = this.suggestStrategy(conflict, canAutoMerge, fieldChanges);

    let suggestedMerge: T | undefined;
    if (canAutoMerge) {
      const mergeResult = this.threeWayMerge(conflict);
      if (mergeResult.success) {
        suggestedMerge = mergeResult.merged;
      }
    }

    return {
      conflict,
      fieldChanges,
      localOnlyChanges,
      remoteOnlyChanges,
      conflictingFields,
      canAutoMerge,
      suggestedStrategy,
      suggestedMerge,
    };
  }

  /**
   * Compute field-level changes
   */
  private computeFieldChanges<T extends Document>(conflict: Conflict<T>): FieldChange[] {
    const changes: FieldChange[] = [];
    const allPaths = new Set<string>();

    // Gather all field paths
    this.gatherPaths(conflict.local, '', allPaths);
    this.gatherPaths(conflict.remote, '', allPaths);
    this.gatherPaths(conflict.base, '', allPaths);

    // Analyze each path
    for (const path of allPaths) {
      // Skip internal fields
      if (path.startsWith('_')) continue;

      const localValue = this.getValueAtPath(conflict.local, path);
      const remoteValue = this.getValueAtPath(conflict.remote, path);
      const baseValue = this.getValueAtPath(conflict.base, path);

      const localChanged = !this.deepEqual(localValue, baseValue);
      const remoteChanged = !this.deepEqual(remoteValue, baseValue);
      const hasConflict = localChanged && remoteChanged && !this.deepEqual(localValue, remoteValue);

      changes.push({
        path,
        localValue,
        remoteValue,
        baseValue,
        hasConflict,
      });
    }

    return changes;
  }

  /**
   * Gather all paths from an object
   */
  private gatherPaths(obj: unknown, prefix: string, paths: Set<string>): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.add(path);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.gatherPaths(value, path, paths);
      }
    }
  }

  /**
   * Get value at a dot-notation path
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined) return undefined;

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set value at a dot-notation path
   */
  private setValueAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      current[part] ??= {};
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]!] = value;
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!this.deepEqual(aObj[key], bObj[key])) return false;
    }

    return true;
  }

  /**
   * Suggest resolution strategy based on conflict type and analysis
   */
  private suggestStrategy<T extends Document>(
    conflict: Conflict<T>,
    canAutoMerge: boolean,
    _fieldChanges: FieldChange[]
  ): ResolutionStrategy {
    if (canAutoMerge) {
      return 'merge';
    }

    switch (conflict.type) {
      case 'update_delete':
      case 'delete_update':
        // When one side deleted, usually want to keep the update
        return 'manual';

      case 'create_create':
        // Both created same ID, need to decide
        return 'manual';

      case 'update_update': {
        // Both updated, check timestamps if available
        const localTime = (conflict.local as Record<string, unknown>)?._updatedAt as
          | number
          | undefined;
        const remoteTime = (conflict.remote as Record<string, unknown>)?._updatedAt as
          | number
          | undefined;

        if (localTime && remoteTime) {
          return 'timestamp';
        }

        return 'manual';
      }

      default:
        return 'manual';
    }
  }

  /**
   * Perform three-way merge
   */
  threeWayMerge<T extends Document>(conflict: Conflict<T>): MergeResult<T> {
    // Can't merge if either side is null
    if (!conflict.local || !conflict.remote) {
      return {
        success: false,
        error: 'Cannot merge when one side is deleted',
      };
    }

    // Start with base or local as foundation
    const merged = conflict.base
      ? (JSON.parse(JSON.stringify(conflict.base)) as Record<string, unknown>)
      : (JSON.parse(JSON.stringify(conflict.local)) as Record<string, unknown>);

    const unresolvedConflicts: string[] = [];
    const fieldChanges = this.computeFieldChanges(conflict);

    for (const change of fieldChanges) {
      const localChanged = !this.deepEqual(change.localValue, change.baseValue);
      const remoteChanged = !this.deepEqual(change.remoteValue, change.baseValue);

      if (localChanged && remoteChanged) {
        // Both changed - conflict
        if (this.deepEqual(change.localValue, change.remoteValue)) {
          // Same value, no conflict
          this.setValueAtPath(merged, change.path, change.localValue);
        } else {
          unresolvedConflicts.push(change.path);
        }
      } else if (localChanged) {
        // Only local changed
        this.setValueAtPath(merged, change.path, change.localValue);
      } else if (remoteChanged) {
        // Only remote changed
        this.setValueAtPath(merged, change.path, change.remoteValue);
      }
      // Neither changed - keep base value (already in merged)
    }

    if (unresolvedConflicts.length > 0) {
      return {
        success: false,
        unresolvedConflicts,
        error: `Unresolved conflicts in fields: ${unresolvedConflicts.join(', ')}`,
      };
    }

    return {
      success: true,
      merged: merged as T,
    };
  }

  /**
   * Merge using "last writer wins" strategy
   */
  mergeByTimestamp<T extends Document>(conflict: Conflict<T>): T | null {
    if (!conflict.local && !conflict.remote) return null;
    if (!conflict.local) return conflict.remote;
    if (!conflict.remote) return conflict.local;

    const localTime = (conflict.local as Record<string, unknown>)._updatedAt as number | undefined;
    const remoteTime = (conflict.remote as Record<string, unknown>)._updatedAt as
      | number
      | undefined;

    if (!localTime && !remoteTime) {
      // No timestamps, default to local
      return conflict.local;
    }

    if (!localTime) return conflict.remote;
    if (!remoteTime) return conflict.local;

    return localTime >= remoteTime ? conflict.local : conflict.remote;
  }

  /**
   * Merge using highest version wins
   */
  mergeByVersion<T extends Document>(conflict: Conflict<T>): T | null {
    if (!conflict.local && !conflict.remote) return null;
    if (!conflict.local) return conflict.remote;
    if (!conflict.remote) return conflict.local;

    const localVersion = (conflict.local as Record<string, unknown>)._version as number | undefined;
    const remoteVersion = (conflict.remote as Record<string, unknown>)._version as
      | number
      | undefined;

    if (!localVersion && !remoteVersion) {
      return conflict.local;
    }

    if (!localVersion) return conflict.remote;
    if (!remoteVersion) return conflict.local;

    return localVersion >= remoteVersion ? conflict.local : conflict.remote;
  }

  /**
   * Create a custom merge with specific field selections
   */
  customMerge<T extends Document>(
    conflict: Conflict<T>,
    fieldSelections: Record<string, 'local' | 'remote' | 'base'>
  ): T | null {
    if (!conflict.local && !conflict.remote) return null;

    const base = conflict.base ?? conflict.local ?? conflict.remote;
    if (!base) return null;

    const merged = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;

    for (const [path, selection] of Object.entries(fieldSelections)) {
      let value: unknown;

      switch (selection) {
        case 'local':
          value = this.getValueAtPath(conflict.local, path);
          break;
        case 'remote':
          value = this.getValueAtPath(conflict.remote, path);
          break;
        case 'base':
          value = this.getValueAtPath(conflict.base, path);
          break;
      }

      if (value !== undefined) {
        this.setValueAtPath(merged, path, value);
      }
    }

    return merged as T;
  }
}

/**
 * Create a conflict analyzer
 */
export function createConflictAnalyzer(): ConflictAnalyzer {
  return new ConflictAnalyzer();
}
